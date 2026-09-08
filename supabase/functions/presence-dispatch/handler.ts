type DbResult = { data: unknown; error: unknown };
type Database = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<DbResult>;
  storage: { from: (bucket: string) => { remove: (paths: string[]) => Promise<DbResult> } };
};
type Job = { request_id: string; token: string; locale: string; expires_at: string };
type Ticket = { status: string; id?: string; details?: { error?: string } };
type Dependencies = {
  secret: string | undefined;
  expoAccessToken?: string;
  createDatabase: () => Database;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

async function rpc(db: Database, name: string, args?: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(name + ' failed');
  return data;
}

export function createPresenceHandler(dependencies: Dependencies) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  async function expo(path: string, body: unknown) {
    const response = await fetchImpl('https://exp.host/--/api/v2/push/' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(dependencies.expoAccessToken ? { Authorization: 'Bearer ' + dependencies.expoAccessToken } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Push service returned ' + response.status);
    return (await response.json()).data;
  }
  async function send(db: Database) {
    const jobs = await rpc(db, 'claim_presence_notifications') as Job[];
    let accepted = 0;
    let rejected = 0;
    // A request may have several devices. Stay within Expo's 100-message limit.
    for (let offset = 0; offset < jobs.length; offset += 100) {
      const batch = jobs.slice(offset, offset + 100).filter(job => Date.parse(job.expires_at) > now());
      if (!batch.length) continue;
      const tickets = await expo('send', batch.map(job => ({
        to: job.token,
        title: 'CASPROD',
        body: job.locale === 'en' ? 'A presence check is ready. Open the app to respond.' : 'Une vérification de présence est disponible. Ouvrez l’application pour répondre.',
        data: { requestId: job.request_id },
        sound: 'default', channelId: 'presence',
        ttl: Math.max(1, Math.min(1800, Math.floor((Date.parse(job.expires_at) - now()) / 1000))),
      }))) as Ticket[];
      if (!Array.isArray(tickets) || tickets.length !== batch.length) throw new Error('Invalid push service response');
      for (let i = 0; i < batch.length; i++) {
        const ticket = tickets[i];
        if (ticket.status === 'ok' && ticket.id) {
          await rpc(db, 'finish_presence_notification', { request: batch[i].request_id, push_token: batch[i].token, ticket: ticket.id });
          accepted++;
        } else {
          rejected++;
          if (ticket.details?.error === 'DeviceNotRegistered') {
            await rpc(db, 'finish_presence_notification', { request: batch[i].request_id, push_token: batch[i].token, dead_token: true });
          }
        }
      }
    }
    return { accepted, rejected };
  }
  async function receipts(db: Database) {
    const pending = await rpc(db, 'claim_presence_receipts') as { ticket_id: string }[];
    if (!pending.length) return { checked: 0 };
    const results = await expo('getReceipts', { ids: pending.map(row => row.ticket_id) }) as Record<string, Ticket>;
    if (!results || typeof results !== 'object' || Array.isArray(results)) throw new Error('Invalid receipt response');
    let checked = 0;
    for (const row of pending) {
      const result = results[row.ticket_id];
      if (!result) continue; // Expo may not have produced the receipt yet; retry later.
      await rpc(db, 'resolve_presence_receipt', { ticket: row.ticket_id, result: result.status === 'ok' ? 'ok' : result.details?.error ?? 'DeliveryError' });
      checked++;
    }
    return { checked };
  }
  async function cleanup(db: Database) {
    const expired = await rpc(db, 'expired_presence_photos') as { path: string }[];
    if (expired.length) {
      const { error } = await db.storage.from('presence-proofs').remove(expired.map(row => row.path));
      if (error) throw new Error('Proof cleanup failed');
    }
    const redacted = await rpc(db, 'redact_expired_presence_evidence');
    return { removed: expired.length, redacted };
  }
  return async (request: Request) => {
    if (!dependencies.secret || request.headers.get('Authorization') !== 'Bearer ' + dependencies.secret) {
      return new Response('Unauthorized', { status: 401 });
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const db = dependencies.createDatabase();
    // Cleanup must still run during an Expo outage. Each lane has its own retry state.
    const results = await Promise.allSettled([send(db), receipts(db), cleanup(db)]);
    const names = ['notifications', 'receipts', 'cleanup'];
    const report = Object.fromEntries(results.map((result, i) => [names[i], result.status === 'fulfilled' ? result.value : { error: 'Retry required' }]));
    return Response.json(report, { status: results.some(r => r.status === 'rejected') ? 503 : 200 });
  };
}

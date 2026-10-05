// Posts a note to a chantier and rings the phones of the men on it.
//
// The writing is still post_site_note, called as the chef so every rule about
// who may write where stays in one place in SQL. This function exists for the
// second half: a push needs the service role, because a token is the ability
// to notify somebody and no client is given one.
//
// A failed push is not a failed note. The instruction is on the chantier's
// page either way, and refusing the write because Expo was slow would lose
// the thing the chef actually typed.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

  const payload = await req.json().catch(() => null);
  const site = payload?.site;
  const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
  if (typeof site !== 'string' || !site) return json({ error: 'Invalid site' }, 400);
  if (!body || body.length > 1000) return json({ error: 'Invalid message' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: note, error } = await caller.rpc('post_site_note', { site, body });
  if (error) {
    console.error('[post-site-note] post_site_note failed', error);
    return json({ error: error.message }, 400);
  }

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: site_row } = await admin.from('sites').select('name').eq('id', site).single();
  const { data: targets, error: targetsError } = await admin.rpc('site_note_push_targets', { site });
  if (targetsError) {
    console.error('[post-site-note] targets failed', targetsError);
    return json({ ok: true, note, notified: 0, pushError: targetsError.message }, 200);
  }

  const devices = (targets ?? []) as { token: string; locale: string; employee_id: string }[];
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  // The chantier is the title and the note is the body: a man on two of them
  // reads which one it is about from the lock screen, without opening anything.
  const title = site_row?.name ?? 'Casprod';
  let notified = 0;
  for (let offset = 0; offset < devices.length; offset += 100) {
    const batch = devices.slice(offset, offset + 100);
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(expoToken ? { Authorization: 'Bearer ' + expoToken } : {}) },
        body: JSON.stringify(batch.map((d) => ({
          to: d.token, title, body,
          data: { type: 'site-note', site }, sound: 'default', channelId: 'presence', ttl: 86_400,
        }))),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('Push service returned ' + response.status);
      const tickets = (await response.json()).data as { status: string }[];
      notified += tickets.filter((t) => t.status === 'ok').length;
    } catch (e) {
      console.error('[post-site-note] push batch failed', e);
    }
  }
  console.log('[post-site-note] sent', { site, recipients: devices.length, notified });
  return json({ ok: true, note, notified }, 200);
});

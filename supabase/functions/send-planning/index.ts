import { createClient } from 'npm:@supabase/supabase-js@2';

// Sends a planning to the phones: the chef calls this from the web with a
// date range. publish_planning() runs as the chef (so the role and company
// checks are the database's), stamps the shifts and returns who is concerned;
// the push tokens of those people are then read with the service role and
// one notification per device goes out through Expo. Push delivery is best
// effort: the planning is published even if Expo is down, and the phones
// read it on their next open.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function label(from: string, to: string, locale: string) {
  const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long' });
  const a = fmt.format(new Date(from + 'T12:00:00Z')), b = fmt.format(new Date(to + 'T12:00:00Z'));
  if (from === to) return locale === 'en' ? `Your planning for ${a} is available.` : `Votre planning du ${a} est disponible.`;
  return locale === 'en' ? `Your planning from ${a} to ${b} is available.` : `Votre planning du ${a} au ${b} est disponible.`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

  const body = await req.json().catch(() => null);
  const from = body?.from, to = body?.to;
  if (typeof from !== 'string' || typeof to !== 'string' || !DATE.test(from) || !DATE.test(to)) {
    return json({ error: 'Invalid date range' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: published, error } = await callerClient.rpc('publish_planning', { from_date: from, to_date: to });
  if (error) {
    console.error('[send-planning] publish_planning failed', error);
    return json({ error: error.message }, 400);
  }
  const people: string[] = published?.employees ?? [];

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: targets, error: targetsError } = await admin.rpc('planning_push_targets', { people });
  if (targetsError) {
    console.error('[send-planning] planning_push_targets failed', targetsError);
    return json({ ok: true, shifts: published.shifts, recipients: people.length, notified: 0, pushError: targetsError.message }, 200);
  }

  let notified = 0;
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  const devices = (targets ?? []) as { token: string; locale: string; employee_id: string }[];
  for (let offset = 0; offset < devices.length; offset += 100) {
    const batch = devices.slice(offset, offset + 100);
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(expoToken ? { Authorization: 'Bearer ' + expoToken } : {}) },
        body: JSON.stringify(batch.map((d) => ({
          to: d.token, title: 'CASPROD', body: label(from, to, d.locale),
          data: { type: 'planning', from, to }, sound: 'default', channelId: 'presence', ttl: 86_400,
        }))),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('Push service returned ' + response.status);
      const tickets = (await response.json()).data as { status: string }[];
      notified += tickets.filter((t) => t.status === 'ok').length;
    } catch (e) {
      console.error('[send-planning] push batch failed', e);
    }
  }
  console.log('[send-planning] sent', { from, to, shifts: published.shifts, recipients: people.length, notified });
  return json({ ok: true, shifts: published.shifts, recipients: people.length, notified }, 200);
});

// eslint-disable-next-line import/no-unresolved -- resolved by Deno at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Address suggestions as the chef types, and the coordinates of the one he picks.
 *
 * Behind a function rather than called from the app, for the same reason the
 * Android maps key is not an EXPO_PUBLIC_ variable: a Places key shipped in the
 * binary can be extracted and spent by somebody else. The app sends the text, the
 * function holds the key.
 *
 * Two actions, because Google bills them separately and the second is the
 * expensive one: "suggest" runs on every keystroke, "resolve" only once, when he
 * taps a suggestion.
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type Suggestion = { id: string; label: string; detail: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const key = Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!key) return json({ error: 'Address search is not configured' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  // Signed in, and a chef: only a chef registers a chantier, so nobody else has
  // a reason to spend this quota.
  const { data: caller } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
  if (!caller?.user) return json({ error: 'Not authenticated' }, 401);
  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', caller.user.id).maybeSingle();
  if (profile?.role !== 'chef') return json({ error: 'Only a chef can search addresses' }, 403);

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  // One lookup — the keystrokes and the resolve that follows — counts once
  // against the company's week. Claimed as the caller, so the refusal is the
  // database's, and only once a request is going to reach Google: a query too
  // short to send costs nothing and must not count as a lookup.
  const session = typeof body.session === 'string' && body.session ? body.session : crypto.randomUUID();
  const caller_client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  let left = -1;
  async function claim() {
    const { data, error } = await caller_client.rpc('claim_place_search', { session });
    if (error) {
      console.error('[place-search] quota refused', error.message);
      return json({ error: error.message, quota: true }, 429);
    }
    left = data as number;
    return null;
  }

  if (action === 'suggest') {
    const input = typeof body.input === 'string' ? body.input.trim() : '';
    // Two characters suggest everything and cost a request to say so.
    if (input.length < 3) return json({ suggestions: [] });
    const refused = await claim();
    if (refused) return refused;

    const payload: Record<string, unknown> = {
      input,
      // The session ties a run of keystrokes to the one resolve that follows, so
      // Google bills the session once instead of per keystroke.
      sessionToken: typeof body.session === 'string' ? body.session : undefined,
      languageCode: body.locale === 'en' ? 'en' : 'fr',
    };
    // Biased, not restricted: a chantier is usually near the last map position,
    // but a company that takes a job in another country must still find it.
    if (typeof body.latitude === 'number' && typeof body.longitude === 'number') {
      payload.locationBias = {
        circle: { center: { latitude: body.latitude, longitude: body.longitude }, radius: 50_000 },
      };
    }

    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[place-search] suggest failed', response.status, detail.slice(0, 300));
      return json({ error: 'Address search failed' }, 502);
    }
    const data = await response.json();
    const suggestions: Suggestion[] = (data.suggestions ?? [])
      .map((s: Record<string, any>) => s.placePrediction)
      .filter(Boolean)
      .map((p: Record<string, any>) => ({
        id: p.placeId as string,
        label: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        detail: p.structuredFormat?.secondaryText?.text ?? '',
      }))
      .filter((s: Suggestion) => s.id && s.label);
    return json({ suggestions, left });
  }

  if (action === 'resolve') {
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return json({ error: 'Missing place id' }, 400);
    const refused = await claim();
    if (refused) return refused;
    // The field mask is the bill: ask for the three fields the pin needs and
    // nothing else.
    const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'location,formattedAddress,displayName',
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[place-search] resolve failed', response.status, detail.slice(0, 300));
      return json({ error: 'Address lookup failed' }, 502);
    }
    const place = await response.json();
    const latitude = place?.location?.latitude;
    const longitude = place?.location?.longitude;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return json({ error: 'That address has no position' }, 422);
    }
    return json({
      latitude,
      longitude,
      address: place.formattedAddress ?? place.displayName?.text ?? '',
    });
  }

  return json({ error: 'Unknown action' }, 400);
});

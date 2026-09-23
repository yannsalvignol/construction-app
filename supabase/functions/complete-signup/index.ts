import { createClient } from 'npm:@supabase/supabase-js@2';

// Step two of a chef signup: check the code and only then create the account.
// The password comes with this call, held by the app between the two screens,
// so it is never stored anywhere on the way.
//
// Called without a session (verify_jwt = false in config.toml): the code is
// what authorises it, which is why the comparison, the attempt counter and the
// expiry all live here rather than in the app.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_ATTEMPTS = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function hash(code: string, email: string) {
  const data = new TextEncoder().encode(`${email}:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison: a fast "wrong" answer leaks how much was right. */
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!EMAIL.test(email)) return json({ error: 'Enter a valid email address' }, 400);
  if (!/^\d{6}$/.test(code)) return json({ error: 'Enter the 6-digit code' }, 400);
  if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: row } = await admin
    .from('pending_signups')
    .select('code_hash, attempts, expires_at')
    .eq('email', email)
    .maybeSingle();

  if (!row) return json({ error: 'Ask for a new code' }, 400);
  if (Date.parse(row.expires_at) < Date.now()) return json({ error: 'This code has expired, ask for a new one' }, 400);
  if (row.attempts >= MAX_ATTEMPTS) return json({ error: 'Too many attempts, ask for a new code' }, 429);

  if (!equal(row.code_hash, await hash(code, email))) {
    const attempts = row.attempts + 1;
    await admin.from('pending_signups').update({ attempts }).eq('email', email);
    console.warn('[complete-signup] wrong code', { attempts });
    return json({ error: 'Incorrect code', attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts) }, 400);
  }

  // The address is proven, so the account is created now — confirmed, since
  // the code is the confirmation, and carrying the role onboarding reads next.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { intended_role: 'chef', casprod_email_verified: true },
  });

  if (createError || !created.user) {
    console.error('[complete-signup] could not create the account', createError);
    const taken = createError?.message?.toLowerCase().includes('already been registered');
    return json({ error: taken ? 'already_registered' : 'Could not create the account' }, taken ? 409 : 500);
  }

  // The code is spent whether or not this cleanup succeeds.
  await admin.from('pending_signups').delete().eq('email', email);
  console.log('[complete-signup] account created', { userId: created.user.id });
  return json({ created: true }, 200);
});

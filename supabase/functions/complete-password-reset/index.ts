import { createClient } from 'npm:@supabase/supabase-js@2';

// Checks the code sent by start-password-reset and sets the new password, for
// someone who is not signed in. The code, sent to the address on the account,
// is the whole of the authorisation, which is why the comparison, the attempt
// counter and the expiry all live here rather than in the app.
//
// Called twice by the app: once with the code alone, to find out whether it is
// right before asking for a new password, and once with the password to make
// the change. A code survives the first call so the second can use it, and is
// burned by the second.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_ATTEMPTS = 5;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function hash(code: string, userId: string) {
  const data = new TextEncoder().encode(`${userId}:${code}`);
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
  const password = typeof body?.password === 'string' ? body.password : null;
  // No password means "is this code right?", which is the app's first screen.
  const checkOnly = password === null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address' }, 400);
  if (!/^\d{6}$/.test(code)) return json({ error: 'Enter the 6-digit code' }, 400);
  if (!checkOnly && password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: userId } = await admin.rpc('user_id_for_email', { address: email });
  // Same answer as a wrong code: a missing account is not worth naming.
  if (!userId) return json({ error: 'Ask for a new code' }, 400);
  const user = { id: userId as string };
  const { data: row } = await admin
    .from('password_change_codes')
    .select('code_hash, attempts, expires_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!row) return json({ error: 'Ask for a new code' }, 400);
  if (Date.parse(row.expires_at) < Date.now()) return json({ error: 'This code has expired, ask for a new one' }, 400);
  if (row.attempts >= MAX_ATTEMPTS) return json({ error: 'Too many attempts, ask for a new code' }, 429);

  if (!equal(row.code_hash, await hash(code, user.id))) {
    const attempts = row.attempts + 1;
    await admin.from('password_change_codes').update({ attempts }).eq('user_id', user.id);
    console.warn('[complete-password-reset] wrong code', { userId: user.id, attempts });
    return json({ error: 'Incorrect code', attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts) }, 400);
  }

  if (checkOnly) {
    // Right code, nothing changed yet: the attempt counter is reset so the
    // second call starts clean, and the code stays usable until it is spent.
    await admin.from('password_change_codes').update({ attempts: 0 }).eq('user_id', user.id);
    return json({ valid: true }, 200);
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password });
  if (updateError) {
    console.error('[complete-password-reset] could not set the password', updateError);
    return json({ error: updateError.message }, 400);
  }

  // The code is spent whether or not this cleanup succeeds.
  await admin.from('password_change_codes').delete().eq('user_id', user.id);
  console.log('[complete-password-reset] password changed', { userId: user.id });
  return json({ changed: true }, 200);
});

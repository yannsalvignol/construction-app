import { createClient } from 'npm:@supabase/supabase-js@2';

// Emails a six-digit code to the address on the signed-in account, to confirm
// a password change made from inside the app. Only the hash is stored
// (public.password_change_codes); the code exists in the email and nowhere
// else. complete-password-change checks it and sets the new password.
//
// Requires a session (verify_jwt stays on): this is a change to an account
// that already exists, and the caller has to be holding it.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CODE_TTL_MINUTES = 10;
/** A fresh code cannot be asked for more often than this, per account. */
const RESEND_COOLDOWN_SECONDS = 45;
const FROM = 'Casprod <no-reply@send.casprod.app>';

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sixDigits() {
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return String(value % 1_000_000).padStart(6, '0');
}

async function hash(code: string, userId: string) {
  const data = new TextEncoder().encode(`${userId}:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- the email ---------------------------------------------------------------
function emailHtml(code: string, locale: 'fr' | 'en') {
  const copy = locale === 'en'
    ? {
        title: 'Confirm your new password',
        intro: 'Enter this code in the Casprod app to finish changing your password.',
        expiry: `This code expires in ${CODE_TTL_MINUTES} minutes.`,
        ignore: 'If you did not ask to change your password, ignore this message — nothing has changed — and sign in to check your account.',
      }
    : {
        title: 'Confirmez votre nouveau mot de passe',
        intro: 'Saisissez ce code dans l’application Casprod pour terminer le changement de mot de passe.',
        expiry: `Ce code expire dans ${CODE_TTL_MINUTES} minutes.`,
        ignore: 'Si vous n’avez pas demandé ce changement, ignorez ce message — rien n’a été modifié — et connectez-vous pour vérifier votre compte.',
      };

  return `<!doctype html>
<html lang="${locale}">
  <body style="margin:0;padding:24px;background:#F6F4FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1B1626">
    <div style="max-width:460px;margin:0 auto;background:#ffffff;border-radius:18px;padding:36px 32px">
      <div style="font-size:13px;font-weight:700;letter-spacing:2px;color:#7238CE;margin-bottom:22px">Casprod</div>
      <div style="font-size:21px;font-weight:700;margin-bottom:10px">${copy.title}</div>
      <div style="font-size:15px;line-height:1.55;color:#5C5470;margin-bottom:26px">${copy.intro}</div>
      <div style="font-size:34px;font-weight:700;letter-spacing:10px;background:#F3F0FA;border-radius:12px;padding:18px 0;text-align:center">${code}</div>
      <div style="font-size:13px;color:#8A8299;margin-top:14px">${copy.expiry}</div>
      <div style="height:1px;background:#EDE9F5;margin:26px 0"></div>
      <div style="font-size:13px;line-height:1.55;color:#8A8299">${copy.ignore}</div>
    </div>
  </body>
</html>`;
}

function emailText(code: string, locale: 'fr' | 'en') {
  return locale === 'en'
    ? `Your Casprod code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes. If you did not ask to change your password, ignore this message.`
    : `Votre code Casprod est ${code}. Il expire dans ${CODE_TTL_MINUTES} minutes. Si vous n'avez pas demandé ce changement, ignorez ce message.`;
}
// -----------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    console.error('[start-password-change] RESEND_API_KEY is not set');
    return json({ error: 'Email delivery is not configured' }, 500);
  }

  // The token is read directly rather than through a second client built on
  // the anon key: that key is one more thing to be missing or rotated, and a
  // service-role client can validate a JWT on its own.
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const token = authHeader.replace(/^Bearer /i, '');
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    console.error('[start-password-change] token rejected', userError?.message);
    return json({ error: 'Not authenticated' }, 401);
  }

  const email = user.email;
  // Employees sign in with a username mapped to a synthetic address that
  // receives nothing, and their chef resets their password for them.
  if (!email || email.endsWith('@employee.local')) {
    return json({ error: 'This account has no email address' }, 400);
  }

  const body = await req.json().catch(() => ({}));
  const locale: 'fr' | 'en' = body?.locale === 'en' ? 'en' : 'fr';

  const { data: existing } = await admin
    .from('password_change_codes')
    .select('sent_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    const since = (Date.now() - Date.parse(existing.sent_at)) / 1000;
    if (since < RESEND_COOLDOWN_SECONDS) {
      return json({ error: 'Please wait before asking for a new code', retryIn: Math.ceil(RESEND_COOLDOWN_SECONDS - since) }, 429);
    }
  }

  const code = sixDigits();
  const { error: storeError } = await admin.from('password_change_codes').upsert({
    user_id: user.id,
    code_hash: await hash(code, user.id),
    attempts: 0,
    sent_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
  });
  if (storeError) {
    console.error('[start-password-change] could not store the code', storeError);
    return json({ error: 'Could not send the code' }, 500);
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: locale === 'en' ? 'Your Casprod code' : 'Votre code Casprod',
      html: emailHtml(code, locale),
      text: emailText(code, locale),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[start-password-change] Resend refused the message', response.status, detail);
    await admin.from('password_change_codes').delete().eq('user_id', user.id);
    return json({ error: 'Could not send the code' }, 502);
  }

  console.log('[start-password-change] code sent', { userId: user.id });
  return json({ sent: true, cooldown: RESEND_COOLDOWN_SECONDS }, 200);
});

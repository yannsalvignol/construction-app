import { createClient } from 'npm:@supabase/supabase-js@2';

// Step one of a chef signup: email a six-digit code to an address that does not
// have an account yet. Nothing is created here — no auth user, no profile — so
// a failed send or an abandoned screen leaves the address free to try again.
// complete-signup creates the account once the code comes back.
//
// Called without a session (verify_jwt = false in config.toml), so it validates
// its own input and rate limits per address.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CODE_TTL_MINUTES = 10;
/** A fresh code cannot be asked for more often than this, per address. */
const RESEND_COOLDOWN_SECONDS = 45;
const FROM = 'CASPROD <no-reply@send.casprod.app>';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sixDigits() {
  // Unbiased: folding raw bytes into 000000-999999 would skew, so draw a
  // 32-bit value and discard the tail above the last whole million.
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return String(value % 1_000_000).padStart(6, '0');
}

async function hash(code: string, email: string) {
  // The address salts the digest, so two pending signups holding the same code
  // do not share a hash and one rainbow table cannot attack the whole table.
  const data = new TextEncoder().encode(`${email}:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- the email ---------------------------------------------------------------
// Plain HTML on purpose: inbox clients strip most of what a framework emits.
function emailHtml(code: string, locale: 'fr' | 'en') {
  const copy = locale === 'en'
    ? {
        title: 'Confirm your email',
        intro: 'Enter this code in the CASPROD app to finish creating your account.',
        expiry: `This code expires in ${CODE_TTL_MINUTES} minutes.`,
        ignore: 'If you did not ask to create a CASPROD account, you can ignore this message.',
      }
    : {
        title: 'Confirmez votre e-mail',
        intro: 'Saisissez ce code dans l’application CASPROD pour terminer la création de votre compte.',
        expiry: `Ce code expire dans ${CODE_TTL_MINUTES} minutes.`,
        ignore: 'Si vous n’avez pas demandé la création d’un compte CASPROD, ignorez ce message.',
      };

  return `<!doctype html>
<html lang="${locale}">
  <body style="margin:0;padding:24px;background:#F6F4FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1B1626">
    <div style="max-width:460px;margin:0 auto;background:#ffffff;border-radius:18px;padding:36px 32px">
      <div style="font-size:13px;font-weight:700;letter-spacing:2px;color:#7238CE;margin-bottom:22px">CASPROD</div>
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
    ? `Your CASPROD code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`
    : `Votre code CASPROD est ${code}. Il expire dans ${CODE_TTL_MINUTES} minutes.`;
}
// -----------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const locale: 'fr' | 'en' = body?.locale === 'en' ? 'en' : 'fr';
  if (!EMAIL.test(email) || email.length > 254) return json({ error: 'Enter a valid email address' }, 400);
  if (email.endsWith('@employee.local')) return json({ error: 'Enter a valid email address' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    console.error('[start-signup] RESEND_API_KEY is not set');
    return json({ error: 'Email delivery is not configured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // An address that already has an account is sent to sign-in rather than
  // through signup again. auth.users is not served by PostgREST, hence the
  // security-definer function the migration defines for this.
  const { data: registered, error: lookupError } = await admin.rpc('email_is_registered', { address: email });
  if (lookupError) {
    console.error('[start-signup] could not check for an existing account', lookupError);
    return json({ error: 'Could not start the signup' }, 500);
  }
  if (registered) return json({ error: 'already_registered' }, 409);

  const { data: pending } = await admin
    .from('pending_signups')
    .select('sent_at')
    .eq('email', email)
    .maybeSingle();

  if (pending) {
    const since = (Date.now() - Date.parse(pending.sent_at)) / 1000;
    if (since < RESEND_COOLDOWN_SECONDS) {
      return json({ error: 'Please wait before asking for a new code', retryIn: Math.ceil(RESEND_COOLDOWN_SECONDS - since) }, 429);
    }
  }

  const code = sixDigits();
  const { error: storeError } = await admin.from('pending_signups').upsert({
    email,
    code_hash: await hash(code, email),
    attempts: 0,
    sent_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
  });
  if (storeError) {
    console.error('[start-signup] could not store the code', storeError);
    return json({ error: 'Could not send the code' }, 500);
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: locale === 'en' ? 'Your CASPROD code' : 'Votre code CASPROD',
      html: emailHtml(code, locale),
      text: emailText(code, locale),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[start-signup] Resend refused the message', response.status, detail);
    // The address must stay free to try again, so the pending row goes too.
    await admin.from('pending_signups').delete().eq('email', email);
    return json({ error: 'Could not send the code' }, 502);
  }

  console.log('[start-signup] code sent');
  return json({ sent: true, cooldown: RESEND_COOLDOWN_SECONDS }, 200);
});

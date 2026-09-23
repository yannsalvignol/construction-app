-- Six-digit codes confirming a new chef's email address, between sign-up and
-- onboarding. The app never reads or writes this table: send-email-code and
-- verify-email-code own it with the service role, so a client cannot read a
-- code, count attempts down, or move an expiry.
--
-- Only the hash is stored. A code lives for ten minutes, and five wrong
-- attempts burn it: the row is kept until the next send so a brute force
-- cannot restart by asking for a new code, which is rate limited separately.

create table private.email_verification_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  code_hash text not null,
  attempts integer not null default 0,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table private.email_verification_codes enable row level security;
-- No policies and no grants: the service role bypasses RLS, everyone else has
-- no way in. Stated rather than implied, because an empty policy list is easy
-- to read as an oversight.
revoke all on private.email_verification_codes from public, anon, authenticated;

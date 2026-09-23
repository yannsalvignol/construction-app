-- Codes confirming a password change from inside the app.
--
-- Changing a password is the one action that can lock the real owner out, so
-- it is not enough to hold an unlocked phone: the change is confirmed with a
-- code sent to the address on the account. Same shape as pending_signups, but
-- keyed by the user, since here the account already exists.

create table public.password_change_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  attempts integer not null default 0,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.password_change_codes enable row level security;

-- No policies, no client grants: only the Edge Functions' service role, which
-- bypasses RLS, may read a code, count attempts or move an expiry. Granted
-- explicitly rather than left to Supabase's defaults for tables in `public`.
revoke all on public.password_change_codes from public, anon, authenticated;
grant select, insert, update, delete on public.password_change_codes to service_role;

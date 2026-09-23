-- Codes for an account that does not exist yet.
--
-- The first version of this keyed codes by auth user id, which meant creating
-- the account before the address was proven: a failed send, or someone giving
-- up at the code screen, left a dangling account holding an email nobody could
-- sign up with again. The account is now created only when the code is
-- accepted, so the pending row is keyed by the address itself.
--
-- No password is stored here. The app keeps it in memory between the two
-- screens and sends it once, with the code, to complete the signup.

drop table if exists public.email_verification_codes;

create table public.pending_signups (
  email text primary key,
  code_hash text not null,
  attempts integer not null default 0,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.pending_signups enable row level security;

-- No policies, no client grants: only the Edge Functions' service role, which
-- bypasses RLS, may read a code, count attempts or move an expiry.
revoke all on public.pending_signups from public, anon, authenticated;
grant select, insert, update, delete on public.pending_signups to service_role;

-- start-signup has to know whether an address already has an account, and
-- auth.users is not served by PostgREST. Security definer so the service role
-- can ask without being granted anything on the auth schema; nobody else can
-- call it, so this is not an address-enumeration oracle.
create function public.email_is_registered(address text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from auth.users where lower(email) = lower(address))
$$;
revoke all on function public.email_is_registered(text) from public, anon, authenticated;
grant execute on function public.email_is_registered(text) to service_role;

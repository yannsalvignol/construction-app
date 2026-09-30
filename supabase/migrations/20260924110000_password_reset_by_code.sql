-- Forgotten passwords are reset with a code, like every other confirmation in
-- the app, rather than with a link that has to be opened on the right phone.
-- The codes live in the same table as an in-app change: same shape, same
-- lifetime, same attempt counting; only the caller differs, since here nobody
-- is signed in yet.
--
-- start-password-reset needs the account id for an address, and auth.users is
-- not served by PostgREST. Security definer, granted to the service role only,
-- so it cannot be used from a client to enumerate addresses.

create function public.user_id_for_email(address text)
returns uuid language sql security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(address) limit 1
$$;
revoke all on function public.user_id_for_email(text) from public, anon, authenticated;
grant execute on function public.user_id_for_email(text) to service_role;

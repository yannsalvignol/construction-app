-- The codes table has to live in a schema PostgREST serves, because the two
-- Edge Functions reach it with supabase-js rather than through an RPC (the
-- pattern the other private tables use). `private` is deliberately not exposed,
-- so the table moves to `public` and is closed there instead:
--
--   * RLS stays on and no policy is ever written, so no client can read a code,
--     wind back an attempt counter or move an expiry;
--   * the grants Supabase hands new public tables are revoked, so anon and
--     authenticated cannot even see it exists;
--   * the service role, which the Edge Functions use, bypasses both.

alter table private.email_verification_codes set schema public;

revoke all on public.email_verification_codes from public, anon, authenticated;

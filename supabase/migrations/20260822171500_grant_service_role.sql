-- ============================================================
-- Grant service_role access to profiles/companies
--
-- service_role bypasses RLS (it has BYPASSRLS), but RLS bypass and
-- SQL-level GRANTs are separate mechanisms in Postgres. Our earlier
-- migrations only granted table privileges to `authenticated`, so
-- the create-employee Edge Function (which talks to PostgREST as
-- service_role to create the employee's profile row) failed with
-- "permission denied for table profiles" even though RLS itself was
-- never the problem.
-- ============================================================

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.companies to service_role;

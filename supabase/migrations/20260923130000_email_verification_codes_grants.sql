-- The Edge Functions could not touch the table at all: service_role bypasses
-- RLS but not table privileges, and a table created in `private` and moved to
-- `public` never receives the default grants Supabase gives tables created
-- there. Granting it explicitly is also clearer than relying on those defaults.
--
-- anon and authenticated stay revoked (see the previous migration): no client
-- may read a code, wind back an attempt counter or move an expiry.

grant select, insert, update, delete on public.email_verification_codes to service_role;

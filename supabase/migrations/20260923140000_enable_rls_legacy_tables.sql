-- Two tables from the first schema were never carried into the presence model
-- and kept their creation-time state: no RLS, and for `zones` the grants
-- Supabase gives new public tables. Supabase's advisor flags both, and for
-- `zones` it is right — anyone holding the publishable key could read and
-- write it. Neither table is used by the app: zones has no reader and no
-- writer, and location_events is the old continuous-tracking log, already
-- revoked and kept only so historical rows are deleted with their account.
--
-- Closing them rather than dropping them: delete_own_account() and
-- delete_account_before_onboarding() still delete from location_events, and a
-- dropped table would make those functions fail.

alter table public.zones enable row level security;
alter table public.location_events enable row level security;

-- No policies: with RLS on and nothing allowed, both are unreachable from any
-- client key. The Edge Functions' service role bypasses RLS and keeps working.
revoke all on public.zones from public, anon, authenticated;
revoke all on public.location_events from public, anon, authenticated;

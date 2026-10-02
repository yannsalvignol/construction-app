-- A parse that dies leaves the devis unusable for ever.
--
-- The function guards against two parses at once by refusing to start when the
-- status is already 'parsing'. But a function killed mid-run — a long scan, a
-- wall-clock limit — leaves that status behind with nobody to clear it, and the
-- same guard then refuses every retry. The chef sees a spinner that never ends
-- and a retry button that politely says "already running".
--
-- Recording when the parse began turns that into something answerable: a parse
-- younger than the function could possibly still be running is protected, and
-- an older one is abandoned and may be restarted.
alter table public.site_quotes add column if not exists parsing_started_at timestamptz;

-- Quotes already stuck when this ships have no start time, so they would stay
-- stuck. They were abandoned by definition — nothing has been running since the
-- deploy — so they are released.
update public.site_quotes
  set status = 'failed',
      parse_error = 'La lecture a été interrompue. Relancez-la.'
  where status = 'parsing';

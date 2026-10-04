-- Where a reading has got to.
--
-- A parse that is killed writes nothing, so a devis stuck at "parsing" says
-- only that something went wrong somewhere between downloading the file and
-- storing three hundred lines. That is a wide somewhere, and it was being
-- narrowed by guesswork. Each stage now records itself as it starts, which
-- costs one small write and turns "it hangs" into "it hangs uploading".
--
-- It is for the chef too: "lecture en cours" and "relecture" are different
-- waits, and a ten-page scan is long enough that the difference matters.
alter table public.site_quotes
  add column if not exists parse_stage text;

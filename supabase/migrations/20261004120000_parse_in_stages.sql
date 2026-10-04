-- Reading a devis in stages, so a long one finishes at all.
--
-- A ten-page scan is read by looking at it, and a reading that comes back
-- short is read again. All of that happened inside one invocation, and
-- nothing was written until every pass had finished — so a devis that needed
-- three passes ran past the time an invocation is allowed, was killed
-- mid-sentence, and left the chef watching a spinner that would never stop.
-- Ten minutes, no lines, no error, nothing to retry from.
--
-- Each pass gets its own invocation now, and the lines are written at the end
-- of each one. The chef has a usable devis after the first pass and watches it
-- fill. What has to survive between passes is small: the file as OpenAI holds
-- it, so a second pass does not re-upload eleven megabytes, and the count of
-- passes already spent.
alter table public.site_quotes
  add column if not exists parse_file_ids text[],
  add column if not exists parse_passes integer not null default 0;

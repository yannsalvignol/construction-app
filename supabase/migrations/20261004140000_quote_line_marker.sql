-- The number the devis prints beside each line.
--
-- "A", "1", "1.1", "1.1.1" — most devis carry it in a column of its own, and
-- it states the structure outright. We were inferring that structure instead,
-- from where the headings sat and what the first word of a label looked like,
-- which works until a page is read on its own and the heading is on the page
-- before. Reading the number the document prints is both simpler and the
-- document's own answer.
alter table public.quote_lines
  add column if not exists marker text;

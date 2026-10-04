-- How a devis was read.
--
-- A PDF that carries its own text and a photograph of a devis arrive the same
-- way and nothing in the file name says which. They are now read differently —
-- the first hands over its figures exactly, the second has to be looked at —
-- and when a devis comes out wrong this is the first thing anybody needs to
-- know before guessing at why.
alter table public.site_quotes
  add column if not exists parse_source text
    check (parse_source is null or parse_source in ('text', 'image'));

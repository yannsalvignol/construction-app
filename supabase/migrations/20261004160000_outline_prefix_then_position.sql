-- Each line takes whichever rule explains it, rather than the whole devis
-- taking one rule because most of it looked a certain way.
--
-- Two devis, two ways of saying the same thing. One numbers its parts in a
-- column — A, 1, 1.1, 1.1.1 — where a line belongs to every heading whose
-- number is a prefix of its own. The other numbers its chapters "1-", "2-"
-- and letters their children "a-", "b-", where no prefix relates a child to
-- its parent and only the position does.
--
-- Choosing between them per document was the mistake: counting how many lines
-- carried a number said that the second devis was numbered too, so it took
-- the prefix rule, found no parent for anything, and collapsed from
-- twenty-seven parts to three. The number of lines that carry a marker says
-- nothing about whether those markers nest.
--
-- So each line asks the prefix question first and falls back to position when
-- the answer is empty. A devis that nests by number is read by number, one
-- that nests by position is read by position, and one that does both — a
-- numbered chapter with lettered children under it — is read correctly line
-- by line, which neither rule manages alone.

create or replace function public.quote_outline(quote uuid)
returns table (line_id uuid, path text[])
language sql
stable
security definer
set search_path = public
as $$
  with lotted as (
    select exists (
      select 1 from public.quote_lines l
      where l.quote_id = quote and nullif(btrim(coalesce(l.lot, '')), '') is not null
    ) as any_lot
  ),
  rows as (
    select
      l.*,
      coalesce(
        (select h.label from public.quote_lines h
          where h.quote_id = l.quote_id and h.kind = 'heading'
            and btrim(split_part(btrim(h.label), ' ', 1)) = btrim(coalesce(l.lot, ''))
            and btrim(h.label) <> btrim(coalesce(l.lot, ''))
          order by h.position limit 1),
        nullif(btrim(coalesce(l.lot, '')), ''),
        case when (select any_lot from lotted) then null else
          (select h.label from public.quote_lines h
            where h.quote_id = l.quote_id and h.kind = 'heading' and h.position < l.position
              and strpos(split_part(btrim(h.label), ' ', 1), '.') = 0
            order by h.position desc limit 1)
        end
      ) as section_label,
      case when public.quote_marker(l.label) is null then 1000
           else public.quote_rank(l.label) end as rank
    from public.quote_lines l
    where l.quote_id = quote and l.kind <> 'heading'
  )
  select
    r.id,
    array_remove(array[r.section_label], null) || coalesce(
      -- By the number the devis prints: "1.1.1" sits in "1.1", in "1". Cut at
      -- a dot, so "1" opens "1.1" and never "12". Nothing here depends on
      -- where a heading fell, so nothing is lost at a page break.
      nullif((
        select array_agg(h.label order by length(h.marker), h.position)
        from public.quote_lines h
        where h.quote_id = r.quote_id and h.kind = 'heading'
          and r.section_label is not null
          and nullif(btrim(coalesce(h.marker, '')), '') is not null
          and nullif(btrim(coalesce(r.marker, '')), '') is not null
          and h.marker <> r.marker
          and (r.marker || '.') like (h.marker || '.%')
          and h.lot is not distinct from r.lot
          and btrim(h.label) is distinct from btrim(coalesce(r.section_label, ''))
      ), '{}'::text[]),
      -- By position: a heading opens a part and the next heading of the same
      -- or shallower rank closes it. The rule for a devis whose children are
      -- lettered under numbered parents, where no prefix relates them.
      (
        select array_agg(h.label order by h.position)
        from public.quote_lines h
        where h.quote_id = r.quote_id and h.kind = 'heading'
          and h.position < r.position
          and h.lot is not distinct from r.lot
          and r.section_label is not null
          and btrim(h.label) is distinct from btrim(coalesce(r.section_label, ''))
          and btrim(split_part(btrim(h.label), ' ', 1)) is distinct from btrim(coalesce(r.lot, ''))
          and public.quote_rank(h.label) < r.rank
          and not exists (
            select 1 from public.quote_lines shut
            where shut.quote_id = r.quote_id and shut.kind = 'heading'
              and shut.lot is not distinct from r.lot
              and shut.position > h.position and shut.position < r.position
              and public.quote_rank(shut.label) <= public.quote_rank(h.label)
          )
      ),
      '{}'::text[]
    )
  from rows r
  order by r.position;
$$;
revoke all on function public.quote_outline(uuid) from public, anon, authenticated;

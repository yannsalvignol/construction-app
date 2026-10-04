-- The structure the devis prints, rather than the structure we inferred.
--
-- A devis numbers its parts in a column of its own — A, 1, 1.1, 1.1.1 — and
-- that column says outright what sits inside what. We were reconstructing it
-- from where the headings fell and what the first word of each label looked
-- like. That holds while the whole document is read at once; it stops holding
-- when a page is read on its own and the heading that opens the chapter was
-- printed on the page before.
--
-- So the path is built from the printed number where the devis gives one: a
-- line belongs to every heading whose number is a prefix of its own. "1.1.1"
-- sits in "1.1", which sits in "1", which sits in the lot. No positions, no
-- guessing, nothing lost at a page break.
--
-- The old rule stays for devis that number nothing in a column: a heading
-- opens a part and the next heading of the same or shallower rank closes it.
-- It reads "1- UNITE EXTERIEURE DRV" with its lettered variants correctly,
-- and that devis exists too.

create or replace function public.quote_outline(quote uuid)
returns table (line_id uuid, path text[])
language sql
stable
security definer
set search_path = public
as $$
  with lotted as (
    select
      exists (
        select 1 from public.quote_lines l
        where l.quote_id = quote and nullif(btrim(coalesce(l.lot, '')), '') is not null
      ) as any_lot,
      -- Only trust the printed numbers when the reading actually captured
      -- them: half a column of markers is worse than none.
      (
        select count(*) filter (where nullif(btrim(coalesce(l.marker, '')), '') is not null)::numeric
             / greatest(count(*), 1)
        from public.quote_lines l where l.quote_id = quote
      ) >= 0.8 as numbered
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
    array_remove(array[r.section_label], null) || coalesce((
      select array_agg(h.label order by length(h.marker), h.position)
      from public.quote_lines h
      where h.quote_id = r.quote_id and h.kind = 'heading'
        and r.section_label is not null
        and (select numbered from lotted)
        and nullif(btrim(coalesce(h.marker, '')), '') is not null
        and nullif(btrim(coalesce(r.marker, '')), '') is not null
        -- A heading whose number is a strict prefix of this line's, cut at a
        -- dot so that "1" opens "1.1" but never "12".
        and h.marker <> r.marker
        and (r.marker || '.') like (h.marker || '.%')
        and h.lot is not distinct from r.lot
        and btrim(h.label) is distinct from btrim(coalesce(r.section_label, ''))
    ), '{}'::text[]) || coalesce((
      -- The positional rule, for a devis that numbers nothing in a column.
      select array_agg(h.label order by h.position)
      from public.quote_lines h
      where h.quote_id = r.quote_id and h.kind = 'heading'
        and not (select numbered from lotted)
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
    ), '{}'::text[])
  from rows r
  order by r.position;
$$;
revoke all on function public.quote_outline(uuid) from public, anon, authenticated;

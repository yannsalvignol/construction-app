-- A line outside the sections belongs to none of them.
--
-- A devis that divides itself into lots still prints rows that sit outside
-- them: a commercial discount at the foot, a global total. Those rows carry no
-- lot, and the outline was giving them the nearest heading above — so this
-- devis filed its "REMISE COMMERCIALE" under "21- RADIATEURS", the last
-- chapter it happened to follow.
--
-- The fallback it was using exists for a different document: one with no lots
-- at all, where the headings are the only division there is. So it is kept for
-- exactly that case and withheld from the other, which is the difference
-- between a line nobody filed and a line filed wrongly.

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
        -- Only where the devis names no lots anywhere. Where it does, a row
        -- without one is outside them on purpose.
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
    ), '{}'::text[])
  from rows r
  order by r.position;
$$;
revoke all on function public.quote_outline(uuid) from public, anon, authenticated;

-- Group a worker's devis lines under the section they are printed in.
--
-- The lines carried a "lot" of "A", "B", "C" — the devis's own numbering, not
-- its words — so the task screen offered folders called A and B. The names are
-- there and always were: a devis prints "A Courant fort" and "1 Poste de
-- transformation client" as heading rows, which this function filtered out
-- because they are not work.
--
-- Each work line now carries the heading its own lot marker names: lot "A"
-- finds the row printed "A Courant fort". That is the level the devis divides
-- itself into and the level a worker asks for — "B Courant fort chambres et
-- suites" rather than the sub-section he happens to be standing in, which tells
-- him nothing about where on the chantier he is.
--
-- Computed from the rows already stored, so a devis imported before this groups
-- correctly without being read again. Dropped rather than replaced: the
-- returned row gains a column.
drop function if exists public.day_quote_lines(uuid);

create function public.day_quote_lines(day_id uuid)
returns table (
  line_id uuid,
  lot text,
  section text,
  label text,
  unit text,
  quoted numeric,
  declared_total numeric,
  declared_today numeric,
  steps jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.lot,
    -- The heading row the lot is the marker of: lot "A" names the heading whose
    -- own number is "A", which is the row printed "A Courant fort". That is the
    -- level the devis is divided into, and the level a worker asks for — not
    -- the nearest heading above, which would be the sub-section he is standing
    -- in and tells him nothing about where on the chantier he is.
    coalesce(
      (select h.label from public.quote_lines h
        where h.quote_id = l.quote_id and h.kind = 'heading'
          and btrim(split_part(btrim(h.label), ' ', 1)) = btrim(coalesce(l.lot, ''))
        order by h.position limit 1),
      -- No row carries that marker: fall back to the nearest top-level heading
      -- above the line, then to the marker alone, so nothing loses its grouping.
      (select h.label from public.quote_lines h
        where h.quote_id = l.quote_id and h.kind = 'heading' and h.position < l.position
          and strpos(split_part(btrim(h.label), ' ', 1), '.') = 0
        order by h.position desc limit 1),
      l.lot
    ),
    l.label,
    l.unit,
    l.quantity,
    coalesce((select sum(x.quantity) from public.task_declarations x where x.quote_line_id = l.id), 0),
    coalesce((
      select sum(x.quantity) from public.task_declarations x
      where x.quote_line_id = l.id and x.work_day_id = day_id
    ), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'step_id', st.id,
        'label', st.label,
        'done', st.done_at is not null,
        'done_by_name', case
          when st.done_at is null or st.done_by = auth.uid() then null
          else (select trim(p.first_name || ' ' || p.last_name) from public.profiles p where p.id = st.done_by)
        end
      ) order by st.position)
      from public.quote_line_steps st where st.quote_line_id = l.id
    ), '[]'::jsonb)
  from public.work_days d
  join public.site_quotes q on q.site_id = d.site_id and q.status = 'validated'
  join public.quote_lines l on l.quote_id = q.id and l.kind = 'work'
  where d.id = day_id
    and d.employee_id = auth.uid()
  order by l.position;
$$;

revoke all on function public.day_quote_lines(uuid) from public, anon;
grant execute on function public.day_quote_lines(uuid) to authenticated;

-- Group a worker's devis lines under the section they are printed in.
--
-- The lines carried a "lot" of "A", "B", "C" — the devis's own numbering, not
-- its words — so the task screen offered folders called A and B. The names are
-- there and always were: a devis prints "A Courant fort" and "1 Poste de
-- transformation client" as heading rows, which this function filtered out
-- because they are not work.
--
-- Each work line now carries the heading it falls under. The top of the
-- numbering is preferred — "1 Poste de transformation client" over "1.1
-- Cellules MT étanches" — because a worker looks for the part of the chantier
-- he is on, and the deepest heading is often four lines long. Dropped rather
-- than replaced: the returned row gains a column.
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
    -- The nearest heading above it whose number has no dot: the section, not
    -- the sub-sub-section. Falls back to any heading above it, then to the lot,
    -- so a devis written without headings still groups by something.
    coalesce(
      (select h.label from public.quote_lines h
        where h.quote_id = l.quote_id and h.kind = 'heading' and h.position < l.position
          and strpos(split_part(btrim(h.label), ' ', 1), '.') = 0
        order by h.position desc limit 1),
      (select h.label from public.quote_lines h
        where h.quote_id = l.quote_id and h.kind = 'heading' and h.position < l.position
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

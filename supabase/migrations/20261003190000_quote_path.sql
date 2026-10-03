-- However deep the devis goes, not two levels deep.
--
-- The previous version returned a chapter and a sub-chapter: two columns and
-- a test for "numbered three deep or more". That is a guess about documents we
-- have not seen. A devis numbered 1.1.1.1 exists, and under that rule its
-- fourth level simply vanished.
--
-- So the line carries its path instead — the lot, then every heading whose
-- printed number is a prefix of the line's own, in the order they appear. One
-- level or five, the answer has the same shape and the screen draws whatever
-- comes back.
--
-- What is assumed, and all that is assumed: that a devis which divides itself
-- numbers its parts, and separates the levels of that numbering with dots.
-- One that does not — "1- POSE LAVABO", "Lot 3", no numbers at all — matches
-- no heading, comes back with a path of one, and reads as a flat list under
-- its lot, exactly as it did before any of this.

drop function if exists public.day_quote_lines(uuid);

create function public.day_quote_lines(day_id uuid)
returns table (
  line_id uuid,
  lot text,
  section text,
  /** The lot, then each heading the line sits under, outermost first. */
  path text[],
  label text,
  unit text,
  quoted numeric,
  declared_total numeric,
  declared_today numeric,
  mine boolean,
  assigned boolean,
  steps jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with lines as (
    select
      l.*,
      d.id as day,
      -- The lot's own title. Three shapes, oldest first: a devis read before
      -- the parser kept the name has only the marker in lot, and the name on
      -- the heading carrying it; a devis read since has the name in lot
      -- itself; one with no lot at all falls back to the nearest unnumbered
      -- heading above.
      coalesce(
        (select h.label from public.quote_lines h
          where h.quote_id = l.quote_id and h.kind = 'heading'
            and btrim(split_part(btrim(h.label), ' ', 1)) = btrim(coalesce(l.lot, ''))
            and btrim(h.label) <> btrim(coalesce(l.lot, ''))
          order by h.position limit 1),
        nullif(btrim(coalesce(l.lot, '')), ''),
        (select h.label from public.quote_lines h
          where h.quote_id = l.quote_id and h.kind = 'heading' and h.position < l.position
            and strpos(split_part(btrim(h.label), ' ', 1), '.') = 0
          order by h.position desc limit 1)
      ) as section_label,
      string_to_array(coalesce(public.quote_marker(l.label), ''), '.') as marker
    from public.work_days d
    join public.site_quotes q on q.site_id = d.site_id and q.status = 'validated'
    join public.quote_lines l on l.quote_id = q.id and l.kind = 'work'
    where d.id = day_id and d.employee_id = auth.uid()
  )
  select
    l.id,
    l.lot,
    l.section_label,
    -- Every proper prefix of the line's number that names a heading of this
    -- lot. Scoped to the lot because lots A and B each have a chapter "1",
    -- and matching on the number alone files B's cables under A's.
    array_remove(array[l.section_label], null) || coalesce((
      select array_agg(found.label order by found.position)
      from generate_series(1, greatest(coalesce(array_length(l.marker, 1), 1) - 1, 0)) as depth(n)
      join lateral (
        select h.label, h.position
        from public.quote_lines h
        where h.quote_id = l.quote_id and h.kind = 'heading'
          and h.lot is not distinct from l.lot
          and btrim(split_part(btrim(h.label), ' ', 1))
              = array_to_string(l.marker[1:depth.n], '.')
          and btrim(h.label) is distinct from btrim(l.section_label)
        order by h.position limit 1
      ) found on true
    ), '{}'::text[]),
    l.label,
    l.unit,
    l.quantity,
    coalesce((select sum(x.quantity) from public.task_declarations x where x.quote_line_id = l.id), 0),
    coalesce((
      select sum(x.quantity) from public.task_declarations x
      where x.quote_line_id = l.id and x.work_day_id = l.day
    ), 0),
    exists (
      select 1 from public.quote_assignments a
      where a.employee_id = auth.uid()
        and (a.quote_line_id = l.id
             or a.step_id in (select st.id from public.quote_line_steps st where st.quote_line_id = l.id))
    ),
    exists (
      select 1 from public.quote_assignments a
      where a.quote_line_id = l.id
         or a.step_id in (select st.id from public.quote_line_steps st where st.quote_line_id = l.id)
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'step_id', st.id,
        'label', st.label,
        'done', st.done_at is not null,
        'done_by_name', case
          when st.done_at is null or st.done_by = auth.uid() then null
          else (select trim(p.first_name || ' ' || p.last_name) from public.profiles p where p.id = st.done_by)
        end,
        'mine', exists (
          select 1 from public.quote_assignments a
          where a.step_id = st.id and a.employee_id = auth.uid()
        ),
        'assigned', exists (select 1 from public.quote_assignments a where a.step_id = st.id)
      ) order by st.position)
      from public.quote_line_steps st where st.quote_line_id = l.id
    ), '[]'::jsonb)
  from lines l
  order by l.position;
$$;

revoke all on function public.day_quote_lines(uuid) from public, anon;
grant execute on function public.day_quote_lines(uuid) to authenticated;

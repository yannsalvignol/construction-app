-- Grouping by where the headings are, not by how they are numbered.
--
-- The prefix rule read one devis well and another not at all. A devis in this
-- very database numbers its parts "1-", "2-", "10-" and their variants "a-",
-- "b-"; nothing there is a prefix of anything, so its twenty-three headings
-- fell out of the tree and sat loose among the lines they were meant to open.
-- Assuming one numbering scheme is assuming one devis.
--
-- A heading opens a part and the next heading of the same or shallower rank
-- closes it — the rule every printed document follows, whatever it numbers
-- its parts with. Numbering is used for one thing only: rank. A dotted number
-- is as deep as it has parts, so "1.1" is rank 2; anything else is rank 1, a
-- divider at the top of its lot. A line is placed inside every heading still
-- open above it that is shallower than the line's own rank, so "3- RESEAUX"
-- stands beside "2- UNITE INTERIEURE" rather than inside it, while "a- Pf 14
-- kw", which numbers nothing, sits inside whatever is open.
--
-- A devis with no headings at all comes back as one flat list under its lot,
-- exactly as it always did.

/** How deep a row's printed number goes. 1.1.1 is three; "7-" and "a-" are one. */
create or replace function public.quote_rank(label text)
returns integer language sql immutable set search_path = '' as $$
  select coalesce(
    array_length(string_to_array(public.quote_marker(label), '.'), 1),
    1)
$$;
grant execute on function public.quote_rank(text) to authenticated;

drop function if exists public.day_quote_lines(uuid);

create function public.day_quote_lines(day_id uuid)
returns table (
  line_id uuid,
  lot text,
  section text,
  /** The lot, then each heading still open above the line, outermost first. */
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
      -- The lot's own title. Three shapes, oldest first: the marker in lot and
      -- the name on the heading carrying it; the name in lot itself; no lot at
      -- all, where the nearest unnumbered heading above has to serve.
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
      -- A line that numbers nothing belongs inside whatever is open, so it is
      -- treated as deeper than any heading can be.
      case when public.quote_marker(l.label) is null then 1000
           else public.quote_rank(l.label) end as rank
    from public.work_days d
    join public.site_quotes q on q.site_id = d.site_id and q.status = 'validated'
    join public.quote_lines l on l.quote_id = q.id and l.kind = 'work'
    where d.id = day_id and d.employee_id = auth.uid()
  )
  select
    l.id,
    l.lot,
    l.section_label,
    array_remove(array[l.section_label], null) || coalesce((
      select array_agg(h.label order by h.position)
      from public.quote_lines h
      where h.quote_id = l.quote_id and h.kind = 'heading'
        and h.position < l.position
        and h.lot is not distinct from l.lot
        -- Not the lot's own title: that is already the first step of the path.
        and btrim(h.label) is distinct from btrim(coalesce(l.section_label, ''))
        and btrim(split_part(btrim(h.label), ' ', 1)) is distinct from btrim(coalesce(l.lot, ''))
        and public.quote_rank(h.label) < l.rank
        -- Still open: no heading between it and the line closes it.
        and not exists (
          select 1 from public.quote_lines shut
          where shut.quote_id = l.quote_id and shut.kind = 'heading'
            and shut.lot is not distinct from l.lot
            and shut.position > h.position and shut.position < l.position
            and public.quote_rank(shut.label) <= public.quote_rank(h.label)
        )
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

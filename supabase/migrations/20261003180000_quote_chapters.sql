-- The devis has three levels; the worker's list showed one.
--
-- A real devis is numbered the way a book is: "A Courant fort" holds "1 Poste
-- de transformation client", which holds "1.1 Cellules MT étanches", which
-- holds the four cellule lines. Flattening that into one list per lot gives a
-- card with a hundred and forty lines in it, which is the three-hundred-line
-- scroll the cards were meant to break up.
--
-- The levels are already in the document and already read: every heading is
-- stored with its own printed number, and every line's label begins with
-- hers. So this is a matter of saying which heading a line sits under, at each
-- depth, rather than of parsing anything new.
--
-- A devis that does not number itself this way — "1- POSE LAVABO" under a lot
-- with no numbered chapters — matches no heading and comes back with nulls,
-- so it reads exactly as it did before.

/** The printed number a line or heading begins with: 1.1.1, 4.12, A. */
create or replace function public.quote_marker(label text)
returns text language sql immutable set search_path = '' as $$
  select nullif(substring(btrim(label) from '^([0-9]+(\.[0-9]+)*)'), '')
$$;
grant execute on function public.quote_marker(text) to authenticated;

drop function if exists public.day_quote_lines(uuid);

create function public.day_quote_lines(day_id uuid)
returns table (
  line_id uuid,
  lot text,
  section text,
  -- "1 Poste de transformation client", then "1.1 Cellules MT étanches".
  -- Null when the devis has no such level, which is most small devis.
  chapter text,
  sub_chapter text,
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
      -- The lot's own title: the level the chantier is divided into, and the
      -- level a worker asks for.
      --
      -- Three shapes, oldest first. A devis read before the parser kept the
      -- lot's name has only its marker — "A" — and the name is on the heading
      -- carrying that marker. A devis read since has the name in lot itself,
      -- where the heading's own label is the bare marker; that one was being
      -- mislabelled, because the marker lookup missed and the fallback took
      -- the nearest numbered heading above, so every line of lot A was filed
      -- under "1 Poste de transformation client" rather than under A.
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
      public.quote_marker(l.label) as marker
    from public.work_days d
    join public.site_quotes q on q.site_id = d.site_id and q.status = 'validated'
    join public.quote_lines l on l.quote_id = q.id and l.kind = 'work'
    where d.id = day_id and d.employee_id = auth.uid()
  )
  select
    l.id,
    l.lot,
    l.section_label,
    -- Scoped to the line's own lot: lots A and B each have a chapter "1", and
    -- matching on the number alone would file B's cables under A's.
    (select h.label from public.quote_lines h
      where h.quote_id = l.quote_id and h.kind = 'heading'
        and h.lot is not distinct from l.lot
        and btrim(split_part(btrim(h.label), ' ', 1)) = split_part(l.marker, '.', 1)
        and h.label is distinct from l.section_label
      order by h.position limit 1),
    -- Only for a line numbered three deep: "1.2" sits directly under chapter
    -- 1, beside sub-chapter "1.1", exactly as it is printed.
    case when array_length(string_to_array(coalesce(l.marker, ''), '.'), 1) >= 3 then
      (select h.label from public.quote_lines h
        where h.quote_id = l.quote_id and h.kind = 'heading'
          and h.lot is not distinct from l.lot
          and btrim(split_part(btrim(h.label), ' ', 1))
              = split_part(l.marker, '.', 1) || '.' || split_part(l.marker, '.', 2)
        order by h.position limit 1)
    end,
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

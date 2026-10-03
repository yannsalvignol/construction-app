-- Giving a man a part of the devis, not a line at a time.
--
-- A chef hands out work by the part: "Youssef takes courant fort chambres,
-- Hicham the chemins de câbles". Tapping a hundred and forty lines to say so
-- is not handing out work, it is data entry, and nobody will do it twice.
--
-- A part is identified by its path — the lot, then each heading it sits under.
-- Not by the heading's own row: four of the ninety-one lots in this database
-- have no heading row of their own, their name living only in the lot column,
-- and those parts would have been the ones a chef could not give away.
--
-- The path has to mean the same thing on both screens, so it is computed in
-- one place from here on. The chef's screen was building its own in
-- TypeScript beside this one in SQL; two implementations of one rule is a
-- divergence waiting for a devis odd enough to find it.

/**
 * Every line of a devis with the part it belongs to.
 *
 * A heading opens a part and the next heading of the same or shallower rank
 * closes it, which is the rule a printed document follows whatever it numbers
 * its parts with. Rank comes from the numbering and nothing else: a dotted
 * number is as deep as it has parts, anything else is a divider at the top of
 * its lot. A row goes inside every heading still open above it that is
 * shallower than its own rank.
 *
 * Headings are not returned: a heading is a part, and a part is the path.
 */
create or replace function public.quote_outline(quote uuid)
returns table (line_id uuid, path text[])
language sql
stable
security definer
set search_path = public
as $$
  with rows as (
    select
      l.*,
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

-- Readable by the company that owns the devis, and by nobody else: it is the
-- devis's own shape, and the review screen reads it directly.
create or replace function public.quote_outline_for(quote uuid)
returns table (line_id uuid, path text[])
language sql
stable
security definer
set search_path = public
as $$
  select o.* from public.quote_outline(quote) o
  where exists (
    select 1 from public.site_quotes q
    where q.id = quote and q.company_id = public.current_profile_company_id()
  );
$$;
revoke all on function public.quote_outline(uuid) from public, anon, authenticated;
revoke all on function public.quote_outline_for(uuid) from public, anon;
grant execute on function public.quote_outline_for(uuid) to authenticated;

-- A third kind of target, beside a line and one of its operations.
alter table public.quote_assignments
  add column quote_id uuid references public.site_quotes(id) on delete cascade,
  add column path text[];

alter table public.quote_assignments drop constraint quote_assignments_one_target;
alter table public.quote_assignments add constraint quote_assignments_one_target
  check (num_nonnulls(quote_line_id, step_id, path) = 1 and (path is null) = (quote_id is null));

create unique index quote_assignments_part_unique
  on public.quote_assignments (quote_id, path, employee_id) where path is not null;

-- Replaced rather than overloaded: a four-argument call would match both
-- signatures and Postgres refuses to choose.
drop function if exists public.set_quote_assignment(uuid, uuid, uuid, boolean);

/**
 * Puts an employee on a line, on one of its operations, or on a whole part of
 * the devis — and takes them off again.
 *
 * A part is given as its path, so it keeps meaning the same thing when the
 * devis gains a line: a man given "A Courant fort › 4 Câbles électriques" has
 * been given that part of the chantier, not the fourteen lines it held the day
 * he was told.
 */
create or replace function public.set_quote_assignment(
  line uuid default null,
  step uuid default null,
  employee uuid default null,
  assigned boolean default null,
  quote uuid default null,
  part text[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  worker public.profiles;
  target_company uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role <> 'chef' then
    raise exception 'Only a chef can hand out work';
  end if;
  if assigned is null then raise exception 'Say whether the work is theirs'; end if;
  if num_nonnulls(line, step, part) <> 1 then
    raise exception 'Name a line, an operation or a part, not several';
  end if;
  if (part is null) <> (quote is null) then
    raise exception 'A part of a devis needs the devis it is part of';
  end if;
  if part is not null and coalesce(array_length(part, 1), 0) = 0 then
    raise exception 'A part needs a name';
  end if;

  select * into worker from public.profiles where id = employee;
  if not found or worker.company_id <> me.company_id then
    raise exception 'That employee is not in your company';
  end if;
  if assigned and not worker.is_active then
    raise exception 'That account is closed';
  end if;

  if part is not null then
    select q.company_id into target_company from public.site_quotes q where q.id = quote;
  elsif line is not null then
    select q.company_id into target_company
    from public.quote_lines l join public.site_quotes q on q.id = l.quote_id
    where l.id = line;
  else
    select q.company_id into target_company
    from public.quote_line_steps st
    join public.quote_lines l on l.id = st.quote_line_id
    join public.site_quotes q on q.id = l.quote_id
    where st.id = step;
  end if;
  if target_company is null or target_company <> me.company_id then
    raise exception 'That task does not belong to your company';
  end if;

  if assigned then
    insert into public.quote_assignments
      (company_id, quote_line_id, step_id, quote_id, path, employee_id, assigned_by)
    values (me.company_id, line, step, quote, part, employee, me.id)
    on conflict do nothing;
  else
    delete from public.quote_assignments a
    where a.employee_id = employee
      and a.quote_line_id is not distinct from line
      and a.step_id is not distinct from step
      and a.path is not distinct from part;
  end if;
end $$;

revoke all on function public.set_quote_assignment(uuid, uuid, uuid, boolean, uuid, text[]) from public, anon;
grant execute on function public.set_quote_assignment(uuid, uuid, uuid, boolean, uuid, text[]) to authenticated;

/**
 * Whether a line is expected of somebody — and of whom.
 *
 * Three routes, and the third is the new one: the line itself, one of its
 * operations, or a part of the devis it sits inside. A path is a prefix of the
 * line's own, so giving away "A Courant fort" gives away everything under it,
 * including whatever the next reading of the devis adds.
 *
 * `who` null asks whether anybody has it at all, which is what tells an
 * unassigned line — open to whoever gets there — from one that is somebody
 * else's.
 */
create or replace function public.line_is_for(line uuid, line_path text[], who uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.quote_assignments a
    where (who is null or a.employee_id = who)
      and (
        a.quote_line_id = line
        or a.step_id in (select st.id from public.quote_line_steps st where st.quote_line_id = line)
        or (a.path is not null
            and coalesce(array_length(a.path, 1), 0) > 0
            and coalesce(array_length(line_path, 1), 0) >= array_length(a.path, 1)
            and line_path[1:array_length(a.path, 1)] = a.path)
      )
  )
$$;
revoke all on function public.line_is_for(uuid, text[], uuid) from public, anon;
grant execute on function public.line_is_for(uuid, text[], uuid) to authenticated, service_role;

-- The worker's list, where a part given to him makes every line under it his.
drop function if exists public.day_quote_lines(uuid);

create function public.day_quote_lines(day_id uuid)
returns table (
  line_id uuid,
  lot text,
  section text,
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
  select
    l.id,
    l.lot,
    o.path[1],
    o.path,
    l.label,
    l.unit,
    l.quantity,
    coalesce((select sum(x.quantity) from public.task_declarations x where x.quote_line_id = l.id), 0),
    coalesce((
      select sum(x.quantity) from public.task_declarations x
      where x.quote_line_id = l.id and x.work_day_id = d.id
    ), 0),
    public.line_is_for(l.id, o.path, auth.uid()),
    public.line_is_for(l.id, o.path, null),
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
  from public.work_days d
  join public.site_quotes q on q.site_id = d.site_id and q.status = 'validated'
  join public.quote_lines l on l.quote_id = q.id and l.kind = 'work'
  join public.quote_outline(q.id) o on o.line_id = l.id
  where d.id = day_id and d.employee_id = auth.uid()
  order by l.position;
$$;

revoke all on function public.day_quote_lines(uuid) from public, anon;
grant execute on function public.day_quote_lines(uuid) to authenticated;

-- What is waiting for him on each chantier, counted the same way.
--
-- Lines rather than assignments: one part handed over is one row in
-- quote_assignments and forty lines of work, and "1 tâche vous y attend" for
-- a fortnight's work is worse than saying nothing.
create or replace function public.employee_workspace()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; d public.work_days; today date; gap interval; tail integer; day_open boolean;
begin
 select * into p from public.profiles where id = auth.uid();
 if p.role is distinct from 'employee' then raise exception 'Employee account required'; end if;
 select (now() at time zone time_zone)::date into today from public.companies where id = p.company_id;
 select * into d from public.work_days where employee_id = p.id
   and (work_date = today or (ended_at is null and planned_end_at > now())) order by started_at desc limit 1;
 day_open := d.id is not null and d.ended_at is null and d.planned_end_at > now();

 tail := 0;
 if day_open and d.last_sample_at is not null and d.last_sample_inside is not null then
   gap := least(now(), d.planned_end_at) - d.last_sample_at;
   if gap > interval '0' and gap <= public.max_attributed_gap() then
     tail := extract(epoch from gap)::integer;
   end if;
 end if;

 return jsonb_build_object(
   'server_time', now(), 'date', today,
   'day', case when d.id is null then null else
     to_jsonb(d) || jsonb_build_object(
       'seconds_inside', d.seconds_inside + case when coalesce(d.last_sample_inside, false) then tail else 0 end,
       'seconds_outside', d.seconds_outside + case when coalesce(d.last_sample_inside, true) then 0 else tail end
     ) end,
   'consent', (select to_jsonb(c) from public.presence_consents c where employee_id = p.id),
   'location_mode', p.location_mode,
   'live_consent', (select to_jsonb(c) from public.live_location_consents c where employee_id = p.id),
   'lone_worker_watch', p.lone_worker_watch,
   'lone_worker_asked', day_open and coalesce(
     (select w.asked_at is not null from public.lone_worker_watches w where w.work_day_id = d.id), false),
   'sites', coalesce((
     select jsonb_agg(
       to_jsonb(s) || jsonb_build_object('awaiting', (
         select count(*)
         from public.site_quotes q
         join public.quote_lines l on l.quote_id = q.id and l.kind = 'work'
         join public.quote_outline(q.id) o on o.line_id = l.id
         where q.site_id = s.id and q.status = 'validated'
           and public.line_is_for(l.id, o.path, p.id)
           -- Finished work is waiting for nobody: the quoted quantity reached,
           -- or every operation on the line ticked.
           and (
             l.quantity is null
             or coalesce((select sum(x.quantity) from public.task_declarations x
                          where x.quote_line_id = l.id), 0) < l.quantity
           )
           -- A line broken into operations is finished when none is left,
           -- which is how a line the devis put no figure against gets done.
           and not (
             exists (select 1 from public.quote_line_steps st where st.quote_line_id = l.id)
             and not exists (
               select 1 from public.quote_line_steps st
               where st.quote_line_id = l.id and st.done_at is null
             )
           )
       ))
       order by s.name)
     from public.sites s where company_id = p.company_id and is_active), '[]'::jsonb),
   'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.due_at) from public.presence_requests r where work_day_id = d.id and due_at <= now() and cancelled_at is null), '[]'::jsonb),
   'checks', coalesce((select jsonb_agg(to_jsonb(c)) from public.presence_check_ins c join public.presence_requests r on r.id = c.request_id where r.work_day_id = d.id), '[]'::jsonb),
   'declarations', coalesce((select jsonb_agg(to_jsonb(t)) from public.task_declarations t where work_day_id = d.id), '[]'::jsonb),
   'categories', coalesce((select jsonb_agg(to_jsonb(c) order by sort_order) from public.task_categories c), '[]'::jsonb),
   'codes', coalesce((select jsonb_agg(to_jsonb(c) order by sort_order) from public.task_codes c where is_active), '[]'::jsonb)
 );
end $$;

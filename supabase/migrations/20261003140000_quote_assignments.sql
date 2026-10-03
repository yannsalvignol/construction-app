-- Who is expected to do what, and getting rid of what nobody should do.
--
-- A validated devis is the whole chantier: three hundred lines, every one of
-- them shown to every worker who starts a day on the site. That is a catalogue,
-- not an instruction. A chef hands out work — "Youssef does the poste, Hicham
-- the chemins de câbles" — and until now the app had no word for it, so the
-- handing out happened on the phone and the app showed everyone everything.
--
-- An assignment hangs off a line or off one of its operations, never both at
-- once. The finer grain is the point: "fixer" and "câbler les asservissements"
-- on the same poste are often two trades and two days.
--
-- Nothing is restricted by an assignment. A worker still sees the devis and may
-- still tick anything on his chantier: a crew covers for each other, and an app
-- that refuses a tick because the chef typed a name on Monday would be lying
-- about what happened. Assignment says what is expected, not what is permitted.
--
-- Deleting comes in the same migration because it is the other half of the same
-- complaint: the reading proposes operations that are sometimes wrong for the
-- line, and a chef who can hand out work must also be able to strike out what
-- should not be done at all.

create table public.quote_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Exactly one of the two: an assignment is on the line or on one operation.
  quote_line_id uuid references public.quote_lines(id) on delete cascade,
  step_id uuid references public.quote_line_steps(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  constraint quote_assignments_one_target check (num_nonnulls(quote_line_id, step_id) = 1)
);

create unique index quote_assignments_line_unique
  on public.quote_assignments (quote_line_id, employee_id) where quote_line_id is not null;
create unique index quote_assignments_step_unique
  on public.quote_assignments (step_id, employee_id) where step_id is not null;
create index quote_assignments_employee_idx on public.quote_assignments (employee_id);

alter table public.quote_assignments enable row level security;
grant select on public.quote_assignments to authenticated;

-- Read by the whole company: the chef to see who he has put where, the worker
-- to see that a line is somebody's even when it is not his. Written only
-- through set_quote_assignment, which checks the caller is a chef.
create policy quote_assignments_read on public.quote_assignments for select to authenticated
  using (company_id = public.current_profile_company_id());

/**
 * Puts an employee on a line or on one of its operations, or takes them off.
 *
 * Idempotent in both directions: assigning twice is not an error, and nor is
 * removing somebody who was never there. A chef flipping a row of names on a
 * slow connection should not be told off for a double tap.
 */
create or replace function public.set_quote_assignment(
  line uuid,
  step uuid,
  employee uuid,
  assigned boolean
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
  if num_nonnulls(line, step) <> 1 then
    raise exception 'Name a line or an operation, not both';
  end if;

  select * into worker from public.profiles where id = employee;
  if not found or worker.company_id <> me.company_id then
    raise exception 'That employee is not in your company';
  end if;
  -- A closed account keeps the assignments it already had, so last month's
  -- record stays readable; it just stops being given new work.
  if assigned and not worker.is_active then
    raise exception 'That account is closed';
  end if;

  if line is not null then
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
    insert into public.quote_assignments (company_id, quote_line_id, step_id, employee_id, assigned_by)
    values (me.company_id, line, step, employee, me.id)
    on conflict do nothing;
  else
    delete from public.quote_assignments a
    where a.employee_id = employee
      and a.quote_line_id is not distinct from line
      and a.step_id is not distinct from step;
  end if;
end $$;

revoke all on function public.set_quote_assignment(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.set_quote_assignment(uuid, uuid, uuid, boolean) to authenticated;

/**
 * Strikes an operation off a line.
 *
 * The operations are proposed by a model reading the devis, and some of them
 * are wrong for the line they hang off. One that has been ticked is not
 * proposed any more — it is a record of work done, by a named person on a named
 * day — so it is kept and the chef is told why.
 */
create or replace function public.delete_quote_line_step(step uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  s public.quote_line_steps;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role <> 'chef' then
    raise exception 'Only a chef can delete an operation';
  end if;

  select st.* into s from public.quote_line_steps st where st.id = step for update;
  if not found or s.company_id <> me.company_id then
    raise exception 'That operation does not exist';
  end if;
  if s.done_at is not null then
    raise exception 'That operation is already done; it cannot be deleted';
  end if;

  delete from public.quote_line_steps where id = step;
end $$;

revoke all on function public.delete_quote_line_step(uuid) from public, anon;
grant execute on function public.delete_quote_line_step(uuid) to authenticated;

/**
 * Strikes a line off the devis, with its operations.
 *
 * A line that has been declared against is not deleted: the quantities booked
 * on it are work somebody did and hours somebody was paid for, and deleting the
 * line would leave them pointing at nothing. The chef is told to set the line
 * to zero instead, which is the honest version of the same intention.
 *
 * The devis's own stated total is left alone — it is what the paper says, and
 * the paper did not change. The read total on the review screen is the sum of
 * the lines, so it moves on its own, and the gap between the two is exactly the
 * thing that screen exists to show.
 */
create or replace function public.delete_quote_line(line uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  l public.quote_lines;
  declared integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role <> 'chef' then
    raise exception 'Only a chef can delete a line';
  end if;

  select ql.* into l from public.quote_lines ql where ql.id = line for update;
  if not found then raise exception 'That line does not exist'; end if;
  if not exists (
    select 1 from public.site_quotes q where q.id = l.quote_id and q.company_id = me.company_id
  ) then
    raise exception 'That line does not exist';
  end if;

  select count(*) into declared from public.task_declarations x where x.quote_line_id = line;
  if declared > 0 then
    raise exception 'Work has already been declared on that line';
  end if;
  if exists (select 1 from public.quote_line_steps st
             where st.quote_line_id = line and st.done_at is not null) then
    raise exception 'Work has already been declared on that line';
  end if;

  delete from public.quote_lines where id = line;
end $$;

revoke all on function public.delete_quote_line(uuid) from public, anon;
grant execute on function public.delete_quote_line(uuid) to authenticated;

-- The worker's list, now saying what is expected of him.
--
-- Three states per row, and the third is the one that matters: assigned to me,
-- assigned to somebody else, assigned to nobody. A devis where the chef has
-- handed nothing out must look exactly as it did before, so "nobody" reads as
-- open rather than as "not yours".
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
    coalesce(
      (select h.label from public.quote_lines h
        where h.quote_id = l.quote_id and h.kind = 'heading'
          and btrim(split_part(btrim(h.label), ' ', 1)) = btrim(coalesce(l.lot, ''))
        order by h.position limit 1),
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
    -- His, whether the chef named him on the line or on any one of its
    -- operations: being given "câbler" is being given a piece of that line.
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
  from public.work_days d
  join public.site_quotes q on q.site_id = d.site_id and q.status = 'validated'
  join public.quote_lines l on l.quote_id = q.id and l.kind = 'work'
  where d.id = day_id
    and d.employee_id = auth.uid()
  order by l.position;
$$;

revoke all on function public.day_quote_lines(uuid) from public, anon;
grant execute on function public.day_quote_lines(uuid) to authenticated;

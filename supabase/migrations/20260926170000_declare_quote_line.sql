-- Declaring against a line of the chantier's devis, which is what an employee
-- actually recognises: the words on the quote his chef showed him, not our
-- catalogue's vocabulary.
--
-- Mirrors declare_task's guarantees: the day must be the caller's, open and
-- unfinished, the account active, the quantity sane. It adds one of its own —
-- the line must belong to a validated devis of the very chantier the day was
-- declared on, so nobody advances another site's quote.

-- One row per day and line, like task_code, so re-declaring corrects rather
-- than accumulates.
create unique index task_declarations_day_line_key
  on public.task_declarations (work_day_id, quote_line_id)
  where quote_line_id is not null;

create or replace function public.declare_quote_line(day_id uuid, line_id uuid, amount numeric)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  d public.work_days;
  l public.quote_lines;
begin
  perform 1 from public.profiles where id = auth.uid() for update;

  select * into d from public.work_days where id = day_id and employee_id = auth.uid() for update;
  if not found or d.ended_at is not null or now() > d.planned_end_at then
    raise exception 'Start a work day before declaring tasks';
  end if;

  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Employee account required';
  end if;

  select l.* into l
  from public.quote_lines l
  join public.site_quotes q on q.id = l.quote_id
  where l.id = line_id
    and l.kind = 'work'
    and q.site_id = d.site_id
    and q.company_id = d.company_id
    and q.status = 'validated';
  if not found then
    raise exception 'That line does not belong to this site''s quote';
  end if;

  if amount is null or amount <= 0 or amount > 100000 or amount <> round(amount, 2)
     or amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Enter a valid quantity';
  end if;
  if l.unit = 'unit' and amount <> trunc(amount) then
    raise exception 'Enter a whole number of units';
  end if;

  insert into public.task_declarations
    (work_day_id, employee_id, company_id, site_id, task_code, quote_line_id, quantity)
  values (d.id, d.employee_id, d.company_id, d.site_id, l.task_code, l.id, amount)
  on conflict (work_day_id, quote_line_id) where quote_line_id is not null
    do update set quantity = excluded.quantity, declared_at = now();
end
$$;

revoke all on function public.declare_quote_line(uuid, uuid, numeric) from public, anon;
grant execute on function public.declare_quote_line(uuid, uuid, numeric) to authenticated;

/**
 * The lines of a chantier's validated devis, with what is left to do and what
 * this employee has already declared today. Read by the employee's task
 * screen, which is why it is a function rather than a view: it is scoped to
 * the caller's own work day.
 */
create or replace function public.day_quote_lines(day_id uuid)
returns table (
  line_id uuid,
  lot text,
  label text,
  unit text,
  quoted numeric,
  declared_total numeric,
  declared_today numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.lot,
    l.label,
    l.unit,
    l.quantity,
    coalesce((select sum(x.quantity) from public.task_declarations x where x.quote_line_id = l.id), 0),
    coalesce((
      select sum(x.quantity) from public.task_declarations x
      where x.quote_line_id = l.id and x.work_day_id = day_id
    ), 0)
  from public.work_days d
  join public.site_quotes q on q.site_id = d.site_id and q.status = 'validated'
  join public.quote_lines l on l.quote_id = q.id and l.kind = 'work'
  where d.id = day_id
    and d.employee_id = auth.uid()
  order by l.position;
$$;

revoke all on function public.day_quote_lines(uuid) from public, anon;
grant execute on function public.day_quote_lines(uuid) to authenticated;

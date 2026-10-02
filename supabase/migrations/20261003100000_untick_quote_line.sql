-- Taking back a declaration.
--
-- A line of the devis is ticked off when it is done, which means it can be
-- ticked by mistake, and a tick that cannot be undone is a trap. The amount
-- had to be greater than zero, so the only way back was to declare a wrong
-- figure.
--
-- Zero now means "nothing today": the row for this day and this line goes,
-- rather than being kept at zero, so the day reads as never having declared
-- against that line — which is what the worker means when he unticks it.
create or replace function public.declare_quote_line(day_id uuid, line_id uuid, amount numeric)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  d public.work_days;
  target public.quote_lines;
begin
  perform 1 from public.profiles where id = auth.uid() for update;

  select * into d from public.work_days where id = day_id and employee_id = auth.uid() for update;
  if not found or d.ended_at is not null or now() > d.planned_end_at then
    raise exception 'Start a work day before declaring tasks';
  end if;

  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Employee account required';
  end if;

  select q.* into target
  from public.quote_lines q
  join public.site_quotes s on s.id = q.quote_id
  where q.id = line_id
    and q.kind = 'work'
    and s.site_id = d.site_id
    and s.company_id = d.company_id
    and s.status = 'validated';
  if not found then
    raise exception 'That line does not belong to this site''s quote';
  end if;

  if amount is null or amount < 0 or amount > 100000 or amount <> round(amount, 2)
     or amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Enter a valid quantity';
  end if;
  if target.unit = 'unit' and amount <> trunc(amount) then
    raise exception 'Enter a whole number of units';
  end if;

  if amount = 0 then
    delete from public.task_declarations
      where work_day_id = d.id and quote_line_id = target.id;
    return;
  end if;

  insert into public.task_declarations
    (work_day_id, employee_id, company_id, site_id, task_code, quote_line_id, quantity)
  values (d.id, d.employee_id, d.company_id, d.site_id, target.task_code, target.id, amount)
  on conflict (work_day_id, quote_line_id) where quote_line_id is not null
    do update set quantity = excluded.quantity, declared_at = now();
end
$$;

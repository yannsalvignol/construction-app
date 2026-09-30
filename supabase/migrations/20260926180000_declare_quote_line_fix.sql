-- The record variable and the table alias were both named `l`, so every
-- column reference inside the lookup was ambiguous and the function raised
-- instead of declaring. The variable is renamed; nothing else changes.

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

  select l.* into target
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
  if target.unit = 'unit' and amount <> trunc(amount) then
    raise exception 'Enter a whole number of units';
  end if;

  insert into public.task_declarations
    (work_day_id, employee_id, company_id, site_id, task_code, quote_line_id, quantity)
  values (d.id, d.employee_id, d.company_id, d.site_id, target.task_code, target.id, amount)
  on conflict (work_day_id, quote_line_id) where quote_line_id is not null
    do update set quantity = excluded.quantity, declared_at = now();
end
$$;

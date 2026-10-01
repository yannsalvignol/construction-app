-- One person's real activity, for the chef who employs them.
--
-- This screen used to invent its contents: a timeline derived from a hash of
-- the employee's id, with hardcoded task labels and plausible hours, shown
-- under a real person's name. It looked like a record and was not one. The
-- comment in the screen claimed the real version needed an RPC that could not
-- exist because only the employee may read their own work — but the chef
-- dashboards already read work_days, task_declarations and presence_check_ins
-- for the whole company through security-definer functions. Nothing was
-- missing except this function.
--
-- Scoped the same way as those dashboards: a chef sees their own company, and
-- an employee sees themself. Nobody else sees anything.

create or replace function public.employee_activity(employee uuid, window_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me public.profiles;
  them public.profiles;
  span integer := least(greatest(coalesce(window_days, 7), 1), 31);
  result jsonb;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null then raise exception 'Sign in required'; end if;
  select * into them from public.profiles where id = employee;
  if them is null then raise exception 'Employee not found'; end if;
  -- A chef reads their own company; anybody else reads only themself.
  if not (them.id = me.id or (me.role = 'chef' and them.company_id = me.company_id)) then
    raise exception 'Not allowed to read this activity';
  end if;

  with days as (
    select d.id, d.work_date, d.started_at, d.ended_at, d.planned_end_at, d.site_id, s.name as site_name,
      -- What he actually worked: the closed interval, or so far today. The
      -- planned end is an intention, not a record, so it is never counted.
      greatest(0, extract(epoch from (coalesce(d.ended_at, least(now(), d.planned_end_at)) - d.started_at)))::numeric / 3600 as hours
    from public.work_days d
    left join public.sites s on s.id = d.site_id
    where d.employee_id = employee
      and d.work_date > (current_date - span)
  ),
  tasks as (
    select t.work_day_id, c.label_fr, c.label_en, c.unit, sum(t.quantity) as quantity
    from public.task_declarations t
    join days d on d.id = t.work_day_id
    left join public.task_codes c on c.code = t.task_code
    group by t.work_day_id, c.label_fr, c.label_en, c.unit
  ),
  checks as (
    select p.id, d.id as work_day_id, p.captured_at,
      -- On site is computed, never stored, and is unanswerable once the
      -- position has been redacted at the end of its retention or when the
      -- site has no coordinates to compare against.
      case
        when p.latitude is null or s.latitude is null then null
        else public.distance_meters(p.latitude, p.longitude, s.latitude, s.longitude) <= public.site_radius_meters()
      end as on_site
    from public.presence_check_ins p
    -- A check belongs to the request that asked for it, and the request to the
    -- day: the real relation, rather than guessing from site and timestamp.
    join public.presence_requests r on r.id = p.request_id
    join days d on d.id = r.work_day_id
    left join public.sites s on s.id = p.site_id
  )
  select jsonb_build_object(
    'person', jsonb_build_object(
      'id', them.id, 'first_name', them.first_name, 'last_name', them.last_name,
      'username', them.username, 'phone', them.phone
    ),
    'hours_total', coalesce((select round(sum(hours), 1) from days), 0),
    'site_count', (select count(distinct site_id) from days where site_id is not null),
    'day_count', (select count(*) from days),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'work_date', d.work_date,
        'site_name', d.site_name,
        'hours', round(d.hours, 1),
        'open', d.ended_at is null,
        'tasks', coalesce((
          select jsonb_agg(jsonb_build_object(
            'label_fr', t.label_fr, 'label_en', t.label_en, 'unit', t.unit, 'quantity', t.quantity
          ) order by t.quantity desc)
          from tasks t where t.work_day_id = d.id
        ), '[]'::jsonb),
        'checks', coalesce((
          select jsonb_agg(jsonb_build_object('captured_at', k.captured_at, 'on_site', k.on_site)
            order by k.captured_at)
          from checks k where k.work_day_id = d.id
        ), '[]'::jsonb)
      ) order by d.work_date desc)
      from days d
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke all on function public.employee_activity(uuid, integer) from public, anon;
grant execute on function public.employee_activity(uuid, integer) to authenticated;

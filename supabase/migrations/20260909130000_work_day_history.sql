-- What an employee did on their past days: which site, how long, what was declared.
-- Read-only and scoped to the caller, so it exposes nothing a chef's screens do not
-- already show them about their own work.
create function public.work_day_history(days_back integer default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; result jsonb;
begin
 select * into p from public.profiles where id = auth.uid();
 if p.role is distinct from 'employee' then raise exception 'Employee account required'; end if;
 if days_back is null or days_back < 1 or days_back > 180 then raise exception 'Invalid history range'; end if;
 select coalesce(jsonb_agg(to_jsonb(h) order by h.started_at desc), '[]'::jsonb) into result from (
   select d.id, d.work_date, d.started_at, d.ended_at, d.planned_end_at,
     d.seconds_inside, d.seconds_outside, s.name as site_name,
     (select count(*) from public.presence_check_ins c
      join public.presence_requests r on r.id = c.request_id
      where r.work_day_id = d.id) as checks,
     coalesce((select jsonb_agg(jsonb_build_object(
         'task_code', t.task_code, 'quantity', t.quantity,
         'label_fr', tc.label_fr, 'label_en', tc.label_en, 'unit', tc.unit)
       order by tc.sort_order)
      from public.task_declarations t
      join public.task_codes tc on tc.code = t.task_code
      where t.work_day_id = d.id), '[]'::jsonb) as tasks
   from public.work_days d
   join public.sites s on s.id = d.site_id
   where d.employee_id = p.id and d.work_date >= (current_date - days_back)
 ) h;
 return result;
end $$;
revoke all on function public.work_day_history(integer) from public, anon;
grant execute on function public.work_day_history(integer) to authenticated;

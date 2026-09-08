create function public.employee_workspace()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; d public.work_days; today date;
begin
 select * into p from public.profiles where id = auth.uid();
 if p.role is distinct from 'employee' then raise exception 'Employee account required'; end if;
 select (now() at time zone time_zone)::date into today from public.companies where id = p.company_id;
 select * into d from public.work_days where employee_id = p.id
   and (work_date = today or (ended_at is null and planned_end_at > now())) order by started_at desc limit 1;
 return jsonb_build_object(
   'server_time', now(), 'date', today, 'day', case when d.id is null then null else to_jsonb(d) end,
   'consent', (select to_jsonb(c) from public.presence_consents c where employee_id = p.id),
   'sites', coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from public.sites s where company_id = p.company_id and is_active), '[]'::jsonb),
   'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.due_at) from public.presence_requests r where work_day_id = d.id and due_at <= now() and cancelled_at is null), '[]'::jsonb),
   'checks', coalesce((select jsonb_agg(to_jsonb(c)) from public.presence_check_ins c join public.presence_requests r on r.id = c.request_id where r.work_day_id = d.id), '[]'::jsonb),
   'declarations', coalesce((select jsonb_agg(to_jsonb(t)) from public.task_declarations t where work_day_id = d.id), '[]'::jsonb),
   'categories', coalesce((select jsonb_agg(to_jsonb(c) order by sort_order) from public.task_categories c), '[]'::jsonb),
   'codes', coalesce((select jsonb_agg(to_jsonb(c) order by sort_order) from public.task_codes c where is_active), '[]'::jsonb)
 );
end $$;
revoke all on function public.employee_workspace() from public, anon;
grant execute on function public.employee_workspace() to authenticated;

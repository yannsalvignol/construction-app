-- The home screen leads with an absolute headcount, so the dashboard now reports
-- active employees alongside the total. Both counts include employees who joined
-- through the company affiliation code: redeem_employee_join_code inserts a
-- regular profile with role 'employee', so no separate accounting is needed.
create or replace function public.chef_dashboard()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare company uuid; today date; result jsonb;
begin
 if public.current_profile_role() is distinct from 'chef' then raise exception 'Chef account required'; end if;
 company := public.current_profile_company_id();
 select (now() at time zone time_zone)::date into today from public.companies where id = company;
 with days as (select * from public.work_days where company_id = company and work_date = today),
 tasks as (select t.* from public.task_declarations t join days d on d.id = t.work_day_id),
 recent_days as (
   select id, employee_id, row_number() over (partition by employee_id order by work_date desc) as rank
   from public.work_days where company_id = company
 ), repeated as (
   select t.employee_id, t.site_id, t.task_code, t.quantity
   from public.task_declarations t join recent_days d on d.id = t.work_day_id
   where d.rank <= 3
   group by t.employee_id, t.site_id, t.task_code, t.quantity having count(*) = 3
 ), productivity as (
   select c.code, c.label_fr, c.label_en, c.unit, sum(t.quantity) as quantity, count(distinct t.employee_id) as employees
   from tasks t join public.task_codes c on c.code = t.task_code group by c.code
 ), flags as (
   select p.id as employee_id, p.first_name || ' ' || p.last_name as employee_name,
     c.label_fr, c.label_en, r.quantity, c.unit, s.name as site_name
   from repeated r join public.profiles p on p.id = r.employee_id
   join public.task_codes c on c.code = r.task_code join public.sites s on s.id = r.site_id
 )
 select jsonb_build_object(
   'date', today,
   'employees', (select count(*) from public.profiles where company_id = company and role = 'employee'),
   'active_employees', (select count(*) from public.profiles where company_id = company and role = 'employee' and is_active),
   'confirmed', (select count(distinct c.employee_id) from public.presence_check_ins c join public.presence_requests r on r.id = c.request_id join days d on d.id = r.work_day_id),
   'to_review', (select count(distinct r.employee_id) from public.presence_requests r join days d on d.id = r.work_day_id
     where r.cancelled_at is null and (r.expires_at < now() or d.ended_at is not null)
     and r.due_at <= now() and not exists (select 1 from public.presence_check_ins c where c.request_id = r.id)),
   'declared_hours', (select coalesce(round(sum(extract(epoch from (least(coalesce(ended_at, now()), planned_end_at) - started_at)) / 3600)::numeric, 1), 0) from days),
   'declarations', (select count(*) from tasks),
   'contributors', (select count(distinct employee_id) from tasks),
   'productivity', coalesce((select jsonb_agg(to_jsonb(productivity) order by quantity desc, code) from productivity), '[]'::jsonb),
   'flags', coalesce((select jsonb_agg(to_jsonb(flags) order by employee_name) from flags), '[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.chef_dashboard() from public, anon;
grant execute on function public.chef_dashboard() to authenticated;

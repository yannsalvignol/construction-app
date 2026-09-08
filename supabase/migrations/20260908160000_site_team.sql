-- Employees attached to a site. There is no employee-to-site assignment in this
-- model: an employee belongs to a site by declaring work days on it, so the roster
-- is derived from work_days rather than from a join table that could drift.
create function public.site_team(site uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare company uuid; today date; result jsonb;
begin
 if public.current_profile_role() is distinct from 'chef' then raise exception 'Chef account required'; end if;
 company := public.current_profile_company_id();
 if not exists (select 1 from public.sites where id = site and company_id = company) then
   raise exception 'Site not found';
 end if;
 select (now() at time zone time_zone)::date into today from public.companies where id = company;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.present_today desc, t.last_day desc, t.employee_name), '[]'::jsonb)
 into result from (
   select p.id as employee_id, p.first_name || ' ' || p.last_name as employee_name,
     p.is_active, p.location_mode,
     max(d.work_date) as last_day,
     count(*) as days,
     bool_or(d.work_date = today and d.ended_at is null and d.planned_end_at > now()) as present_today
   from public.work_days d join public.profiles p on p.id = d.employee_id
   where d.site_id = site and d.company_id = company
   group by p.id
 ) t;
 return result;
end $$;
revoke all on function public.site_team(uuid) from public, anon;
grant execute on function public.site_team(uuid) to authenticated;

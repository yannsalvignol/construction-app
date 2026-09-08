-- The site roster now reports when each employee was last located on that site,
-- which is what a chef actually wants to know, rather than whether live tracking
-- happens to be switched on for them.
--
-- "Seen" means the most recent evidence of where they were: a live position if
-- they are sharing one today, or the last presence check-in they answered on this
-- site. Redaction nulls a check-in's coordinates but keeps submitted_at, so a
-- redacted proof still counts as having been seen at that time.
create or replace function public.site_team(site uuid)
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
     bool_or(d.work_date = today and d.ended_at is null and d.planned_end_at > now()) as present_today,
     greatest(
       (select max(c.submitted_at) from public.presence_check_ins c
        where c.employee_id = p.id and c.site_id = site),
       (select l.recorded_at from public.live_positions l
        join public.work_days ld on ld.id = l.work_day_id
        where l.employee_id = p.id and ld.site_id = site)
     ) as last_seen_at
   from public.work_days d join public.profiles p on p.id = d.employee_id
   where d.site_id = site and d.company_id = company
   group by p.id
 ) t;
 return result;
end $$;
revoke all on function public.site_team(uuid) from public, anon;
grant execute on function public.site_team(uuid) to authenticated;

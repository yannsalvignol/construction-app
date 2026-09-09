-- Whether a shared position actually sits on the declared site.
--
-- The chef's screens showed a pin and a site name side by side, which reads as
-- "on site" whatever the distance. The comparison the app already makes to
-- accumulate time inside and outside the zone is now reported per employee, so a
-- position five kilometres away is no longer indistinguishable from one at the gate.
-- Null means the question cannot be answered: the site predates located addresses.
create or replace function public.live_team()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare company uuid; result jsonb;
begin
 if public.current_profile_role() is distinct from 'chef' then raise exception 'Chef account required'; end if;
 company := public.current_profile_company_id();
 select coalesce(jsonb_agg(to_jsonb(t) order by t.employee_name), '[]'::jsonb) into result from (
   select p.id as employee_id, p.first_name || ' ' || p.last_name as employee_name,
     l.latitude, l.longitude, l.accuracy_meters, l.recorded_at, s.name as site_name,
     case when s.latitude is null or s.longitude is null then null
       else public.distance_meters(l.latitude, l.longitude, s.latitude, s.longitude)
         <= public.site_radius_meters() end as on_site,
     case when s.latitude is null or s.longitude is null then null
       else round(public.distance_meters(l.latitude, l.longitude, s.latitude, s.longitude))::integer end as distance_meters
   from public.live_positions l
   join public.profiles p on p.id = l.employee_id
   join public.work_days d on d.id = l.work_day_id
   join public.sites s on s.id = d.site_id
   where l.company_id = company and d.ended_at is null and d.planned_end_at > now()
 ) t;
 return result;
end $$;
revoke all on function public.live_team() from public, anon;
grant execute on function public.live_team() to authenticated;

-- The site roster gains the same answer, so a chef reading one site's team sees who
-- is standing on it right now rather than only who worked there at some point.
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
     ) as last_seen_at,
     (select case when s.latitude is null or s.longitude is null then null
        else public.distance_meters(l.latitude, l.longitude, s.latitude, s.longitude)
          <= public.site_radius_meters() end
      from public.live_positions l
      join public.work_days ld on ld.id = l.work_day_id
      join public.sites s on s.id = ld.site_id
      where l.employee_id = p.id and ld.site_id = site) as on_site
   from public.work_days d join public.profiles p on p.id = d.employee_id
   where d.site_id = site and d.company_id = company
   group by p.id
 ) t;
 return result;
end $$;
revoke all on function public.site_team(uuid) from public, anon;
grant execute on function public.site_team(uuid) to authenticated;

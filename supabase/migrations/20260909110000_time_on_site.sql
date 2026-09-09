-- Time spent on site versus away, accumulated as two counters on the work day.
--
-- Deliberately NOT a trail: each live position updates the counters and is then
-- forgotten as before, so the notice's promise that no movement history is built
-- stays true. Only two durations survive, and they say nothing about where the
-- employee actually was when away.
alter table public.work_days
  add column seconds_inside integer not null default 0 check (seconds_inside >= 0),
  add column seconds_outside integer not null default 0 check (seconds_outside >= 0),
  add column last_sample_at timestamptz,
  add column last_sample_inside boolean;

-- Plain haversine: PostGIS is not available everywhere this schema runs, and metre
-- precision over a 5 km threshold does not need a spatial index.
create function public.distance_meters(lat1 double precision, lng1 double precision,
                                       lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 6371000 * 2 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))));
$$;
grant execute on function public.distance_meters(double precision, double precision, double precision, double precision) to authenticated;

create function public.site_radius_meters() returns integer
language sql immutable set search_path = '' as $$ select 5000 $$;
grant execute on function public.site_radius_meters() to authenticated;

/*
 * A gap longer than this is not attributed to either bucket. Positions arrive
 * every couple of minutes at best, and after a long silence — app closed, no
 * movement, no signal — we genuinely do not know where the employee was. Counting
 * that silence as time on site, or away, would be inventing a fact.
 */
create function public.max_attributed_gap() returns interval
language sql immutable set search_path = '' as $$ select interval '10 minutes' $$;

create or replace function public.update_live_position(lat double precision, lng double precision, accuracy double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.profiles; d public.work_days; s public.sites; inside boolean; gap interval;
begin
 select * into p from public.profiles where id = auth.uid();
 if p.role is distinct from 'employee' or not p.is_active then raise exception 'Employee account required'; end if;
 if p.location_mode is distinct from 'live' then raise exception 'Live location is not enabled for this account'; end if;
 if not exists (select 1 from public.live_location_consents where employee_id = p.id
   and revoked_at is null and notice_version = public.live_notice_version()) then
   raise exception 'Live location information and explicit agreement required';
 end if;
 select * into d from public.work_days where employee_id = p.id and ended_at is null and planned_end_at > now()
   order by started_at desc limit 1 for update;
 if not found then raise exception 'Start a work day before sharing your location'; end if;
 if lat is null or lng is null or accuracy is null then raise exception 'Current GPS position required'; end if;

 select * into s from public.sites where id = d.site_id;
 -- A site created before addresses were located has no coordinates to compare to.
 if s.latitude is not null and s.longitude is not null then
   inside := public.distance_meters(lat, lng, s.latitude, s.longitude) <= public.site_radius_meters();
   if d.last_sample_at is not null and d.last_sample_inside is not null then
     gap := now() - d.last_sample_at;
     if gap > interval '0' and gap <= public.max_attributed_gap() then
       update public.work_days set
         seconds_inside = seconds_inside + case when d.last_sample_inside then extract(epoch from gap)::integer else 0 end,
         seconds_outside = seconds_outside + case when d.last_sample_inside then 0 else extract(epoch from gap)::integer end
       where id = d.id;
     end if;
   end if;
   update public.work_days set last_sample_at = now(), last_sample_inside = inside where id = d.id;
 end if;

 insert into public.live_positions(employee_id, company_id, work_day_id, latitude, longitude, accuracy_meters)
 values (p.id, p.company_id, d.id, lat, lng, accuracy)
 on conflict (employee_id) do update set company_id = excluded.company_id, work_day_id = excluded.work_day_id,
   latitude = excluded.latitude, longitude = excluded.longitude, accuracy_meters = excluded.accuracy_meters, recorded_at = now();
end $$;
revoke all on function public.update_live_position(double precision, double precision, double precision) from public, anon;
grant execute on function public.update_live_position(double precision, double precision, double precision) to authenticated;

-- Closing the day banks the interval since the last position, under the same cap.
create or replace function public.end_work_day(day_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.work_days; gap interval;
begin
 perform 1 from public.profiles where id = auth.uid() for update;
 select * into d from public.work_days where id = day_id and employee_id = auth.uid() for update;
 if not found then raise exception 'Work day not found'; end if;
 if d.last_sample_at is not null and d.last_sample_inside is not null then
   gap := least(now(), d.planned_end_at) - d.last_sample_at;
   if gap > interval '0' and gap <= public.max_attributed_gap() then
     update public.work_days set
       seconds_inside = seconds_inside + case when d.last_sample_inside then extract(epoch from gap)::integer else 0 end,
       seconds_outside = seconds_outside + case when d.last_sample_inside then 0 else extract(epoch from gap)::integer end
     where id = d.id;
   end if;
 end if;
 update public.work_days set ended_at = least(now(), planned_end_at) where id = day_id and ended_at is null;
 -- Keep already due unanswered requests visible for the employer; cancel future requests only.
 update public.presence_requests set cancelled_at = now() where work_day_id = day_id and due_at > now() and cancelled_at is null;
 delete from public.live_positions where work_day_id = day_id;
end $$;

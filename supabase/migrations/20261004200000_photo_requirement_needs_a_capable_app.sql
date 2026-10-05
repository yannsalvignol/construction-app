-- Only ask for a photo from an app that can take one.
--
-- The two switches were implemented this morning and enforced in
-- start_work_day. Five accounts across four companies already had them turned
-- on — switched on at some point when they did nothing, which is exactly why
-- nobody thought twice about it. The build on the App Store predates the
-- camera step, so for those five the server began demanding a photo their app
-- has no way to take: a work day that cannot be started, and an error telling
-- a man to do something his screen does not offer.
--
-- That is the backward-compatibility rule being broken one day after it was
-- written down. The signature was extended compatibly; the *behaviour* was
-- not, and an old client silently losing a feature is survivable where an old
-- client being locked out is not.
--
-- So the requirement applies only to an app that says it can comply. An older
-- one starts days as it always did and the chef's setting waits, instead of
-- being discarded or standing in the way.
drop function if exists public.start_work_day(uuid, numeric, text, text, double precision, double precision, double precision);

create function public.start_work_day(
  declared_site_id uuid,
  duration_hours numeric,
  equipment_photo text default null,
  clock_in_photo text default null,
  lat double precision default null,
  lng double precision default null,
  accuracy double precision default null,
  -- Sent by a build that has the camera step. Absent means an older app,
  -- which is told nothing and refused nothing.
  can_photograph boolean default false
)
returns public.work_days
language plpgsql
security definer
set search_path = ''
as $$
declare p public.profiles; d public.work_days; tz text; n integer; i integer;
        span_seconds double precision; slot_time timestamptz;
begin
 select * into p from public.profiles where id = auth.uid() for update;
 if p.role is distinct from 'employee' or not p.is_active then raise exception 'Employee account required'; end if;
 if not exists (select 1 from public.presence_consents where employee_id = p.id and revoked_at is null and notice_version = '2026-09-07') then
   raise exception 'Presence information and explicit agreement required';
 end if;
 if duration_hours is null or duration_hours < 1 or duration_hours > 12
    or duration_hours * 2 <> round(duration_hours * 2) then
   raise exception 'Invalid work duration';
 end if;
 if not exists (select 1 from public.sites where id = declared_site_id and company_id = p.company_id and is_active) then
   raise exception 'Choose an active site in your company';
 end if;

 -- What the chef asked of this man, checked here rather than on his phone: a
 -- requirement a client can skip is a suggestion. Asked only of an app that
 -- can answer.
 if can_photograph then
   if p.equipment_photo_required and nullif(btrim(coalesce(equipment_photo, '')), '') is null then
     raise exception 'A photo of your safety equipment is required to start the day';
   end if;
   if p.clock_in_photo_required and nullif(btrim(coalesce(clock_in_photo, '')), '') is null then
     raise exception 'A clock-in photo is required to start the day';
   end if;
 end if;

 select time_zone into tz from public.companies where id = p.company_id;
 if exists (select 1 from public.work_days where employee_id = p.id and ended_at is null and planned_end_at > now()) then
   raise exception 'Finish your current work day first';
 end if;
 insert into public.work_days(employee_id, company_id, site_id, work_date, planned_end_at)
 values (p.id, p.company_id, declared_site_id, (now() at time zone tz)::date,
         now() + make_interval(mins => (duration_hours * 60)::integer))
 returning * into d;

 if nullif(btrim(coalesce(equipment_photo, '')), '') is not null then
   insert into public.work_day_photos(work_day_id, employee_id, company_id, kind, photo_path, latitude, longitude, accuracy_meters)
   values (d.id, p.id, p.company_id, 'equipment', equipment_photo, lat, lng, accuracy);
 end if;
 if nullif(btrim(coalesce(clock_in_photo, '')), '') is not null then
   insert into public.work_day_photos(work_day_id, employee_id, company_id, kind, photo_path, latitude, longitude, accuracy_meters)
   values (d.id, p.id, p.company_id, 'clock_in', clock_in_photo, lat, lng, accuracy);
 end if;

 n := 2 + floor(random() * 2)::integer;
 span_seconds := greatest(duration_hours * 3600 - 3600, 1800)::double precision / n;
 for i in 0..n-1 loop
   slot_time := now() + interval '20 minutes'
     + make_interval(secs => i * span_seconds + random() * greatest(span_seconds - 1800, 0));
   insert into public.presence_requests(work_day_id, employee_id, company_id, due_at, expires_at)
   values (d.id, p.id, p.company_id, slot_time, slot_time + interval '30 minutes');
 end loop;
 return d;
end $$;

revoke all on function public.start_work_day(uuid, numeric, text, text, double precision, double precision, double precision, boolean) from public, anon;
grant execute on function public.start_work_day(uuid, numeric, text, text, double precision, double precision, double precision, boolean) to authenticated;

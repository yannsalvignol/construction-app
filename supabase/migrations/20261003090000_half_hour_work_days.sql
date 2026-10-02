-- A declared day in half hours, rather than three fixed lengths.
--
-- Four, eight or ten hours covered the ordinary shift and nothing else: a
-- morning that runs to one, an afternoon of two and a half hours, a day that
-- ends early. A worker whose real day was five hours declared four or eight,
-- and the presence checks were scheduled against a figure nobody meant.
--
-- The parameter becomes numeric, so the function has to be dropped rather than
-- replaced. Half hours only: a quarter of an hour is more precision than anyone
-- is actually claiming, and the wheel offers nothing finer.
drop function if exists public.start_work_day(uuid, integer);

create function public.start_work_day(declared_site_id uuid, duration_hours numeric)
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
 select time_zone into tz from public.companies where id = p.company_id;
 -- Only an open day blocks a new one; a finished day never does.
 if exists (select 1 from public.work_days where employee_id = p.id and ended_at is null and planned_end_at > now()) then
   raise exception 'Finish your current work day first';
 end if;
 insert into public.work_days(employee_id, company_id, site_id, work_date, planned_end_at)
 values (p.id, p.company_id, declared_site_id, (now() at time zone tz)::date,
         -- Minutes, not hours: make_interval's hours argument is an integer and
         -- would silently drop the half.
         now() + make_interval(mins => (duration_hours * 60)::integer))
 returning * into d;
 n := 2 + floor(random() * 2)::integer;
 -- Separate random windows: avoid only checking shift boundaries and avoid
 -- overlapping requests. Floored, because a short day leaves no hour to spread
 -- over and the spread would otherwise run backwards into the past.
 span_seconds := greatest(duration_hours * 3600 - 3600, 1800)::double precision / n;
 for i in 0..n-1 loop
   slot_time := now() + interval '20 minutes'
     + make_interval(secs => i * span_seconds + random() * greatest(span_seconds - 1800, 0));
   insert into public.presence_requests(work_day_id, employee_id, company_id, due_at, expires_at)
   values (d.id, p.id, p.company_id, slot_time, slot_time + interval '30 minutes');
 end loop;
 return d;
end $$;

revoke all on function public.start_work_day(uuid, numeric) from public, anon;
grant execute on function public.start_work_day(uuid, numeric) to authenticated;

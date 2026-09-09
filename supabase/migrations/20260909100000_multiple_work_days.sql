-- An employee can declare several work days in the same calendar date: moving to a
-- second site during the day is uncommon but real, and finishing early then going
-- back out was impossible before.
--
-- The unique (employee_id, work_date) key made that structurally impossible, so it
-- goes. What must stay true is narrower: only one day may be OPEN at a time, since
-- presence requests, task declarations and the live position all attach to exactly
-- one day and would otherwise be ambiguous.
alter table public.work_days drop constraint work_days_employee_id_work_date_key;
create index days_employee_open_idx on public.work_days(employee_id, started_at desc);

create or replace function public.start_work_day(declared_site_id uuid, duration_hours integer)
returns public.work_days language plpgsql security definer set search_path = '' as $$
declare p public.profiles; d public.work_days; tz text; n integer; i integer; slot_time timestamptz; span_seconds double precision;
begin
 select * into p from public.profiles where id = auth.uid() for update;
 if p.role is distinct from 'employee' or not p.is_active then raise exception 'Employee account required'; end if;
 if not exists (select 1 from public.presence_consents where employee_id = p.id and revoked_at is null and notice_version = '2026-09-07') then
   raise exception 'Presence information and explicit agreement required';
 end if;
 if duration_hours is null or duration_hours not in (4, 8, 10) then raise exception 'Invalid work duration'; end if;
 if not exists (select 1 from public.sites where id = declared_site_id and company_id = p.company_id and is_active) then
   raise exception 'Choose an active site in your company';
 end if;
 select time_zone into tz from public.companies where id = p.company_id;
 -- Only an open day blocks a new one; a finished day never does.
 if exists (select 1 from public.work_days where employee_id = p.id and ended_at is null and planned_end_at > now()) then
   raise exception 'Finish your current work day first';
 end if;
 insert into public.work_days(employee_id, company_id, site_id, work_date, planned_end_at)
 values (p.id, p.company_id, declared_site_id, (now() at time zone tz)::date, now() + make_interval(hours => duration_hours)) returning * into d;
 n := 2 + floor(random() * 2)::integer;
 -- Separate random windows: avoid only checking shift boundaries and avoid overlapping requests.
 span_seconds := (duration_hours * 3600 - 3600)::double precision / n;
 for i in 0..n-1 loop
   slot_time := now() + interval '20 minutes' + make_interval(secs => i * span_seconds + random() * (span_seconds - 1800));
   insert into public.presence_requests(work_day_id, employee_id, company_id, due_at, expires_at)
   values (d.id, p.id, p.company_id, slot_time, slot_time + interval '30 minutes');
 end loop;
 return d;
end $$;

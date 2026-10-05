-- The two switches a chef could turn on and nothing happened.
--
-- "Preuve d'équipement" and "Photo de pointage" have been on the employee's
-- card since the app was built. They saved, they survived a reload, and
-- nothing anywhere read them: a chef could require a photo of a man's helmet
-- before every shift and never be given one. That was a dead setting while
-- the only user was the person who wrote it. With the app on the App Store it
-- is the app promising a check it does not perform, and a chef will build his
-- site rules on it.
--
-- Both gate the same moment — the start of a day — and differ only in what
-- the photo must show. So they are one step with up to two shots, each
-- labelled, and the server refuses the day without the ones that were asked
-- for. Enforcing it in the client alone would make it a suggestion.

create table public.work_day_photos (
  id uuid primary key default gen_random_uuid(),
  work_day_id uuid not null references public.work_days(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- 'equipment' is the safety gear, 'clock_in' is the man at his chantier.
  kind text not null check (kind in ('equipment', 'clock_in')),
  photo_path text not null,
  captured_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  unique (work_day_id, kind)
);
create index work_day_photos_employee_idx on public.work_day_photos (employee_id, captured_at desc);

alter table public.work_day_photos enable row level security;
grant select on public.work_day_photos to authenticated;

-- His own, and his chef's. Nobody writes directly: the rows are made by
-- start_work_day, in the same transaction as the day they prove.
create policy work_day_photos_read on public.work_day_photos for select to authenticated
  using (
    employee_id = auth.uid()
    or (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id())
  );

-- Replaced rather than overloaded: a two-argument call would match both
-- signatures and Postgres refuses to choose. The defaults keep every caller
-- that predates this working — including a copy of the app on a phone that
-- will not be updated for months, which simply starts days without photos as
-- it always did.
drop function if exists public.start_work_day(uuid, numeric);

create function public.start_work_day(
  declared_site_id uuid,
  duration_hours numeric,
  equipment_photo text default null,
  clock_in_photo text default null,
  lat double precision default null,
  lng double precision default null,
  accuracy double precision default null
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

 -- What the chef asked of this man, checked here rather than on his phone:
 -- a requirement a client can skip is a suggestion.
 if p.equipment_photo_required and nullif(btrim(coalesce(equipment_photo, '')), '') is null then
   raise exception 'A photo of your safety equipment is required to start the day';
 end if;
 if p.clock_in_photo_required and nullif(btrim(coalesce(clock_in_photo, '')), '') is null then
   raise exception 'A clock-in photo is required to start the day';
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

 -- In the same transaction as the day: a proof that outlives a failed start,
 -- or a day that starts without the proof it was conditioned on, is worse
 -- than neither.
 if nullif(btrim(coalesce(equipment_photo, '')), '') is not null then
   insert into public.work_day_photos(work_day_id, employee_id, company_id, kind, photo_path, latitude, longitude, accuracy_meters)
   values (d.id, p.id, p.company_id, 'equipment', equipment_photo, lat, lng, accuracy);
 end if;
 if nullif(btrim(coalesce(clock_in_photo, '')), '') is not null then
   insert into public.work_day_photos(work_day_id, employee_id, company_id, kind, photo_path, latitude, longitude, accuracy_meters)
   values (d.id, p.id, p.company_id, 'clock_in', clock_in_photo, lat, lng, accuracy);
 end if;

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

revoke all on function public.start_work_day(uuid, numeric, text, text, double precision, double precision, double precision) from public, anon;
grant execute on function public.start_work_day(uuid, numeric, text, text, double precision, double precision, double precision) to authenticated;

-- The worker's screen has to know what is being asked of him before he
-- presses "commencer ma journée", so the camera opens at the right moment
-- instead of the server refusing him afterwards. Added fields only: a copy of
-- the app that predates them ignores them and behaves as it does today.
create or replace function public.employee_workspace()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; d public.work_days; today date; gap interval; tail integer; day_open boolean;
begin
 select * into p from public.profiles where id = auth.uid();
 if p.role is distinct from 'employee' then raise exception 'Employee account required'; end if;
 select (now() at time zone time_zone)::date into today from public.companies where id = p.company_id;
 select * into d from public.work_days where employee_id = p.id
   and (work_date = today or (ended_at is null and planned_end_at > now())) order by started_at desc limit 1;
 day_open := d.id is not null and d.ended_at is null and d.planned_end_at > now();

 tail := 0;
 if day_open and d.last_sample_at is not null and d.last_sample_inside is not null then
   gap := least(now(), d.planned_end_at) - d.last_sample_at;
   if gap > interval '0' and gap <= public.max_attributed_gap() then
     tail := extract(epoch from gap)::integer;
   end if;
 end if;

 return jsonb_build_object(
   'server_time', now(), 'date', today,
   'day', case when d.id is null then null else
     to_jsonb(d) || jsonb_build_object(
       'seconds_inside', d.seconds_inside + case when coalesce(d.last_sample_inside, false) then tail else 0 end,
       'seconds_outside', d.seconds_outside + case when coalesce(d.last_sample_inside, true) then 0 else tail end
     ) end,
   'consent', (select to_jsonb(c) from public.presence_consents c where employee_id = p.id),
   'location_mode', p.location_mode,
   'live_consent', (select to_jsonb(c) from public.live_location_consents c where employee_id = p.id),
   'lone_worker_watch', p.lone_worker_watch,
   'lone_worker_asked', day_open and coalesce(
     (select w.asked_at is not null from public.lone_worker_watches w where w.work_day_id = d.id), false),
   'equipment_photo_required', p.equipment_photo_required,
   'clock_in_photo_required', p.clock_in_photo_required,
   'sites', coalesce((
     select jsonb_agg(
       to_jsonb(s) || jsonb_build_object('awaiting', (
         select count(*)
         from public.site_quotes q
         join public.quote_lines l on l.quote_id = q.id and l.kind = 'work'
         join public.quote_outline(q.id) o on o.line_id = l.id
         where q.site_id = s.id and q.status = 'validated'
           and public.line_is_for(l.id, o.path, p.id)
           and (
             l.quantity is null
             or coalesce((select sum(x.quantity) from public.task_declarations x
                          where x.quote_line_id = l.id), 0) < l.quantity
           )
           and not (
             exists (select 1 from public.quote_line_steps st where st.quote_line_id = l.id)
             and not exists (
               select 1 from public.quote_line_steps st
               where st.quote_line_id = l.id and st.done_at is null
             )
           )
       ))
       order by s.name)
     from public.sites s where company_id = p.company_id and is_active), '[]'::jsonb),
   'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.due_at) from public.presence_requests r where work_day_id = d.id and due_at <= now() and cancelled_at is null), '[]'::jsonb),
   'checks', coalesce((select jsonb_agg(to_jsonb(c)) from public.presence_check_ins c join public.presence_requests r on r.id = c.request_id where r.work_day_id = d.id), '[]'::jsonb),
   'declarations', coalesce((select jsonb_agg(to_jsonb(t)) from public.task_declarations t where work_day_id = d.id), '[]'::jsonb),
   'categories', coalesce((select jsonb_agg(to_jsonb(c) order by sort_order) from public.task_categories c), '[]'::jsonb),
   'codes', coalesce((select jsonb_agg(to_jsonb(c) order by sort_order) from public.task_codes c where is_active), '[]'::jsonb)
 );
end $$;

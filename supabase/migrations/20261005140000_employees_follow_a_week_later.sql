-- The crew keeps working for a week after the chef is stopped.
--
-- Until now the wall was the chef's alone: his company lapsed, he could not
-- get in, and his men went on declaring days into an account nobody was
-- paying for. That is the wrong shape in both directions. It lets a company
-- run indefinitely on the employees' side, and — the part that matters more —
-- it would be unjust to reverse by stopping everyone at midnight, because an
-- employee has not been told anything, cannot pay anything, and is holding a
-- day's work the app is the record of.
--
-- So the crew follows, a week behind. A week is long enough for a chef to
-- answer an e-mail and for a man to finish the chantier week he is in, and
-- short enough that the account is not simply usable without him.
--
-- A day already open is never interrupted: the block is on starting a new
-- one, so nobody loses the hours he is standing in.

/** How long the men keep working after their employer has been stopped. */
create or replace function public.employee_grace_days() returns integer
language sql immutable set search_path = '' as $$ select 7 $$;

/**
 * The instant a company's access ran out: the end of the trial, or the end of
 * the last day the chef took for himself, whichever is later.
 *
 * Null while the company is paid up, which is the same answer as "it has not".
 */
create or replace function public.company_locked_at(c public.companies)
returns timestamptz language sql stable set search_path = '' as $$
  select case when c.subscription_active then null
    else greatest(c.trial_started_at + make_interval(days => public.trial_days()),
                  coalesce(c.grace_until, 'epoch'::timestamptz)) end
$$;

/** The same wall, a week further on, for the people who did not sign anything. */
create or replace function public.company_is_locked_for_employees(c public.companies)
returns boolean language sql stable set search_path = '' as $$
  select public.company_locked_at(c) is not null
     and now() >= public.company_locked_at(c) + make_interval(days => public.employee_grace_days())
$$;

/**
 * Now answers for whoever is asking.
 *
 * Role-aware rather than a second function, so that every existing caller —
 * all of them writes that must refuse — keeps refusing at the right moment
 * for the person making them, without each one having to remember which wall
 * it is behind.
 */
create or replace function public.require_company_access()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare locked boolean;
begin
  select case when me.role = 'employee'
              then public.company_is_locked_for_employees(c)
              else public.company_is_locked(c) end
    into locked
  from public.profiles me join public.companies c on c.id = me.company_id
  where me.id = auth.uid();
  if coalesce(locked, false) then
    raise exception 'This account needs to be unlocked before it can be used';
  end if;
end $$;
revoke all on function public.require_company_access() from public, anon;
grant execute on function public.require_company_access() to authenticated, service_role;

-- Starting a day is the one employee write the wall stops, so the guard goes
-- into the function as it stands today rather than into an older signature:
-- the two-argument form was dropped when the photo steps arrived, and
-- bringing it back would make every call ambiguous.
create or replace function public.start_work_day(
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
 -- The wall, a week behind the chef's. Only on starting: declaring work,
 -- answering a check and ending the day all belong to a day begun while the
 -- account was open, and a man must be able to close the day he stands in.
 perform public.require_company_access();
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

-- The screen needs to know which of the two walls applies to the person
-- reading it, and when the other one arrives.
create or replace function public.company_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when c.id is null then null else jsonb_build_object(
    'company_id', c.id,
    'active', c.subscription_active,
    'trial_ends_at', c.trial_started_at + make_interval(days => public.trial_days()),
    'days_left', greatest(0, ceil(
      extract(epoch from (c.trial_started_at + make_interval(days => public.trial_days()) - now())) / 86400
    )::integer),
    -- The wall this caller is behind: the chef's, or the crew's a week later.
    'locked', case when me.role = 'employee'
                   then public.company_is_locked_for_employees(c)
                   else public.company_is_locked(c) end,
    -- Kept under its old name as well, so anything reading "is the company
    -- lapsed" still gets the company's answer rather than this caller's.
    'company_locked', public.company_is_locked(c),
    'employees_locked_at', case when public.company_locked_at(c) is null then null
      else public.company_locked_at(c) + make_interval(days => public.employee_grace_days()) end,
    'grace_left', greatest(0, public.grace_days() - c.grace_days_used),
    'grace_until', c.grace_until,
    'notice_seen', (select p.trial_notice_seen_at is not null
                    from public.profiles p where p.id = auth.uid())
  ) end
  from public.profiles me
  left join public.companies c on c.id = me.company_id
  where me.id = auth.uid();
$$;
revoke all on function public.company_access() from public, anon;
grant execute on function public.company_access() to authenticated;

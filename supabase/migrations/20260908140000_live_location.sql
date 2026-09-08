-- Optional live location, chosen by the chef per employee.
--
-- The 2026-09-07 migration removed continuous tracking outright. Reinstating it
-- deliberately does NOT reuse that dead path: the legacy profile columns stay
-- permanently null, and live positions live in their own table behind their own
-- consent. Point-in-time presence checks are a separate purpose with a separate
-- agreement, so an employee's existing presence consent is left untouched and is
-- never treated as agreement to being followed.
alter table public.profiles drop constraint profiles_no_continuous_tracking;
alter table public.profiles add constraint profiles_legacy_location_unused check (
  location_tracking_enabled = false and last_latitude is null
  and last_longitude is null and location_updated_at is null
);

-- 'checkpoint' keeps today's behaviour: nothing is collected between requests.
alter table public.profiles add column location_mode text not null default 'checkpoint'
  check (location_mode in ('checkpoint', 'live'));

-- The chef owns this toggle. Employees cannot flip it on their own row: the
-- existing trigger reverts chef-only columns on a self-edit, and location_mode
-- joins that list for the same reason (RLS filters rows, not columns).
create or replace function public.enforce_employee_profile_update_rules()
returns trigger language plpgsql as $$
begin
    if auth.uid() = new.id then
        new.location_tracking_enabled := old.location_tracking_enabled;
        new.equipment_photo_required := old.equipment_photo_required;
        new.clock_in_photo_required := old.clock_in_photo_required;
        new.notifications_enabled := old.notifications_enabled;
        new.is_active := old.is_active;
        new.location_mode := old.location_mode;
    end if;

    if new.location_tracking_enabled = false and old.location_tracking_enabled = true then
        new.last_latitude := null;
        new.last_longitude := null;
        new.location_updated_at := null;
    end if;

    return new;
end $$;
grant update (location_mode) on public.profiles to authenticated;

create table public.live_location_consents (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  notice_version text not null,
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create table public.live_location_consent_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  notice_version text not null,
  accepted boolean not null,
  recorded_at timestamptz not null default now()
);
-- Only the current position is kept. No trail is accumulated: a history would be
-- a movement profile, which is not what the chef needs to see who is on site.
create table public.live_positions (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  work_day_id uuid not null references public.work_days(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision not null check (accuracy_meters >= 0),
  recorded_at timestamptz not null default now()
);
create index live_positions_company_idx on public.live_positions(company_id, recorded_at desc);

alter table public.live_location_consents enable row level security;
alter table public.live_location_consent_events enable row level security;
alter table public.live_positions enable row level security;
grant select on public.live_location_consents, public.live_location_consent_events, public.live_positions to authenticated;

create policy live_consents_self_read on public.live_location_consents for select to authenticated using (employee_id = auth.uid());
create policy live_consent_events_self_read on public.live_location_consent_events for select to authenticated using (employee_id = auth.uid());
-- A position stops being visible once it goes stale, so a chef never sees a
-- position that no longer reflects where somebody is.
create policy live_positions_read on public.live_positions for select to authenticated using (
  recorded_at > now() - interval '15 minutes' and (
    employee_id = auth.uid()
    or (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id())));

create function public.live_notice_version() returns text
language sql immutable set search_path = '' as $$ select '2026-09-08'::text $$;
grant execute on function public.live_notice_version() to authenticated;

create function public.set_live_location_consent(accepted boolean, version text default '2026-09-08')
returns void language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
 select * into p from public.profiles where id = auth.uid() for update;
 if accepted is null then raise exception 'Explicit agreement choice required'; end if;
 if p.role is distinct from 'employee' or (accepted and not p.is_active) then
   raise exception 'Employee account required';
 end if;
 if version is distinct from public.live_notice_version() then raise exception 'Please read the current live location notice'; end if;
 insert into public.live_location_consent_events(employee_id, notice_version, accepted) values (auth.uid(), version, accepted);
 if accepted then
   insert into public.live_location_consents(employee_id, notice_version) values (auth.uid(), version)
   on conflict (employee_id) do update set notice_version = excluded.notice_version, accepted_at = now(), revoked_at = null;
 else
   update public.live_location_consents set revoked_at = now() where employee_id = auth.uid();
   -- Withdrawal takes effect immediately: the last position is erased, not just hidden.
   delete from public.live_positions where employee_id = auth.uid();
 end if;
end $$;
revoke all on function public.set_live_location_consent(boolean, text) from public, anon;
grant execute on function public.set_live_location_consent(boolean, text) to authenticated;

-- Every condition is re-checked server-side on each point: the client cannot keep
-- reporting after the mode is turned off, consent is withdrawn or the day ends.
create function public.update_live_position(lat double precision, lng double precision, accuracy double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.profiles; d public.work_days;
begin
 select * into p from public.profiles where id = auth.uid();
 if p.role is distinct from 'employee' or not p.is_active then raise exception 'Employee account required'; end if;
 if p.location_mode is distinct from 'live' then raise exception 'Live location is not enabled for this account'; end if;
 if not exists (select 1 from public.live_location_consents where employee_id = p.id
   and revoked_at is null and notice_version = public.live_notice_version()) then
   raise exception 'Live location information and explicit agreement required';
 end if;
 select * into d from public.work_days where employee_id = p.id and ended_at is null and planned_end_at > now()
   order by started_at desc limit 1;
 if not found then raise exception 'Start a work day before sharing your location'; end if;
 if lat is null or lng is null or accuracy is null then raise exception 'Current GPS position required'; end if;
 insert into public.live_positions(employee_id, company_id, work_day_id, latitude, longitude, accuracy_meters)
 values (p.id, p.company_id, d.id, lat, lng, accuracy)
 on conflict (employee_id) do update set company_id = excluded.company_id, work_day_id = excluded.work_day_id,
   latitude = excluded.latitude, longitude = excluded.longitude, accuracy_meters = excluded.accuracy_meters, recorded_at = now();
end $$;
revoke all on function public.update_live_position(double precision, double precision, double precision) from public, anon;
grant execute on function public.update_live_position(double precision, double precision, double precision) to authenticated;

-- Finishing the day erases the live position rather than leaving it to expire.
create or replace function public.end_work_day(day_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from public.profiles where id = auth.uid() for update;
 perform 1 from public.work_days where id = day_id and employee_id = auth.uid() for update;
 if not found then raise exception 'Work day not found'; end if;
 update public.work_days set ended_at = least(now(), planned_end_at) where id = day_id and ended_at is null;
 -- Keep already due unanswered requests visible for the employer; cancel future requests only.
 update public.presence_requests set cancelled_at = now() where work_day_id = day_id and due_at > now() and cancelled_at is null;
 delete from public.live_positions where work_day_id = day_id;
end $$;

-- Team map: the chef reads live positions with the employee's name attached.
create function public.live_team()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare company uuid; result jsonb;
begin
 if public.current_profile_role() is distinct from 'chef' then raise exception 'Chef account required'; end if;
 company := public.current_profile_company_id();
 select coalesce(jsonb_agg(to_jsonb(t) order by t.employee_name), '[]'::jsonb) into result from (
   select p.id as employee_id, p.first_name || ' ' || p.last_name as employee_name,
     l.latitude, l.longitude, l.accuracy_meters, l.recorded_at, s.name as site_name
   from public.live_positions l
   join public.profiles p on p.id = l.employee_id
   join public.work_days d on d.id = l.work_day_id
   join public.sites s on s.id = d.site_id
   where l.company_id = company and l.recorded_at > now() - interval '15 minutes'
 ) t;
 return result;
end $$;
revoke all on function public.live_team() from public, anon;
grant execute on function public.live_team() to authenticated;

-- The employee's screen needs to know whether the chef enabled live sharing and
-- whether this employee has already agreed to it.
create or replace function public.employee_workspace()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; d public.work_days; today date;
begin
 select * into p from public.profiles where id = auth.uid();
 if p.role is distinct from 'employee' then raise exception 'Employee account required'; end if;
 select (now() at time zone time_zone)::date into today from public.companies where id = p.company_id;
 select * into d from public.work_days where employee_id = p.id
   and (work_date = today or (ended_at is null and planned_end_at > now())) order by started_at desc limit 1;
 return jsonb_build_object(
   'server_time', now(), 'date', today, 'day', case when d.id is null then null else to_jsonb(d) end,
   'consent', (select to_jsonb(c) from public.presence_consents c where employee_id = p.id),
   'location_mode', p.location_mode,
   'live_consent', (select to_jsonb(c) from public.live_location_consents c where employee_id = p.id),
   'sites', coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from public.sites s where company_id = p.company_id and is_active), '[]'::jsonb),
   'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.due_at) from public.presence_requests r where work_day_id = d.id and due_at <= now() and cancelled_at is null), '[]'::jsonb),
   'checks', coalesce((select jsonb_agg(to_jsonb(c)) from public.presence_check_ins c join public.presence_requests r on r.id = c.request_id where r.work_day_id = d.id), '[]'::jsonb),
   'declarations', coalesce((select jsonb_agg(to_jsonb(t)) from public.task_declarations t where work_day_id = d.id), '[]'::jsonb),
   'categories', coalesce((select jsonb_agg(to_jsonb(c) order by sort_order) from public.task_categories c), '[]'::jsonb),
   'codes', coalesce((select jsonb_agg(to_jsonb(c) order by sort_order) from public.task_codes c where is_active), '[]'::jsonb)
 );
end $$;

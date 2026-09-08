-- Point-in-time presence checks. No background/continuous location endpoint.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

update public.profiles set location_tracking_enabled = false,
  last_latitude = null, last_longitude = null, location_updated_at = null;
drop function public.update_own_employee_location(double precision, double precision);
revoke update (location_tracking_enabled) on public.profiles from authenticated;
-- Legacy columns remain readable for compatibility, but can never be reactivated.
alter table public.profiles add constraint profiles_no_continuous_tracking check (
  location_tracking_enabled = false and last_latitude is null
  and last_longitude is null and location_updated_at is null
);
-- Keep historical location_events inaccessible; do not erase historical records here.
revoke all on public.location_events from public, anon, authenticated;

-- All new profile/company creation must use the validated onboarding functions.
drop policy if exists profiles_insert_own_as_chef on public.profiles;
drop policy if exists companies_insert_self_serve on public.companies;
revoke insert on public.profiles, public.companies from authenticated;

alter table public.companies add column time_zone text not null default 'Africa/Casablanca';
alter table public.sites alter column location drop not null;
alter table public.sites add column is_active boolean not null default true;
alter table public.sites enable row level security;
grant select on public.sites to authenticated;
grant insert (company_id, name, address), update (name, address, is_active) on public.sites to authenticated;
create policy sites_company_read on public.sites for select to authenticated
  using (company_id = public.current_profile_company_id());
create policy sites_chef_insert on public.sites for insert to authenticated
  with check (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id() and length(trim(name)) between 1 and 120);
create policy sites_chef_update on public.sites for update to authenticated
  using (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id())
  with check (company_id = public.current_profile_company_id() and length(trim(name)) between 1 and 120);

create table public.presence_consents (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  notice_version text not null,
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create table public.presence_consent_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  notice_version text not null,
  accepted boolean not null,
  recorded_at timestamptz not null default now()
);
create index consent_events_employee_idx on public.presence_consent_events(employee_id, recorded_at);
create table public.work_days (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  work_date date not null,
  started_at timestamptz not null default now(),
  planned_end_at timestamptz not null,
  ended_at timestamptz,
  unique (employee_id, work_date),
  check (planned_end_at > started_at),
  check (ended_at is null or ended_at >= started_at)
);
create table public.presence_requests (
  id uuid primary key default gen_random_uuid(),
  work_day_id uuid not null references public.work_days(id) on delete cascade,
  employee_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  due_at timestamptz not null,
  expires_at timestamptz not null,
  cancelled_at timestamptz,
  notified_at timestamptz,
  notification_attempted_at timestamptz,
  check (expires_at > due_at)
);
create index requests_employee_day_idx on public.presence_requests(employee_id, work_day_id);
create index days_company_date_idx on public.work_days(company_id, work_date);
create index presence_requests_due_idx on public.presence_requests(due_at) where cancelled_at is null and notified_at is null;
create table public.presence_check_ins (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.presence_requests(id),
  employee_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  photo_path text unique,
  captured_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  accuracy_meters double precision check (accuracy_meters >= 0 and accuracy_meters < 100000),
  redacted_at timestamptz,
  check ((redacted_at is null and photo_path is not null and latitude is not null and longitude is not null and accuracy_meters is not null)
    or (redacted_at is not null and photo_path is null and latitude is null and longitude is null and accuracy_meters is null))
);
create index check_ins_company_time_idx on public.presence_check_ins(company_id, submitted_at);

create table public.task_categories (
  code text primary key,
  label_fr text not null,
  label_en text not null,
  sort_order integer not null default 0
);
create table public.task_codes (
  code text primary key,
  category_code text not null references public.task_categories(code),
  label_fr text not null,
  label_en text not null,
  unit text not null check (unit in ('unit', 'm')),
  is_active boolean not null default true,
  sort_order integer not null default 0
);
insert into public.task_categories values ('plumbing_hvac', 'Plomberie / CVC', 'Plumbing / HVAC', 1);
insert into public.task_codes (code, category_code, label_fr, label_en, unit, sort_order) values
 ('SAN_LAVABO', 'plumbing_hvac', 'Pose lavabo', 'Install washbasin', 'unit', 1),
 ('SAN_WC', 'plumbing_hvac', 'Pose WC', 'Install toilet', 'unit', 2),
 ('CVC_CLIM_MURAL', 'plumbing_hvac', 'Pose climatiseur mural', 'Install wall-mounted air conditioner', 'unit', 3),
 ('CVC_GAINE_DN100', 'plumbing_hvac', 'Pose gaine spirale DN100', 'Install spiral duct DN100', 'm', 4),
 ('CVC_GAINE_DN125', 'plumbing_hvac', 'Pose gaine spirale DN125', 'Install spiral duct DN125', 'm', 5),
 ('CVC_GAINE_DN160', 'plumbing_hvac', 'Pose gaine spirale DN160', 'Install spiral duct DN160', 'm', 6),
 ('PLB_PPR_DN25', 'plumbing_hvac', 'Pose réseau PPR DN25', 'Install PPR pipe DN25', 'm', 7),
 ('PLB_PPR_DN30', 'plumbing_hvac', 'Pose réseau PPR DN30', 'Install PPR pipe DN30', 'm', 8);
create table public.task_declarations (
  id uuid primary key default gen_random_uuid(),
  work_day_id uuid not null references public.work_days(id),
  employee_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  task_code text not null references public.task_codes(code),
  quantity numeric(10,2) not null check (quantity > 0 and quantity <= 100000),
  declared_at timestamptz not null default now(),
  unique (work_day_id, task_code)
);
create index declarations_company_day_idx on public.task_declarations(company_id, work_day_id);
create table private.push_tokens (
  token text primary key,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  updated_at timestamptz not null default now()
);

alter table public.presence_consents enable row level security;
alter table public.presence_consent_events enable row level security;
alter table public.work_days enable row level security;
alter table public.presence_requests enable row level security;
alter table public.presence_check_ins enable row level security;
alter table public.task_categories enable row level security;
alter table public.task_codes enable row level security;
alter table public.task_declarations enable row level security;
grant select on public.presence_consent_events, public.presence_consents, public.work_days, public.presence_requests,
 public.presence_check_ins, public.task_categories, public.task_codes, public.task_declarations to authenticated;
create policy consent_events_self_read on public.presence_consent_events for select to authenticated using (employee_id = auth.uid());
create policy consents_self_read on public.presence_consents for select to authenticated using (employee_id = auth.uid());
create policy days_read on public.work_days for select to authenticated using (
 employee_id = auth.uid() or (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id()));
-- Future times are not exposed, even through direct API calls or Realtime.
create policy requests_read on public.presence_requests for select to authenticated using (
 due_at <= now() and (employee_id = auth.uid() or (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id())));
create policy checks_read on public.presence_check_ins for select to authenticated using (
 submitted_at > now() - interval '30 days' and redacted_at is null and
 (employee_id = auth.uid() or (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id())));
create policy categories_read on public.task_categories for select to authenticated using (true);
create policy codes_read on public.task_codes for select to authenticated using (true);
create policy declarations_read on public.task_declarations for select to authenticated using (
 employee_id = auth.uid() or (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id()));

create function public.set_presence_consent(accepted boolean, version text default '2026-09-07')
returns void language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
 select * into p from public.profiles where id = auth.uid() for update;
 if accepted is null then raise exception 'Explicit agreement choice required'; end if;
 if p.role is distinct from 'employee' or (accepted and not p.is_active) then
   raise exception 'Employee account required';
 end if;
 if version is distinct from '2026-09-07' then raise exception 'Please read the current presence notice'; end if;
 insert into public.presence_consent_events(employee_id, notice_version, accepted) values (auth.uid(), version, accepted);
 if accepted then
   insert into public.presence_consents(employee_id, notice_version) values (auth.uid(), version)
   on conflict (employee_id) do update set notice_version = excluded.notice_version, accepted_at = now(), revoked_at = null;
 else
   update public.presence_consents set revoked_at = now() where employee_id = auth.uid();
   update public.work_days set ended_at = least(now(), planned_end_at) where employee_id = auth.uid() and ended_at is null;
   update public.presence_requests set cancelled_at = now() where employee_id = auth.uid() and cancelled_at is null
     and not exists (select 1 from public.presence_check_ins c where c.request_id = presence_requests.id);
   delete from private.push_tokens where employee_id = auth.uid();
 end if;
end $$;

create function public.start_work_day(declared_site_id uuid, duration_hours integer)
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
 if exists (select 1 from public.work_days where employee_id = p.id and (work_date = (now() at time zone tz)::date or (ended_at is null and planned_end_at > now()))) then
   raise exception 'A work day has already been declared';
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

create function public.end_work_day(day_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from public.profiles where id = auth.uid() for update;
 perform 1 from public.work_days where id = day_id and employee_id = auth.uid() for update;
 if not found then raise exception 'Work day not found'; end if;
 update public.work_days set ended_at = least(now(), planned_end_at) where id = day_id and ended_at is null;
 -- Keep already due unanswered requests visible for the employer; cancel future requests only.
 update public.presence_requests set cancelled_at = now() where work_day_id = day_id and due_at > now() and cancelled_at is null;
end $$;

create function public.submit_presence_check(request uuid, photo text, captured timestamptz, lat double precision, lng double precision, accuracy double precision)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.presence_requests; d public.work_days; result uuid;
begin
 perform 1 from public.profiles where id = auth.uid() for update;
 select * into r from public.presence_requests where id = request and employee_id = auth.uid();
 if not found then raise exception 'Presence request not found'; end if;
 select * into d from public.work_days where id = r.work_day_id for update;
 select * into r from public.presence_requests where id = request for update;
 if r.cancelled_at is not null or now() < r.due_at or now() > r.expires_at or d.ended_at is not null or now() > d.planned_end_at then
   raise exception 'This presence request is no longer active';
 end if;
 if not exists (select 1 from public.profiles where id = auth.uid() and is_active)
   or not exists (select 1 from public.presence_consents where employee_id = auth.uid() and revoked_at is null and notice_version = '2026-09-07') then
   raise exception 'Presence information and explicit agreement required';
 end if;
 if captured is null or captured < greatest(r.due_at, now() - interval '2 minutes') or captured > now() + interval '15 seconds' then
   raise exception 'Take a new photo and current GPS position';
 end if;
 if lat is null or lng is null or accuracy is null then raise exception 'Current GPS position required'; end if;
 if photo is null or photo not like auth.uid()::text || '/' || request::text || '/%'
   or not exists (select 1 from storage.objects where bucket_id = 'presence-proofs' and name = photo and created_at >= greatest(r.due_at, now() - interval '2 minutes')) then
   raise exception 'Presence photo is missing';
 end if;
 insert into public.presence_check_ins(request_id, employee_id, company_id, site_id, photo_path, captured_at, latitude, longitude, accuracy_meters)
 values (r.id, r.employee_id, r.company_id, d.site_id, photo, captured, lat, lng, accuracy) returning id into result;
 return result;
end $$;

create function public.declare_task(day_id uuid, code text, amount numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.work_days;
begin
 perform 1 from public.profiles where id = auth.uid() for update;
 select * into d from public.work_days where id = day_id and employee_id = auth.uid() for update;
 if not found or d.ended_at is not null or now() > d.planned_end_at then raise exception 'Start a work day before declaring tasks'; end if;
 if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then raise exception 'Employee account required'; end if;
 if not exists (select 1 from public.task_codes where task_codes.code = declare_task.code and is_active) then raise exception 'Choose a task from the catalogue'; end if;
 if amount is null or amount <= 0 or amount > 100000 or amount <> round(amount, 2) or amount::text in ('NaN', 'Infinity', '-Infinity') then raise exception 'Enter a valid quantity'; end if;
 if exists (select 1 from public.task_codes where task_codes.code = declare_task.code and unit = 'unit') and amount <> trunc(amount) then raise exception 'Enter a whole number of units'; end if;
 insert into public.task_declarations(work_day_id, employee_id, company_id, site_id, task_code, quantity)
 values (d.id, d.employee_id, d.company_id, d.site_id, code, amount)
 on conflict (work_day_id, task_code) do update set quantity = excluded.quantity, declared_at = now();
end $$;

create function public.register_presence_push(push_token text, language text default 'fr')
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from public.profiles where id = auth.uid() for update;
 if language is null or push_token is null or length(push_token) > 250 or push_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' or language not in ('fr', 'en') then raise exception 'Invalid push token'; end if;
 if not exists (select 1 from public.profiles where id = auth.uid() and role = 'employee' and is_active)
   or not exists (select 1 from public.presence_consents where employee_id = auth.uid() and revoked_at is null and notice_version = '2026-09-07') then raise exception 'Presence agreement required'; end if;
 insert into private.push_tokens(token, employee_id, locale) values (push_token, auth.uid(), language)
 on conflict (token) do update set employee_id = excluded.employee_id, locale = excluded.locale, updated_at = now();
end $$;
create function public.unregister_presence_push(push_token text)
returns void language sql security definer set search_path = '' as $$
 delete from private.push_tokens where token = push_token and employee_id = auth.uid();
$$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('presence-proofs', 'presence-proofs', false, 5242880, array['image/jpeg', 'image/png']);
create policy proof_upload on storage.objects for insert to authenticated with check (
 bucket_id = 'presence-proofs' and (storage.foldername(name))[1] = auth.uid()::text
 and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
 and exists (select 1 from public.presence_requests r join public.work_days d on d.id = r.work_day_id
   join public.presence_consents c on c.employee_id = r.employee_id
   where r.id::text = (storage.foldername(name))[2] and r.employee_id = auth.uid()
   and r.cancelled_at is null and now() between r.due_at and r.expires_at and d.ended_at is null and now() < d.planned_end_at
   and not exists (select 1 from public.presence_check_ins proof where proof.request_id = r.id)
   and c.revoked_at is null and c.notice_version = '2026-09-07'));
create policy proof_read on storage.objects for select to authenticated using (
 bucket_id = 'presence-proofs' and exists (select 1 from public.presence_check_ins c where c.photo_path = name));
create policy proof_discard_unsubmitted on storage.objects for delete to authenticated using (
 bucket_id = 'presence-proofs' and (storage.foldername(name))[1] = auth.uid()::text
 and not exists (select 1 from public.presence_check_ins c where c.photo_path = name));

-- Explicit function grants: SECURITY DEFINER functions are never callable anonymously.
revoke all on function public.set_presence_consent(boolean,text), public.start_work_day(uuid,integer),
 public.end_work_day(uuid), public.submit_presence_check(uuid,text,timestamptz,double precision,double precision,double precision),
 public.declare_task(uuid,text,numeric), public.register_presence_push(text,text), public.unregister_presence_push(text) from public, anon;
grant execute on function public.set_presence_consent(boolean,text), public.start_work_day(uuid,integer),
 public.end_work_day(uuid), public.submit_presence_check(uuid,text,timestamptz,double precision,double precision,double precision),
 public.declare_task(uuid,text,numeric), public.register_presence_push(text,text), public.unregister_presence_push(text) to authenticated;

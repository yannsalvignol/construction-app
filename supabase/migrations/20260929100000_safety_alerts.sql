-- Protection du travailleur isolé.
--
-- A worker alone on a site — in a trench, a plant room, a basement — has no
-- way to call for help if he is hurt and cannot reach his phone. This is the
-- feature that needs persistent location: an alert is worthless without the
-- position it happened at, and the phone is in a pocket when it matters.
--
-- Three ways an alert is raised:
--   sos          the worker pressed the button himself
--   no_movement  his phone stopped moving during a declared day and he did
--                not answer the check that followed
--   zone_exit    he left the chantier's zone, raised for his own attention
--
-- The alert belongs to the worker: he sees his own, he can cancel his own,
-- and it reaches his chef whether or not the chef is looking at the app.

create table public.safety_alerts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  work_day_id uuid references public.work_days(id) on delete set null,
  kind text not null check (kind in ('sos', 'no_movement', 'zone_exit')),
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  raised_at timestamptz not null default now(),
  -- Cleared by the worker himself (false alarm) or by a chef who has reached
  -- him. Who cleared it matters: "the chef saw it" and "he is fine" are not
  -- the same statement.
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution text check (resolution in ('cancelled', 'acknowledged'))
);

create index safety_alerts_open_idx
  on public.safety_alerts (company_id, raised_at desc)
  where resolved_at is null;
create index safety_alerts_employee_idx on public.safety_alerts (employee_id, raised_at desc);

alter table public.safety_alerts enable row level security;
grant select on public.safety_alerts to authenticated;

-- An employee sees his own; a chef sees his company's. Nobody writes directly:
-- raising and resolving go through the functions below, which decide what a
-- given caller may do.
create policy safety_alerts_read on public.safety_alerts for select to authenticated
  using (
    employee_id = auth.uid()
    or (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id())
  );

/**
 * Raises an alert for the caller. Returns the alert, or the one already open
 * of the same kind: a worker pressing SOS twice is frightened, not raising two
 * emergencies, and a watchdog that fires repeatedly must not flood the chef.
 */
create or replace function public.raise_safety_alert(
  alert_kind text,
  lat double precision default null,
  lng double precision default null,
  accuracy double precision default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  today public.work_days;
  existing uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or not me.is_active then raise exception 'Employee account required'; end if;
  if alert_kind not in ('sos', 'no_movement', 'zone_exit') then raise exception 'Unknown alert'; end if;

  select * into today
  from public.work_days
  where employee_id = me.id and ended_at is null
  order by started_at desc
  limit 1;

  select id into existing
  from public.safety_alerts
  where employee_id = me.id and kind = alert_kind and resolved_at is null;
  if existing is not null then
    -- Refresh the position: where he is now matters more than where he was.
    update public.safety_alerts
      set latitude = coalesce(lat, latitude),
          longitude = coalesce(lng, longitude),
          accuracy_meters = coalesce(accuracy, accuracy_meters)
      where id = existing;
    return existing;
  end if;

  insert into public.safety_alerts
    (employee_id, company_id, site_id, work_day_id, kind, latitude, longitude, accuracy_meters)
  values (me.id, me.company_id, today.site_id, today.id, alert_kind, lat, lng, accuracy)
  returning id into existing;
  return existing;
end;
$$;

revoke all on function public.raise_safety_alert(text, double precision, double precision, double precision) from public, anon;
grant execute on function public.raise_safety_alert(text, double precision, double precision, double precision) to authenticated;

/**
 * Closes an alert. The worker cancelling his own says "false alarm"; a chef
 * closing it says "I have seen this and reached him". The two are recorded
 * differently on purpose.
 */
create or replace function public.resolve_safety_alert(alert uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.safety_alerts;
begin
  select * into row from public.safety_alerts where id = alert;
  if row is null then raise exception 'Alert not found'; end if;

  if row.employee_id = auth.uid() then
    update public.safety_alerts
      set resolved_at = now(), resolved_by = auth.uid(), resolution = 'cancelled'
      where id = alert;
  elsif public.current_profile_role() = 'chef'
        and row.company_id = public.current_profile_company_id() then
    update public.safety_alerts
      set resolved_at = now(), resolved_by = auth.uid(), resolution = 'acknowledged'
      where id = alert;
  else
    raise exception 'Not allowed to resolve this alert';
  end if;
end;
$$;

revoke all on function public.resolve_safety_alert(uuid) from public, anon;
grant execute on function public.resolve_safety_alert(uuid) to authenticated;

/** The alerts still open for the caller's company, newest first. */
create or replace function public.open_safety_alerts()
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  site_name text,
  kind text,
  latitude double precision,
  longitude double precision,
  raised_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.employee_id,
    trim(p.first_name || ' ' || p.last_name),
    s.name,
    a.kind,
    a.latitude,
    a.longitude,
    a.raised_at
  from public.safety_alerts a
  join public.profiles p on p.id = a.employee_id
  left join public.sites s on s.id = a.site_id
  where a.resolved_at is null
    and a.company_id = public.current_profile_company_id()
  order by a.raised_at desc;
$$;

revoke all on function public.open_safety_alerts() from public, anon;
grant execute on function public.open_safety_alerts() to authenticated;

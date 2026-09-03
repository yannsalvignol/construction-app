-- ============================================================
-- Employee location sharing
--
-- Employees already had a "Location tracking" toggle in the chef's
-- employee-detail view (location_tracking_enabled, added in
-- employee_management), but nothing stored or read an actual
-- location yet. A tracking-enabled employee's device now calls
-- update_own_employee_location() every ~30s while the app is in
-- the foreground; the function is SECURITY DEFINER and re-checks
-- location_tracking_enabled itself rather than trusting the
-- client, so a device can't keep publishing location after a chef
-- has turned tracking off for that employee, and a client can't
-- write coordinates for anyone but itself.
--
-- Chefs already have full-column read access to their own
-- company's employee rows via profiles_select_company_as_chef
-- (see employees migration), so no new read policy is needed for
-- the map to see these columns.
--
-- Realtime is enabled on profiles so the chef's team map can
-- subscribe to location updates instead of polling.
-- ============================================================

alter table public.profiles
    add column last_latitude double precision,
    add column last_longitude double precision,
    add column location_updated_at timestamptz;

create or replace function public.update_own_employee_location(lat double precision, lng double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.profiles
    set last_latitude = lat,
        last_longitude = lng,
        location_updated_at = now()
    where id = auth.uid()
      and role = 'employee'
      and location_tracking_enabled = true;
end;
$$;

grant execute on function public.update_own_employee_location(double precision, double precision) to authenticated;

-- Drop a stale last-known position as soon as tracking is turned
-- off, so a chef's map can't show a fixed point that's just wherever
-- the employee happened to be when they were last toggled off.
create or replace function public.clear_location_on_tracking_disabled()
returns trigger
language plpgsql
as $$
begin
    if new.location_tracking_enabled = false and old.location_tracking_enabled = true then
        new.last_latitude := null;
        new.last_longitude := null;
        new.location_updated_at := null;
    end if;
    return new;
end;
$$;

create trigger profiles_clear_location_on_tracking_disabled
    before update on public.profiles
    for each row
    execute function public.clear_location_on_tracking_disabled();

do $$
begin
    alter publication supabase_realtime add table public.profiles;
exception
    when duplicate_object then null;
end $$;

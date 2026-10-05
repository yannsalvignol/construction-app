-- Off means gone, including the button.
--
-- The switch left the SOS button standing, on the reasoning that a man asking
-- for help cannot misfire. That reasoning is sound and it was not the
-- decision: a company that has turned the feature off should not have half of
-- it still on a worker's screen, and a chef who has switched it off should not
-- be woken by it.
--
-- So the whole thing goes — the card, the button, and the ability to raise an
-- alert at all. Refused on the server too, because a copy of the app that
-- predates this still has the button drawn, and a feature switched off that
-- still works for whoever has not updated is not switched off.
--
-- Alerts already open are left alone. They are a man who asked for help before
-- the switch was thrown, and stranding them unresolvable would be the one
-- outcome worse than a false alarm. Resolving them keeps working; no new ones
-- can be raised.
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
  if not exists (
    select 1 from public.companies co where co.id = me.company_id and co.lone_worker_enabled
  ) then
    raise exception 'Safety alerts are not enabled for your company';
  end if;

  select * into today
  from public.work_days
  where employee_id = me.id and ended_at is null
  order by started_at desc
  limit 1;

  select id into existing
  from public.safety_alerts
  where employee_id = me.id and kind = alert_kind and resolved_at is null;
  if existing is not null then
    update public.safety_alerts
      set latitude = coalesce(lat, latitude),
          longitude = coalesce(lng, longitude),
          accuracy_meters = coalesce(accuracy, accuracy_meters)
      where id = existing;
    return existing;
  end if;

  insert into public.safety_alerts (employee_id, company_id, site_id, work_day_id, kind, latitude, longitude, accuracy_meters)
  values (me.id, me.company_id, today.site_id, today.id, alert_kind, lat, lng, accuracy)
  returning id into existing;
  return existing;
end $$;

revoke all on function public.raise_safety_alert(text, double precision, double precision, double precision) from public, anon;
grant execute on function public.raise_safety_alert(text, double precision, double precision, double precision) to authenticated;

-- Turning the lone-worker watch off without shipping an app.
--
-- It is the one feature here that acts on its own: nobody presses anything,
-- the server notices a man has stopped moving, asks him, and tells his chef
-- when he does not answer. That is what makes it worth having, and it is also
-- why it needs an off switch that does not go through a week of App Store
-- review. A watch that misfires on a crew working in a basement wakes a chef
-- at midnight for nothing, twice, and then nobody believes the third one.
--
-- Per company rather than globally, because the usual case is one customer
-- for whom it does not fit — and because turning it off everywhere is still
-- one statement:
--
--   update public.companies set lone_worker_enabled = false;
--
-- What it switches off is the AUTOMATIC watch: the stillness question, the
-- alert that follows silence, and the position reporting the phone does to
-- feed them. The SOS button stays. That is a man deciding he needs help, it
-- cannot misfire, and taking it away from him is not what anybody means by
-- "turn off the false alarms".
alter table public.companies
  add column if not exists lone_worker_enabled boolean not null default true;

-- The sweep that asks a still worker whether he is alright.
create or replace function public.claim_lone_worker_questions()
returns table(work_day_id uuid, token text, locale text)
language sql security definer set search_path = '' as $$
  with due as (
    select w.work_day_id from public.lone_worker_watches w
    join public.work_days d on d.id = w.work_day_id
    join public.profiles p on p.id = w.employee_id
    join public.companies co on co.id = p.company_id
    where w.asked_at is null
      and now() - w.last_moved_at >= public.lone_worker_still_for()
      and d.ended_at is null and d.planned_end_at > now()
      and p.is_active and p.lone_worker_watch
      and co.lone_worker_enabled
    order by w.last_moved_at limit 50 for update of w skip locked
  ), asked as (
    update public.lone_worker_watches w set asked_at = now(), ask_attempted_at = now(), updated_at = now()
    where w.work_day_id in (select work_day_id from due)
    returning w.work_day_id, w.employee_id
  )
  select a.work_day_id, t.token, t.locale
  from asked a join private.push_tokens t on t.employee_id = a.employee_id;
$$;

-- The sweep that raises the alert when nobody answers.
create or replace function public.raise_due_lone_worker_alerts()
returns integer
language plpgsql security definer set search_path = public as $$
declare raised integer := 0; row record;
begin
  for row in
    select w.* from public.lone_worker_watches w
    join public.work_days d on d.id = w.work_day_id
    join public.profiles p on p.id = w.employee_id
    join public.companies co on co.id = p.company_id
    where w.asked_at is not null
      and now() - w.asked_at >= public.lone_worker_answer_window()
      and d.ended_at is null and d.planned_end_at > now()
      and p.is_active and p.lone_worker_watch
      and co.lone_worker_enabled
      and not exists (
        select 1 from public.safety_alerts a
        where a.employee_id = w.employee_id and a.kind = 'no_movement' and a.resolved_at is null
      )
    for update of w skip locked
  loop
    insert into public.safety_alerts
      (employee_id, company_id, site_id, work_day_id, kind, latitude, longitude)
    select row.employee_id, row.company_id, d.site_id, row.work_day_id, 'no_movement', row.latitude, row.longitude
    from public.work_days d where d.id = row.work_day_id;
    raised := raised + 1;
  end loop;
  return raised;
end $$;

revoke all on function public.claim_lone_worker_questions(), public.raise_due_lone_worker_alerts()
  from public, anon, authenticated;
grant execute on function public.claim_lone_worker_questions(), public.raise_due_lone_worker_alerts()
  to service_role;

-- The heartbeat stops keeping a watch nobody is watching with. Live sharing is
-- a separate agreement and is left alone — a chef's map is not a safety watch.
create or replace function public.safety_heartbeat(
  lat double precision default null,
  lng double precision default null,
  accuracy double precision default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  today public.work_days;
  watch public.lone_worker_watches;
  live boolean := false;
  moved boolean;
  enabled boolean := false;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role is distinct from 'employee' or not me.is_active then
    return json_build_object('day_open', false, 'live', false, 'asked', false);
  end if;
  select co.lone_worker_enabled into enabled from public.companies co where co.id = me.company_id;

  select * into today
  from public.work_days
  where employee_id = me.id and ended_at is null and planned_end_at > now()
  order by started_at desc
  limit 1;
  if not found then
    return json_build_object('day_open', false, 'live', false, 'asked', false);
  end if;

  if coalesce(enabled, true) and me.lone_worker_watch and lat is not null and lng is not null then
    select * into watch from public.lone_worker_watches where work_day_id = today.id for update;
    moved := watch.work_day_id is null
      or watch.latitude is null
      or public.distance_meters(lat, lng, watch.latitude, watch.longitude) >= public.lone_worker_moved_meters();

    insert into public.lone_worker_watches (work_day_id, employee_id, company_id, latitude, longitude)
    values (today.id, me.id, me.company_id, lat, lng)
    on conflict (work_day_id) do update set
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      updated_at = now(),
      last_moved_at = case when moved then now() else public.lone_worker_watches.last_moved_at end,
      asked_at = case when moved then null else public.lone_worker_watches.asked_at end,
      ask_attempted_at = case when moved then null else public.lone_worker_watches.ask_attempted_at end;
  end if;

  live := me.location_mode = 'live'
    and exists (
      select 1 from public.live_location_consents
      where employee_id = me.id
        and revoked_at is null
        and notice_version = public.live_notice_version()
    );

  if live and lat is not null and lng is not null and accuracy is not null then
    begin
      perform public.update_live_position(lat, lng, accuracy);
    exception when others then
      live := false;
    end;
  end if;

  return json_build_object(
    'day_open', true,
    'live', live,
    'watching', coalesce(enabled, true) and me.lone_worker_watch,
    'asked', coalesce(enabled, true) and (select w.asked_at is not null from public.lone_worker_watches w where w.work_day_id = today.id)
  );
end;
$$;

revoke all on function public.safety_heartbeat(double precision, double precision, double precision) from public, anon;
grant execute on function public.safety_heartbeat(double precision, double precision, double precision) to authenticated;

-- The worker's screen needs to know, for two reasons: the phone should stop
-- reporting its position for a watch nobody reads — that is battery on a
-- chantier — and the card should not claim to be watching over a man it is
-- not. Added field only; an app that predates it carries on as today, which
-- costs battery but is never unsafe.
create or replace function public.employee_workspace()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; d public.work_days; today date; gap interval; tail integer;
        day_open boolean; watch_enabled boolean;
begin
 select * into p from public.profiles where id = auth.uid();
 if p.role is distinct from 'employee' then raise exception 'Employee account required'; end if;
 select (now() at time zone time_zone)::date into today from public.companies where id = p.company_id;
 select co.lone_worker_enabled into watch_enabled from public.companies co where co.id = p.company_id;
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
   -- Whether the company runs the watch at all. His own switch decides
   -- nothing when this is false.
   'lone_worker_available', coalesce(watch_enabled, true),
   'lone_worker_asked', day_open and coalesce(watch_enabled, true) and coalesce(
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

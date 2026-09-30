-- Protection du travailleur isolé, decided on the server.
--
-- The watchdog used to live on the phone: the background task fed each fix to a
-- timer in JS, and that timer raised the alert. It could never have worked. iOS
-- delivers background location on distance, not on time, so a phone that stops
-- moving stops emitting fixes, the task stops running, and the timer that was
-- supposed to notice he had stopped moving never runs again. The watchdog was
-- blind in exactly the case it exists for.
--
-- Inverted here: silence is the signal. The phone reports where it is whenever it
-- moves; the server holds the deadline. A worker face down in a trench sends
-- nothing, and sending nothing is what raises the alarm. Nothing has to run on a
-- phone that has gone quiet, which is the whole point.

-- His own choice about his own phone, kept on the server because the server is
-- now what watches. On by default: a safety feature you have to find and switch
-- on protects only the workers who were never in danger.
alter table public.profiles add column if not exists lone_worker_watch boolean not null default true;

/** No movement for this long during a declared day raises the question. */
create or replace function public.lone_worker_still_for() returns interval
language sql immutable set search_path = '' as $$ select interval '25 minutes' $$;
/** How long he has to answer before the alert goes out. */
create or replace function public.lone_worker_answer_window() returns interval
language sql immutable set search_path = '' as $$ select interval '3 minutes' $$;
/** Movement below this is a worker shifting his weight, not walking. */
create or replace function public.lone_worker_moved_meters() returns double precision
language sql immutable set search_path = '' as $$ select 35::double precision $$;

create table public.lone_worker_watches (
  work_day_id uuid primary key references public.work_days(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  latitude double precision,
  longitude double precision,
  -- The last time he was somewhere else. The deadline counts from here.
  last_moved_at timestamptz not null default now(),
  -- Set when the question goes out. The answer window counts from here, and it
  -- is set whether or not a push could be delivered: a worker whose phone has no
  -- notification permission is still a worker who may be on the ground.
  asked_at timestamptz,
  ask_attempted_at timestamptz,
  updated_at timestamptz not null default now()
);
create index lone_worker_watches_due_idx on public.lone_worker_watches (last_moved_at) where asked_at is null;
create index lone_worker_watches_asked_idx on public.lone_worker_watches (asked_at) where asked_at is not null;

alter table public.lone_worker_watches enable row level security;
grant select on public.lone_worker_watches to authenticated;
grant select, insert, update, delete on public.lone_worker_watches to service_role;
-- He can see his own watch; nobody writes directly. His chef has no business
-- reading the minute-by-minute stillness of his hands — only the alert if one
-- is raised.
create policy lone_worker_watches_read on public.lone_worker_watches for select to authenticated
  using (employee_id = auth.uid());

-- The chef's side of the alert, so it is pushed once rather than on every sweep.
alter table public.safety_alerts add column if not exists chef_notified_at timestamptz;
alter table public.safety_alerts add column if not exists chef_notify_attempted_at timestamptz;

/**
 * One call per fix, serving the watch first and the chef's map second.
 *
 * Returns whether the declared day is still open — the only reason the phone has
 * to keep reporting — and whether the server is currently waiting for an answer,
 * so the card can put the question on screen as well as in a notification.
 */
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
begin
  select * into me from public.profiles where id = auth.uid();
  -- No exception on the ordinary "nothing to watch" answers: the task reads the
  -- reply and stands itself down. An exception here would be indistinguishable
  -- from a network failure, and standing down on a network failure would mean a
  -- hurt worker stops being watched because a tunnel had no signal.
  if me is null or me.role is distinct from 'employee' or not me.is_active then
    return json_build_object('day_open', false, 'live', false, 'asked', false);
  end if;

  select * into today
  from public.work_days
  where employee_id = me.id and ended_at is null and planned_end_at > now()
  order by started_at desc
  limit 1;
  if not found then
    return json_build_object('day_open', false, 'live', false, 'asked', false);
  end if;

  if me.lone_worker_watch and lat is not null and lng is not null then
    select * into watch from public.lone_worker_watches where work_day_id = today.id for update;
    -- A first fix is movement by definition: there is no earlier place to
    -- compare it to, and starting the clock as though he were already still
    -- would question him 25 minutes into a day he has been walking all morning.
    moved := watch.work_day_id is null
      or watch.latitude is null
      or public.distance_meters(lat, lng, watch.latitude, watch.longitude) >= public.lone_worker_moved_meters();

    insert into public.lone_worker_watches (work_day_id, employee_id, company_id, latitude, longitude)
    values (today.id, me.id, me.company_id, lat, lng)
    on conflict (work_day_id) do update set
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      updated_at = now(),
      -- Moving again answers the question by itself: a man who walks 35 metres
      -- is not lying at the bottom of a trench.
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
    -- Same auth.uid(), so the existing guards still apply; a refusal there is the
    -- map's problem and must not stop the watch.
    begin
      perform public.update_live_position(lat, lng, accuracy);
    exception when others then
      live := false;
    end;
  end if;

  return json_build_object(
    'day_open', true,
    'live', live,
    'watching', me.lone_worker_watch,
    'asked', (select w.asked_at is not null from public.lone_worker_watches w where w.work_day_id = today.id)
  );
end;
$$;

revoke all on function public.safety_heartbeat(double precision, double precision, double precision) from public, anon;
grant execute on function public.safety_heartbeat(double precision, double precision, double precision) to authenticated;

/** "Je vais bien." The clock starts again from his answer. */
create or replace function public.confirm_lone_worker_ok()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.lone_worker_watches
    set last_moved_at = now(), asked_at = null, ask_attempted_at = null, updated_at = now()
    where employee_id = auth.uid() and asked_at is not null;
  -- Answering also clears an alert his silence already raised: he is plainly
  -- conscious, and leaving it open would send his chef running for nothing.
  update public.safety_alerts
    set resolved_at = now(), resolved_by = auth.uid(), resolution = 'cancelled'
    where employee_id = auth.uid() and kind = 'no_movement' and resolved_at is null;
end $$;
revoke all on function public.confirm_lone_worker_ok() from public, anon;
grant execute on function public.confirm_lone_worker_ok() to authenticated;

/** His own choice, and his alone: no chef RPC writes this column. */
create or replace function public.set_lone_worker_watch(enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set lone_worker_watch = enabled where id = auth.uid();
  if not enabled then
    delete from public.lone_worker_watches where employee_id = auth.uid();
  end if;
end $$;
revoke all on function public.set_lone_worker_watch(boolean) from public, anon;
grant execute on function public.set_lone_worker_watch(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The sweep. Run from the same cron worker as the presence notifications.
-- ---------------------------------------------------------------------------

/**
 * Asks everybody who has gone still. Marks them asked whether or not a push can
 * be sent, because the answer window has to run for a worker whose phone refuses
 * notifications just as it does for everybody else; the returned rows are only
 * those we can also reach by push.
 */
create or replace function public.claim_lone_worker_questions()
returns table(work_day_id uuid, token text, locale text)
language sql security definer set search_path = '' as $$
  with due as (
    select w.work_day_id from public.lone_worker_watches w
    join public.work_days d on d.id = w.work_day_id
    join public.profiles p on p.id = w.employee_id
    where w.asked_at is null
      and now() - w.last_moved_at >= public.lone_worker_still_for()
      and d.ended_at is null and d.planned_end_at > now()
      and p.is_active and p.lone_worker_watch
    order by w.last_moved_at limit 50 for update of w skip locked
  ), asked as (
    update public.lone_worker_watches w set asked_at = now(), ask_attempted_at = now(), updated_at = now()
    where w.work_day_id in (select work_day_id from due)
    returning w.work_day_id, w.employee_id
  )
  select a.work_day_id, t.token, t.locale
  from asked a join private.push_tokens t on t.employee_id = a.employee_id;
$$;

/**
 * Raises the alert for everybody who did not answer. Pure SQL on purpose: no
 * push service, no network, nothing that can fail between his silence and his
 * chef being told.
 */
create or replace function public.raise_due_lone_worker_alerts()
returns integer
language plpgsql security definer set search_path = public as $$
declare raised integer := 0; row record;
begin
  for row in
    select w.* from public.lone_worker_watches w
    join public.work_days d on d.id = w.work_day_id
    join public.profiles p on p.id = w.employee_id
    where w.asked_at is not null
      and now() - w.asked_at >= public.lone_worker_answer_window()
      and d.ended_at is null and d.planned_end_at > now()
      and p.is_active and p.lone_worker_watch
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

/** The chefs to tell about alerts nobody has been pushed about yet. */
create or replace function public.claim_safety_alert_notifications()
returns table(alert_id uuid, token text, locale text, employee_name text, kind text)
language sql security definer set search_path = '' as $$
  with due as (
    select a.id from public.safety_alerts a
    where a.resolved_at is null and a.chef_notified_at is null
      and (a.chef_notify_attempted_at is null or a.chef_notify_attempted_at < now() - interval '5 minutes')
    order by a.raised_at limit 50 for update of a skip locked
  ), claimed as (
    update public.safety_alerts a set chef_notify_attempted_at = now()
    where a.id in (select id from due)
    returning a.id, a.company_id, a.employee_id, a.kind
  )
  select c.id, t.token, t.locale,
    trim(p.first_name || ' ' || p.last_name), c.kind
  from claimed c
  join public.profiles chef on chef.company_id = c.company_id and chef.role = 'chef' and chef.is_active
  join private.push_tokens t on t.employee_id = chef.id
  join public.profiles p on p.id = c.employee_id;
$$;

create or replace function public.finish_safety_alert_notification(alert uuid, dead_token text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if dead_token is not null then delete from private.push_tokens where token = dead_token;
  else update public.safety_alerts set chef_notified_at = now() where id = alert; end if;
end $$;

revoke all on function public.claim_lone_worker_questions(), public.raise_due_lone_worker_alerts(),
  public.claim_safety_alert_notifications(), public.finish_safety_alert_notification(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_lone_worker_questions(), public.raise_due_lone_worker_alerts(),
  public.claim_safety_alert_notifications(), public.finish_safety_alert_notification(uuid, text)
  to service_role;

/** The watch state the worker's own screen reads. */
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
   'lone_worker_watch', p.lone_worker_watch,
   'lone_worker_asked', coalesce((select w.asked_at is not null from public.lone_worker_watches w where w.work_day_id = d.id), false),
   'sites', coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from public.sites s where company_id = p.company_id and is_active), '[]'::jsonb),
   'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.due_at) from public.presence_requests r where work_day_id = d.id and due_at <= now() and cancelled_at is null), '[]'::jsonb),
   'checks', coalesce((select jsonb_agg(to_jsonb(c)) from public.presence_check_ins c join public.presence_requests r on r.id = c.request_id where r.work_day_id = d.id), '[]'::jsonb),
   'declarations', coalesce((select jsonb_agg(to_jsonb(t)) from public.task_declarations t where work_day_id = d.id), '[]'::jsonb),
   'categories', coalesce((select jsonb_agg(to_jsonb(c) order by sort_order) from public.task_categories c), '[]'::jsonb),
   'codes', coalesce((select jsonb_agg(to_jsonb(c) order by sort_order) from public.task_codes c where is_active), '[]'::jsonb)
 );
end $$;

/**
 * A chef's device, so an alert reaches him when the app is closed.
 *
 * Separate from register_presence_push, which demands the presence agreement: a
 * chef is not consenting to be watched, he is asking to be told when one of his
 * men stops answering. The same token table serves both, and unregistering is
 * already keyed on the caller.
 */
create or replace function public.register_chef_push(push_token text, language text default 'fr')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if language is null or push_token is null or length(push_token) > 250
     or push_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$'
     or language not in ('fr', 'en') then raise exception 'Invalid push token'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'chef' and is_active) then
    raise exception 'Chef account required';
  end if;
  insert into private.push_tokens(token, employee_id, locale) values (push_token, auth.uid(), language)
  on conflict (token) do update set employee_id = excluded.employee_id, locale = excluded.locale, updated_at = now();
end $$;
revoke all on function public.register_chef_push(text, text) from public, anon;
grant execute on function public.register_chef_push(text, text) to authenticated;

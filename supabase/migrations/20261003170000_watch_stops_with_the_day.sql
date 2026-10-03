-- The watch asks nothing of a worker who is not working.
--
-- "Aucun mouvement détecté depuis un moment" sat on the home screen of a man
-- who had not started a day — sometimes of a man who had finished one hours
-- earlier. The question had been asked while a day was open, the day then
-- ended, and nothing took the question back: the row in lone_worker_watches
-- kept its asked_at, and the screen kept reading it.
--
-- The sweeps were already right — they only ever ask or raise on an open day —
-- so nothing was ever escalated. It was only the screen, which is bad enough:
-- protection du travailleur isolé earns its keep by being believed, and a card
-- crying wolf at a man on his sofa is how that is lost.
--
-- Two ends. Closing a day withdraws any question outstanding on it, and the
-- worker's own screen reports a question only while the day it belongs to is
-- running.

create or replace function public.end_work_day(day_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.work_days; gap interval;
begin
 perform 1 from public.profiles where id = auth.uid() for update;
 select * into d from public.work_days where id = day_id and employee_id = auth.uid() for update;
 if not found then raise exception 'Work day not found'; end if;
 if d.last_sample_at is not null and d.last_sample_inside is not null then
   gap := least(now(), d.planned_end_at) - d.last_sample_at;
   if gap > interval '0' and gap <= public.max_attributed_gap() then
     update public.work_days set
       seconds_inside = seconds_inside + case when d.last_sample_inside then extract(epoch from gap)::integer else 0 end,
       seconds_outside = seconds_outside + case when d.last_sample_inside then 0 else extract(epoch from gap)::integer end
     where id = d.id;
   end if;
 end if;
 update public.work_days set ended_at = least(now(), planned_end_at) where id = day_id and ended_at is null;
 -- Keep already due unanswered requests visible for the employer; cancel future requests only.
 update public.presence_requests set cancelled_at = now() where work_day_id = day_id and due_at > now() and cancelled_at is null;
 delete from public.live_positions where work_day_id = day_id;
 -- A question put to a man who has since gone home is withdrawn, not left
 -- hanging on his screen. The watch row stays: it is the record of the day.
 update public.lone_worker_watches
   set asked_at = null, ask_attempted_at = null, updated_at = now()
   where work_day_id = day_id and asked_at is not null;
end $$;

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
   -- Only while the day it was asked on is still running. A day that ended an
   -- hour ago cannot be waiting to hear he is alright.
   'lone_worker_asked', day_open and coalesce(
     (select w.asked_at is not null from public.lone_worker_watches w where w.work_day_id = d.id), false),
   'sites', coalesce((
     select jsonb_agg(
       to_jsonb(s) || jsonb_build_object('awaiting', (
         select count(*)
         from public.quote_assignments a
         left join public.quote_line_steps st on st.id = a.step_id
         join public.quote_lines l on l.id = coalesce(a.quote_line_id, st.quote_line_id)
         join public.site_quotes q on q.id = l.quote_id
         where a.employee_id = p.id
           and q.site_id = s.id
           and q.status = 'validated'
           and (a.step_id is null or st.done_at is null)
           and (
             a.quote_line_id is null
             or l.quantity is null
             or coalesce((select sum(x.quantity) from public.task_declarations x
                          where x.quote_line_id = l.id), 0) < l.quantity
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

-- Standing still on a chantier is time on the chantier.
--
-- The counters only ever advanced when a new position arrived, and a gap longer
-- than ten minutes was thrown away on the grounds that nobody knew where he had
-- been. That reasoning had a hole in it: iOS delivers background location on
-- distance, so a phone that stops moving stops reporting. The silence the rule
-- discarded is produced by exactly the thing it was meant to doubt — a man
-- standing where he already was. A fitter on a ladder for two hours scored zero
-- minutes on site, and the chef's map showed his pin on the chantier the whole
-- time, because the last known position is right there.
--
-- So the gap is attributed to the zone of the last reading. The bound is the
-- day itself rather than a sample interval: nothing is ever credited past the
-- planned end, and a day that is closed banks only up to that point. A phone
-- switched off mid-afternoon will read as on site until the day's end, which is
-- the price of counting stillness, and the right trade — the common case is a
-- man working, not a man hiding.
--
-- The two counters still say nothing about where he was when away, and no
-- position is kept. Only the arithmetic over them changed.

create or replace function public.max_attributed_gap() returns interval
language sql immutable set search_path = '' as $$ select interval '12 hours' $$;

-- The day the worker's own screen reads, with the time since the last reading
-- counted in. Without this the counters only moved when a position arrived, so
-- a worker standing still watched them sit at zero while his day ran — the
-- banked figures were correct and the screen was still wrong.
create or replace function public.employee_workspace()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; d public.work_days; today date; gap interval; tail integer;
begin
 select * into p from public.profiles where id = auth.uid();
 if p.role is distinct from 'employee' then raise exception 'Employee account required'; end if;
 select (now() at time zone time_zone)::date into today from public.companies where id = p.company_id;
 select * into d from public.work_days where employee_id = p.id
   and (work_date = today or (ended_at is null and planned_end_at > now())) order by started_at desc limit 1;

 -- What has run since the last reading, not yet banked. end_work_day banks the
 -- same interval by the same rule, so the figure does not jump when he finishes.
 tail := 0;
 if d.id is not null and d.ended_at is null and d.last_sample_at is not null and d.last_sample_inside is not null then
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
   'lone_worker_asked', coalesce((select w.asked_at is not null from public.lone_worker_watches w where w.work_day_id = d.id), false),
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

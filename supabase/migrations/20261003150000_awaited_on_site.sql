-- What is waiting for him, said before he picks the chantier.
--
-- A worker opens the app on a list of his company's sites and has to know
-- which one he was expected at. The assignments exist from the moment the chef
-- hands the work out, but until now they were only visible once a day had been
-- started on the right site — which is after the one decision they could have
-- helped with.
--
-- Counted per site: the lines and the operations the chef put his name on that
-- are not finished. A line is finished when its quoted quantity has been
-- declared; an operation when somebody has ticked it. Work already done is not
-- waiting for anybody, and a site that still shows a number after the crew
-- cleared it would be read as noise within a week.

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
           -- An operation he was named on, still unticked.
           and (a.step_id is null or st.done_at is null)
           -- A line he was named on, whose quoted quantity is not reached. A
           -- line the devis put no figure against is never reached, which is
           -- correct: its operations are the only thing that finishes it.
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

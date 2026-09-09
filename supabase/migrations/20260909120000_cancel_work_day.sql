-- Cancelling a work day declared by mistake — the wrong site, or a day started and
-- not actually worked. Unlike finishing, this leaves no record at all.
--
-- It is refused as soon as the day produced anything: a submitted presence proof or
-- a declared task belongs to the company's records, exactly as for employee removal.
-- Those cases end the day instead, which keeps what happened.
create function public.cancel_work_day(day_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.work_days;
begin
 perform 1 from public.profiles where id = auth.uid() for update;
 select * into d from public.work_days where id = day_id and employee_id = auth.uid() for update;
 if not found then raise exception 'Work day not found'; end if;
 if d.ended_at is not null or d.planned_end_at <= now() then
   raise exception 'Only an open work day can be cancelled';
 end if;
 if exists (select 1 from public.task_declarations where work_day_id = d.id) then
   raise exception 'Tasks were declared on this day. Finish it instead.';
 end if;
 if exists (select 1 from public.presence_check_ins c
   join public.presence_requests r on r.id = c.request_id where r.work_day_id = d.id) then
   raise exception 'A presence check was answered on this day. Finish it instead.';
 end if;
 -- presence_requests and live_positions cascade; nothing else points at the day.
 delete from public.work_days where id = d.id;
end $$;
revoke all on function public.cancel_work_day(uuid) from public, anon;
grant execute on function public.cancel_work_day(uuid) to authenticated;

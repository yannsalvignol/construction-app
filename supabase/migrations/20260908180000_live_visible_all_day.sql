-- An employee sharing their position must stay on the chef's map for the whole
-- declared day.
--
-- The previous 15-minute window made them vanish whenever they stood still with
-- the app closed, because iOS only emits background updates on movement. A pin
-- that disappears reads as "gone", which is worse and less honest than a pin the
-- chef can see is 40 minutes old — so visibility is now bound to the work day
-- being open, and the client shows how old each position is.
--
-- The privacy limits are unchanged: nothing survives the end of the day, nothing
-- survives a withdrawal, and no trail is ever accumulated.
drop policy live_positions_read on public.live_positions;
create policy live_positions_read on public.live_positions for select to authenticated using (
  exists (select 1 from public.work_days d where d.id = live_positions.work_day_id
    and d.ended_at is null and d.planned_end_at > now())
  and (employee_id = auth.uid()
    or (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id())));

create or replace function public.live_team()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare company uuid; result jsonb;
begin
 if public.current_profile_role() is distinct from 'chef' then raise exception 'Chef account required'; end if;
 company := public.current_profile_company_id();
 select coalesce(jsonb_agg(to_jsonb(t) order by t.employee_name), '[]'::jsonb) into result from (
   select p.id as employee_id, p.first_name || ' ' || p.last_name as employee_name,
     l.latitude, l.longitude, l.accuracy_meters, l.recorded_at, s.name as site_name
   from public.live_positions l
   join public.profiles p on p.id = l.employee_id
   join public.work_days d on d.id = l.work_day_id
   join public.sites s on s.id = d.site_id
   where l.company_id = company and d.ended_at is null and d.planned_end_at > now()
 ) t;
 return result;
end $$;
revoke all on function public.live_team() from public, anon;
grant execute on function public.live_team() to authenticated;

-- A day that simply expired without the employee closing it would otherwise leave
-- its last position behind for good; the retention job now clears those too.
create or replace function public.redact_expired_presence_evidence()
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
 -- Also catches a previous run that deleted the file then failed before redaction.
 update public.presence_check_ins c set photo_path = null, latitude = null, longitude = null, accuracy_meters = null, redacted_at = now()
 where c.submitted_at <= now() - interval '30 days' and c.redacted_at is null
   and not exists (select 1 from storage.objects o where o.bucket_id = 'presence-proofs' and o.name = c.photo_path);
 get diagnostics affected = row_count;
 delete from private.presence_push_receipts where created_at < now() - interval '1 day';
 delete from private.push_tokens where updated_at < now() - interval '90 days';
 delete from public.live_positions p using public.work_days d
   where d.id = p.work_day_id and (d.ended_at is not null or d.planned_end_at <= now());
 return affected;
end $$;
revoke all on function public.redact_expired_presence_evidence() from public, anon, authenticated;
grant execute on function public.redact_expired_presence_evidence() to service_role;

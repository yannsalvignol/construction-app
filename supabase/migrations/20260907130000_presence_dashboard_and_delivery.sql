create function public.chef_dashboard()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare company uuid; today date; result jsonb;
begin
 if public.current_profile_role() is distinct from 'chef' then raise exception 'Chef account required'; end if;
 company := public.current_profile_company_id();
 select (now() at time zone time_zone)::date into today from public.companies where id = company;
 with days as (select * from public.work_days where company_id = company and work_date = today),
 tasks as (select t.* from public.task_declarations t join days d on d.id = t.work_day_id),
 recent_days as (
   select id, employee_id, row_number() over (partition by employee_id order by work_date desc) as rank
   from public.work_days where company_id = company
 ), repeated as (
   select t.employee_id, t.site_id, t.task_code, t.quantity
   from public.task_declarations t join recent_days d on d.id = t.work_day_id
   where d.rank <= 3
   group by t.employee_id, t.site_id, t.task_code, t.quantity having count(*) = 3
 ), productivity as (
   select c.code, c.label_fr, c.label_en, c.unit, sum(t.quantity) as quantity, count(distinct t.employee_id) as employees
   from tasks t join public.task_codes c on c.code = t.task_code group by c.code
 ), flags as (
   select p.id as employee_id, p.first_name || ' ' || p.last_name as employee_name,
     c.label_fr, c.label_en, r.quantity, c.unit, s.name as site_name
   from repeated r join public.profiles p on p.id = r.employee_id
   join public.task_codes c on c.code = r.task_code join public.sites s on s.id = r.site_id
 )
 select jsonb_build_object(
   'date', today,
   'employees', (select count(*) from public.profiles where company_id = company and role = 'employee'),
   'confirmed', (select count(distinct c.employee_id) from public.presence_check_ins c join public.presence_requests r on r.id = c.request_id join days d on d.id = r.work_day_id),
   'to_review', (select count(distinct r.employee_id) from public.presence_requests r join days d on d.id = r.work_day_id
     where r.cancelled_at is null and (r.expires_at < now() or d.ended_at is not null)
     and r.due_at <= now() and not exists (select 1 from public.presence_check_ins c where c.request_id = r.id)),
   'declared_hours', (select coalesce(round(sum(extract(epoch from (least(coalesce(ended_at, now()), planned_end_at) - started_at)) / 3600)::numeric, 1), 0) from days),
   'declarations', (select count(*) from tasks),
   'contributors', (select count(distinct employee_id) from tasks),
   'productivity', coalesce((select jsonb_agg(to_jsonb(productivity) order by code) from productivity), '[]'::jsonb),
   'flags', coalesce((select jsonb_agg(to_jsonb(flags) order by employee_name) from flags), '[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.chef_dashboard() from public, anon;
grant execute on function public.chef_dashboard() to authenticated;

create table private.presence_push_receipts (
  ticket_id text primary key,
  request_id uuid not null references public.presence_requests(id) on delete cascade,
  push_token text not null,
  created_at timestamptz not null default now(),
  check_after timestamptz not null default now() + interval '15 minutes',
  resolved_at timestamptz,
  outcome text
);
create index push_receipts_pending_idx on private.presence_push_receipts(check_after) where resolved_at is null;

-- Server-only delivery outbox. A short lease permits retry after network failures.
create function public.claim_presence_notifications()
returns table(request_id uuid, token text, locale text, expires_at timestamptz) language sql security definer set search_path = '' as $$
 with candidates as (
   select r.id from public.presence_requests r
   join public.work_days d on d.id = r.work_day_id
   join public.profiles p on p.id = r.employee_id
   join public.presence_consents c on c.employee_id = r.employee_id
   where r.due_at <= now() and r.expires_at > now() and r.cancelled_at is null and r.notified_at is null
     and (r.notification_attempted_at is null or r.notification_attempted_at < now() - interval '5 minutes')
     and d.ended_at is null and d.planned_end_at > now() and p.is_active and c.revoked_at is null and c.notice_version = '2026-09-07'
     and not exists (select 1 from public.presence_check_ins proof where proof.request_id = r.id)
     and exists (select 1 from private.push_tokens pt where pt.employee_id = r.employee_id)
   order by r.due_at limit 50 for update of r skip locked
 ), claimed as (
   update public.presence_requests set notification_attempted_at = now()
   where id in (select id from candidates) returning id, employee_id, expires_at
 )
 select c.id, t.token, t.locale, c.expires_at from claimed c join private.push_tokens t on t.employee_id = c.employee_id;
$$;
create function public.finish_presence_notification(request uuid, push_token text, ticket text default null, dead_token boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if dead_token then delete from private.push_tokens where token = push_token;
 elsif ticket is not null then
   insert into private.presence_push_receipts(ticket_id, request_id, push_token)
   values (ticket, request, push_token) on conflict (ticket_id) do nothing;
   update public.presence_requests set notified_at = now() where id = request;
 end if;
end $$;
create function public.claim_presence_receipts()
returns table(ticket_id text) language sql security definer set search_path = '' as $$
 with candidates as (
   select r.ticket_id from private.presence_push_receipts r
   where r.resolved_at is null and r.check_after <= now()
   order by r.check_after limit 100 for update skip locked
 )
 update private.presence_push_receipts r set check_after = now() + interval '5 minutes'
 where r.ticket_id in (select c.ticket_id from candidates c) returning r.ticket_id;
$$;
create function public.resolve_presence_receipt(ticket text, result text)
returns void language plpgsql security definer set search_path = '' as $$
declare receipt private.presence_push_receipts;
begin
 select * into receipt from private.presence_push_receipts where ticket_id = ticket for update;
 if not found or receipt.resolved_at is not null then return; end if;
 update private.presence_push_receipts set resolved_at = now(), outcome = result where ticket_id = ticket;
 if result = 'DeviceNotRegistered' then delete from private.push_tokens where token = receipt.push_token; end if;
 if result <> 'ok' then
   -- Retry while the request is still open. A receipt error is never an absence.
   update public.presence_requests set notified_at = null where id = receipt.request_id and expires_at > now() and cancelled_at is null;
 end if;
end $$;
create function public.expired_presence_photos()
returns table(path text) language sql security definer set search_path = '' as $$
 select o.name from storage.objects o where o.bucket_id = 'presence-proofs' and (
   exists (select 1 from public.presence_check_ins c where c.photo_path = o.name and c.submitted_at < now() - interval '30 days')
   or (o.created_at < now() - interval '1 day' and not exists (select 1 from public.presence_check_ins c where c.photo_path = o.name))
 ) limit 100;
$$;
create function public.redact_expired_presence_evidence()
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
 return affected;
end $$;
revoke all on function public.claim_presence_notifications(), public.finish_presence_notification(uuid,text,text,boolean), public.claim_presence_receipts(), public.resolve_presence_receipt(text,text), public.expired_presence_photos(), public.redact_expired_presence_evidence() from public, anon, authenticated;
grant execute on function public.claim_presence_notifications(), public.finish_presence_notification(uuid,text,text,boolean), public.claim_presence_receipts(), public.resolve_presence_receipt(text,text), public.expired_presence_photos(), public.redact_expired_presence_evidence() to service_role;

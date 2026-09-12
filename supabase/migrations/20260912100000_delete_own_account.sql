-- Self-service account deletion.
--
-- App Store guideline 5.1.1(v) and Google Play's account-deletion policy both
-- require that anyone who can create an account in the app can also delete it
-- from the app. The two roles own different things, so deletion has two shapes:
--
-- * An employee owns their sign-in and their personal data: name, phone, avatar,
--   push tokens, live position, and the photo/GPS evidence they submitted. They
--   do not own the company's record that work was declared under their name —
--   the same rule remove_employee applies. So the sign-in goes, personal data is
--   erased or redacted immediately, and if any work was declared the profile row
--   stays behind as an anonymous tombstone so those records keep their foreign
--   keys. With nothing declared there is nothing to keep and the profile goes.
--
-- * A chef owns the company. There is one chef per company, so deleting the
--   chef's account deletes the company with everything in it: sites, records,
--   and the sign-ins of its employees, who would otherwise be left with an
--   account that can no longer do anything.
--
-- The tombstone is why profiles no longer cascade from auth.users: a profile
-- must be able to outlive its sign-in. remove_employee relied on that cascade
-- and now deletes the profile itself.
--
-- SQL cannot delete Storage bytes, so the function leaves the objects alone and
-- returns their paths. The delete-account Edge Function removes them with the
-- service role; a proof it misses is picked up by the presence worker's orphan
-- sweep (expired_presence_photos) once nothing references it any more.

alter table public.profiles drop constraint profiles_id_fkey;
alter table public.profiles add column deleted_at timestamptz;

create or replace function public.remove_employee(employee uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.profiles;
begin
 if public.current_profile_role() is distinct from 'chef' then raise exception 'Chef account required'; end if;
 select * into target from public.profiles where id = employee for update;
 if not found or target.company_id is distinct from public.current_profile_company_id() then
   raise exception 'Employee not found';
 end if;
 if target.role is distinct from 'employee' then raise exception 'Only an employee can be removed'; end if;
 if exists (select 1 from public.work_days where employee_id = employee)
    or exists (select 1 from public.task_declarations where employee_id = employee)
    or exists (select 1 from public.presence_check_ins where employee_id = employee) then
   raise exception 'This employee has declared work. Suspend the account instead.';
 end if;
 -- Removing the sign-in stops them rejoining with the company code; the profile
 -- no longer cascades from it, so it is deleted explicitly.
 delete from auth.users where id = employee;
 delete from public.profiles where id = employee;
end $$;

create function public.delete_own_account()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; files jsonb; has_records boolean; members uuid[];
begin
 select * into me from public.profiles where id = auth.uid() for update;
 if not found then raise exception 'Profile not found'; end if;
 if me.deleted_at is not null then raise exception 'Account already deleted'; end if;

 if me.role = 'chef' then
   select array_agg(id) into members from public.profiles where company_id = me.company_id;
   select coalesce(jsonb_agg(f), '[]'::jsonb) into files from (
     select 'presence-proofs' as bucket, photo_path as path from public.presence_check_ins
     where company_id = me.company_id and photo_path is not null
     union all
     select 'avatars', o.name from storage.objects o
     where o.bucket_id = 'avatars' and (storage.foldername(o.name))[1] = any(members::text[])
   ) f;
   -- Company records reference sites, work days and the company without a
   -- cascade, so they go first, in dependency order.
   delete from public.task_declarations where company_id = me.company_id;
   delete from public.presence_check_ins where company_id = me.company_id;
   delete from public.presence_requests where company_id = me.company_id;
   delete from public.live_positions where company_id = me.company_id;
   delete from public.work_days where company_id = me.company_id;
   delete from auth.users where id = any(members);
   -- Cascades profiles (consents, shifts, location events, push tokens) and sites (zones).
   delete from public.companies where id = me.company_id;
   return jsonb_build_object('files', files);
 end if;

 has_records := exists (select 1 from public.work_days where employee_id = me.id)
   or exists (select 1 from public.task_declarations where employee_id = me.id)
   or exists (select 1 from public.presence_check_ins where employee_id = me.id);
 select coalesce(jsonb_agg(f), '[]'::jsonb) into files from (
   select 'presence-proofs' as bucket, photo_path as path from public.presence_check_ins
   where employee_id = me.id and photo_path is not null
   union all
   select 'avatars', o.name from storage.objects o
   where o.bucket_id = 'avatars' and (storage.foldername(o.name))[1] = me.id::text
 ) f;
 -- Evidence is redacted now rather than at the 30-day mark: the record that a
 -- check-in happened is the company's, the photo and position are the person's.
 update public.presence_check_ins set photo_path = null, latitude = null, longitude = null,
   accuracy_meters = null, redacted_at = now() where employee_id = me.id and redacted_at is null;
 -- Nothing should keep waiting for a person who is gone.
 update public.presence_requests set cancelled_at = now() where employee_id = me.id and cancelled_at is null and expires_at > now();
 update public.work_days set ended_at = now() where employee_id = me.id and ended_at is null;
 delete from auth.users where id = me.id;
 if has_records then
   delete from private.push_tokens where employee_id = me.id;
   delete from public.live_positions where employee_id = me.id;
   delete from public.location_events where employee_id = me.id;
   delete from public.shifts where employee_id = me.id;
   -- Consent events stay: they are the company's proof that the evidence it
   -- still holds a record of was collected with agreement, and carry no identity.
   update public.profiles set first_name = 'Compte supprimé', last_name = '', phone = null, username = null,
     avatar_url = null, employee_password = null, is_active = false, notifications_enabled = false,
     location_mode = 'checkpoint', deleted_at = now(), updated_at = now()
   where id = me.id;
 else
   delete from public.profiles where id = me.id;
 end if;
 return jsonb_build_object('files', files);
end $$;
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- Tombstones are not staff: keep them out of the headcount. Same body as the
-- previous definition apart from the deleted_at filters.
create or replace function public.chef_dashboard()
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
   'employees', (select count(*) from public.profiles where company_id = company and role = 'employee' and deleted_at is null),
   'active_employees', (select count(*) from public.profiles where company_id = company and role = 'employee' and is_active and deleted_at is null),
   'confirmed', (select count(distinct c.employee_id) from public.presence_check_ins c join public.presence_requests r on r.id = c.request_id join days d on d.id = r.work_day_id),
   'to_review', (select count(distinct r.employee_id) from public.presence_requests r join days d on d.id = r.work_day_id
     where r.cancelled_at is null and (r.expires_at < now() or d.ended_at is not null)
     and r.due_at <= now() and not exists (select 1 from public.presence_check_ins c where c.request_id = r.id)),
   'declared_hours', (select coalesce(round(sum(extract(epoch from (least(coalesce(ended_at, now()), planned_end_at) - started_at)) / 3600)::numeric, 1), 0) from days),
   'declarations', (select count(*) from tasks),
   'contributors', (select count(distinct employee_id) from tasks),
   'productivity', coalesce((select jsonb_agg(to_jsonb(productivity) order by quantity desc, code) from productivity), '[]'::jsonb),
   'flags', coalesce((select jsonb_agg(to_jsonb(flags) order by employee_name) from flags), '[]'::jsonb)
 ) into result;
 return result;
end $$;

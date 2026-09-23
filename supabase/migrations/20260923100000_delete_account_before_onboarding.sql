-- Deleting an account that never finished onboarding.
--
-- Signing up creates the auth user; the profile (and the company, for a chef)
-- only appears on the next screen. Someone who stops in between — or whose
-- signup failed there — had no way out: delete_own_account() raised
-- 'Profile not found' and the account stayed, which is the case App Store
-- guideline 5.1.1(v) is about. There is nothing to erase but the sign-in
-- itself, so that is what happens.

create or replace function public.delete_own_account()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; files jsonb; has_records boolean; members uuid[];
begin
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 select * into me from public.profiles where id = auth.uid() for update;
 if not found then
   -- Signed up, never onboarded: no profile, no company, no records.
   delete from auth.users where id = auth.uid();
   return jsonb_build_object('files', '[]'::jsonb);
 end if;
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
   delete from public.task_declarations where company_id = me.company_id;
   delete from public.presence_check_ins where company_id = me.company_id;
   delete from public.presence_requests where company_id = me.company_id;
   delete from public.live_positions where company_id = me.company_id;
   delete from public.work_days where company_id = me.company_id;
   delete from public.planned_shifts where company_id = me.company_id;
   delete from auth.users where id = any(members);
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
 update public.presence_check_ins set photo_path = null, latitude = null, longitude = null,
   accuracy_meters = null, redacted_at = now() where employee_id = me.id and redacted_at is null;
 update public.presence_requests set cancelled_at = now() where employee_id = me.id and cancelled_at is null and expires_at > now();
 update public.work_days set ended_at = now() where employee_id = me.id and ended_at is null;
 delete from auth.users where id = me.id;
 if has_records then
   delete from private.push_tokens where employee_id = me.id;
   delete from public.live_positions where employee_id = me.id;
   delete from public.location_events where employee_id = me.id;
   delete from public.planned_shifts where employee_id = me.id;
   update public.profiles set first_name = 'Compte supprimé', last_name = '', phone = null, username = null,
     avatar_url = null, employee_password = null, is_active = false, notifications_enabled = false,
     location_mode = 'checkpoint', deleted_at = now(), updated_at = now()
   where id = me.id;
 else
   delete from public.profiles where id = me.id;
 end if;
 return jsonb_build_object('files', files);
end $$;

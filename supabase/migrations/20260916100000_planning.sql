-- Planning: shifts created by the chef on the web, published to the phones.
--
-- A shift is a calendar day plus a start and end time, not two timestamps:
-- "Youssef, Les Oliviers, mardi 08:00–17:00" is how a planning is written and
-- read, and a date + times survives the chef's browser being in a different
-- zone from the site. The chef can be scheduled too (a shift is attached to
-- any profile of the company).
--
-- Nothing is visible to an employee until the chef *sends* the planning:
-- publish_planning() stamps published_at and the send-planning Edge Function
-- pushes a notification. Editing a shift after it was sent clears the stamp
-- so the week shows as "modified since last send" and is sent again.
--
-- The never-used public.shifts table from the initial schema (two
-- timestamps, a zone) is dropped in favour of this one.

drop table public.shifts;

create table public.planned_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  site_id uuid not null references public.sites(id),
  work_date date not null,
  start_time time not null,
  end_time time not null,
  note text check (note is null or length(note) <= 300),
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index planned_shifts_company_date_idx on public.planned_shifts(company_id, work_date);
create index planned_shifts_employee_date_idx on public.planned_shifts(employee_id, work_date);
create trigger planned_shifts_updated_at before update on public.planned_shifts
  for each row execute function public.set_updated_at();

-- A change after a send is a change the phones do not have yet.
create function public.planned_shift_unpublish_on_change()
returns trigger language plpgsql as $$
begin
  if new.employee_id is distinct from old.employee_id or new.site_id is distinct from old.site_id
     or new.work_date is distinct from old.work_date or new.start_time is distinct from old.start_time
     or new.end_time is distinct from old.end_time or new.note is distinct from old.note then
    new.published_at := null;
  end if;
  return new;
end $$;
create trigger planned_shifts_unpublish before update on public.planned_shifts
  for each row execute function public.planned_shift_unpublish_on_change();

alter table public.planned_shifts enable row level security;
-- Employees read their own sent shifts; the chef reads the whole company.
create policy planned_shifts_read on public.planned_shifts for select to authenticated using (
  company_id = public.current_profile_company_id()
  and (public.current_profile_role() = 'chef' or (employee_id = auth.uid() and published_at is not null))
);
create policy planned_shifts_chef_insert on public.planned_shifts for insert to authenticated with check (
  public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id()
  and created_by = auth.uid()
  and exists (select 1 from public.profiles p where p.id = planned_shifts.employee_id and p.company_id = planned_shifts.company_id and p.deleted_at is null)
  and exists (select 1 from public.sites s where s.id = planned_shifts.site_id and s.company_id = planned_shifts.company_id and s.is_active)
);
create policy planned_shifts_chef_update on public.planned_shifts for update to authenticated
  using (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id())
  with check (
    company_id = public.current_profile_company_id()
    and exists (select 1 from public.profiles p where p.id = planned_shifts.employee_id and p.company_id = planned_shifts.company_id and p.deleted_at is null)
    and exists (select 1 from public.sites s where s.id = planned_shifts.site_id and s.company_id = planned_shifts.company_id)
  );
create policy planned_shifts_chef_delete on public.planned_shifts for delete to authenticated
  using (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id());
grant select, insert, update, delete on public.planned_shifts to authenticated;

-- One row per send, so the web can show "envoyé le … à N personnes".
create table public.planning_sends (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  sent_at timestamptz not null default now(),
  sent_by uuid references public.profiles(id) on delete set null,
  shifts integer not null,
  recipients integer not null,
  check (to_date >= from_date)
);
create index planning_sends_company_idx on public.planning_sends(company_id, sent_at desc);
alter table public.planning_sends enable row level security;
create policy planning_sends_chef_read on public.planning_sends for select to authenticated
  using (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id());
grant select on public.planning_sends to authenticated;

-- Marks every shift in the range as sent and returns who is concerned, so the
-- Edge Function can notify exactly those people. Employees with no shift in
-- the range are not notified. Sending an empty range is refused: there is
-- nothing to tell anyone.
create function public.publish_planning(from_date date, to_date date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare company uuid; touched integer; people uuid[];
begin
  if public.current_profile_role() is distinct from 'chef' then raise exception 'Chef account required'; end if;
  if to_date < from_date or to_date - from_date > 31 then raise exception 'Invalid date range'; end if;
  company := public.current_profile_company_id();
  select array_agg(distinct employee_id) into people from public.planned_shifts
    where company_id = company and work_date between from_date and to_date;
  if people is null then raise exception 'Nothing to send for this period'; end if;
  update public.planned_shifts set published_at = now()
    where company_id = company and work_date between from_date and to_date;
  get diagnostics touched = row_count;
  insert into public.planning_sends(company_id, from_date, to_date, sent_by, shifts, recipients)
    values (company, from_date, to_date, auth.uid(), touched, coalesce(array_length(people, 1), 0));
  return jsonb_build_object('shifts', touched, 'employees', to_jsonb(people));
end $$;
revoke all on function public.publish_planning(date, date) from public, anon;
grant execute on function public.publish_planning(date, date) to authenticated;

-- Push tokens live in the private schema; only the service role (the
-- send-planning function) may read them, and only for one company's people.
create function public.planning_push_targets(people uuid[])
returns table(token text, locale text, employee_id uuid) language sql security definer set search_path = '' as $$
  select t.token, t.locale, t.employee_id from private.push_tokens t
  join public.profiles p on p.id = t.employee_id
  where t.employee_id = any(people) and p.is_active and p.notifications_enabled and p.deleted_at is null;
$$;
revoke all on function public.planning_push_targets(uuid[]) from public, anon, authenticated;
grant execute on function public.planning_push_targets(uuid[]) to service_role;

-- The tombstone branch of delete_own_account referenced public.shifts.
create or replace function public.delete_own_account()
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

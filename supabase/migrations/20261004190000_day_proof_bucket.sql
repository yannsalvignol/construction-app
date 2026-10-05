-- Where a start-of-day photo lives, and who may look at it.
--
-- Not the presence-proofs bucket: its upload policy is bound to an open
-- presence request, and these photos are taken before the day exists at all.
-- They are the condition of the day, not an answer to a question asked during
-- it.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('day-proofs', 'day-proofs', false, 5242880, array['image/jpeg', 'image/png']);

-- Into his own folder, by an active employee who has agreed to presence.
-- There is no day to tie the upload to yet, so the bound is the folder, the
-- size and the type; an orphan costs five megabytes and is deletable.
create policy day_proof_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'day-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.profiles p
    join public.presence_consents c on c.employee_id = p.id
    where p.id = auth.uid() and p.is_active and p.role = 'employee'
      and c.revoked_at is null and c.notice_version = '2026-09-07'
  )
);

-- The man who took it, and the chef who asked for it. Nobody else.
create policy day_proof_read on storage.objects for select to authenticated using (
  bucket_id = 'day-proofs'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.work_day_photos w
      where w.photo_path = name
        and public.current_profile_role() = 'chef'
        and w.company_id = public.current_profile_company_id()
    )
  )
);

-- An upload that never became a day's proof is his to discard; one that did
-- is evidence and stays.
create policy day_proof_discard_unattached on storage.objects for delete to authenticated using (
  bucket_id = 'day-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
  and not exists (select 1 from public.work_day_photos w where w.photo_path = name)
);

-- The chef's view of a man's week carries the proofs he asked for. Without
-- this the photos exist and nobody ever sees them, which is the same as not
-- taking them.
create or replace function public.employee_activity(employee uuid, window_days integer default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles; subject public.profiles; since date;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null then raise exception 'Sign in required'; end if;
  select * into subject from public.profiles where id = employee;
  if subject is null then raise exception 'Not allowed'; end if;
  if not (me.id = subject.id or (me.role = 'chef' and me.company_id = subject.company_id)) then
    raise exception 'Not allowed';
  end if;
  since := (now() at time zone (select time_zone from public.companies where id = subject.company_id))::date
           - (greatest(window_days, 1) - 1);

  return (
    with days as (
      select d.id, d.work_date, d.started_at, d.ended_at, d.planned_end_at, d.site_id,
             (select s.name from public.sites s where s.id = d.site_id) as site_name,
             extract(epoch from (least(coalesce(d.ended_at, now()), d.planned_end_at) - d.started_at)) / 3600 as hours
      from public.work_days d
      where d.employee_id = subject.id and d.work_date >= since
    )
    select jsonb_build_object(
      'person', jsonb_build_object(
        'id', subject.id, 'first_name', subject.first_name, 'last_name', subject.last_name,
        'username', subject.username, 'is_active', subject.is_active),
      'day_count', (select count(*) from days),
      'hours_total', (select round(coalesce(sum(hours), 0)::numeric, 1) from days),
      'site_count', (select count(distinct site_id) from days),
      'days', coalesce((
        select jsonb_agg(jsonb_build_object(
          'work_date', d.work_date,
          'site_name', d.site_name,
          'hours', round(d.hours::numeric, 1),
          'open', d.ended_at is null,
          'tasks', coalesce((
            select jsonb_agg(jsonb_build_object(
              'label_fr', c.label_fr, 'label_en', c.label_en, 'unit', c.unit, 'quantity', t.quantity
            ) order by t.quantity desc)
            from public.task_declarations t
            left join public.task_codes c on c.code = t.task_code
            where t.work_day_id = d.id
          ), '[]'::jsonb),
          -- The photos the chef required, if he required any.
          'photos', coalesce((
            select jsonb_agg(jsonb_build_object(
              'kind', w.kind, 'path', w.photo_path, 'captured_at', w.captured_at
            ) order by w.kind)
            from public.work_day_photos w where w.work_day_id = d.id
          ), '[]'::jsonb)
        ) order by d.work_date desc, d.started_at desc)
        from days d
      ), '[]'::jsonb)
    )
  );
end $$;

revoke all on function public.employee_activity(uuid, integer) from public, anon;
grant execute on function public.employee_activity(uuid, integer) to authenticated;

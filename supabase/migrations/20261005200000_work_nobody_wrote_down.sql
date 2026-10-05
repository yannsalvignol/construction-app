-- Work that is in neither list.
--
-- Everything an employee can declare today has to be chosen: a code from the
-- catalogue, or a line of the devis. Both are written before the week starts
-- and neither survives contact with a chantier. The shuttering had to be
-- rebuilt because the first pour went wrong. Half a day was lost waiting for
-- the crane. A neighbour's wall was damaged and patched. None of that has a
-- code, all of it is work, and the man who did it currently has nowhere to
-- say so — so he says it to his chef on the phone, or not at all, and the
-- record of the day is missing the part that explains it.
--
-- Free text, deliberately. The point is the cases nobody anticipated; a
-- dropdown of anticipated ones would be the catalogue again.
create table public.extra_declarations (
  id uuid primary key default gen_random_uuid(),
  work_day_id uuid not null references public.work_days(id) on delete cascade,
  employee_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  -- Long enough for what happened and why, short enough to stay a note.
  description text not null check (length(btrim(description)) between 1 and 500),
  declared_at timestamptz not null default now()
);
create index extra_declarations_by_day on public.extra_declarations (work_day_id, declared_at);
create index extra_declarations_by_company on public.extra_declarations (company_id, declared_at desc);

alter table public.extra_declarations enable row level security;
grant select on public.extra_declarations to authenticated;

-- His own, or his company's if he runs it. The same shape as every other
-- record of work: the man who did it and the chef who is accountable for it.
create policy extra_declarations_read on public.extra_declarations for select to authenticated using (
  employee_id = auth.uid()
  or (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id())
);

/**
 * Writes one.
 *
 * Tied to an open day on purpose, like every other declaration: a note about
 * a chantier is evidence of having been there, and evidence recorded three
 * weeks later is a recollection. The day carries the chantier, so nothing
 * here can be attributed to a site he was not on.
 */
create or replace function public.declare_extra(day_id uuid, description text)
returns public.extra_declarations
language plpgsql security definer set search_path = '' as $$
declare d public.work_days; row public.extra_declarations; text_in text;
begin
  perform 1 from public.profiles where id = auth.uid() for update;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'employee' and is_active) then
    raise exception 'Employee account required';
  end if;
  select * into d from public.work_days where id = day_id and employee_id = auth.uid() for update;
  if not found or d.ended_at is not null or now() > d.planned_end_at then
    raise exception 'Start a work day before declaring tasks';
  end if;
  text_in := btrim(coalesce(description, ''));
  if length(text_in) = 0 then raise exception 'Write what you did'; end if;
  if length(text_in) > 500 then raise exception 'Keep it under 500 characters'; end if;
  -- Twenty in a day is somebody using the field for something else.
  if (select count(*) from public.extra_declarations where work_day_id = d.id) >= 20 then
    raise exception 'Too many entries for one day';
  end if;
  insert into public.extra_declarations(work_day_id, employee_id, company_id, site_id, description)
  values (d.id, d.employee_id, d.company_id, d.site_id, text_in)
  returning * into row;
  return row;
end $$;
revoke all on function public.declare_extra(uuid, text) from public, anon;
grant execute on function public.declare_extra(uuid, text) to authenticated;

/**
 * Takes one back, while the day it belongs to is still open.
 *
 * A mistake should be correctable; a record of a finished day should not. The
 * same line the rest of the app draws — what is declared stays declared once
 * the day is closed.
 */
create or replace function public.delete_extra(entry uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.work_days;
begin
  select w.* into d from public.work_days w
    join public.extra_declarations e on e.work_day_id = w.id
   where e.id = entry and e.employee_id = auth.uid();
  if not found then raise exception 'Entry not found'; end if;
  if d.ended_at is not null or now() > d.planned_end_at then
    raise exception 'That day is closed';
  end if;
  delete from public.extra_declarations where id = entry and employee_id = auth.uid();
end $$;
revoke all on function public.delete_extra(uuid) from public, anon;
grant execute on function public.delete_extra(uuid) to authenticated;

-- The chef's view of a man's week gains them, beside the coded tasks. A note
-- that nobody reads is the same as no note.
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
          -- Said in his own words, because the catalogue had no word for it.
          'notes', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', e.id, 'description', e.description, 'declared_at', e.declared_at
            ) order by e.declared_at)
            from public.extra_declarations e where e.work_day_id = d.id
          ), '[]'::jsonb),
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

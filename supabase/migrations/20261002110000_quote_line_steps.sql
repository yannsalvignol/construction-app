-- The operations a devis line breaks down into.
--
-- "Groupe moteur + alternateur 315 kVA insonorisé, posé en toiture" is a line
-- on a devis and a week of work on a chantier. The quantity against it moves
-- from 0 to 1 and tells nobody what has actually been done. The plots are laid
-- on Monday; power, control and earth are connected on Thursday. Those are the
-- facts a worker has, and the ones a chef wants.
--
-- A step is done once, by one person, on one day — it is an operation, not a
-- measurement, so there is no quantity and no partial. Undoing is allowed: the
-- usual reason to untick is that it was ticked by mistake.
--
-- Not every line has steps. Supply-only items, lump sums and lines that are
-- already a single operation get none, and a line with no steps behaves exactly
-- as it did before.

create table public.quote_line_steps (
  id uuid primary key default gen_random_uuid(),
  quote_line_id uuid not null references public.quote_lines(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  position integer not null,
  label text not null check (length(btrim(label)) between 1 and 200),
  -- Who finished it and on which declared day, so the chef can see the work in
  -- the same terms as everything else.
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  work_day_id uuid references public.work_days(id) on delete set null,
  unique (quote_line_id, position)
);
create index quote_line_steps_line_idx on public.quote_line_steps (quote_line_id, position);

alter table public.quote_line_steps enable row level security;
grant select on public.quote_line_steps to authenticated;

-- Everyone in the company reads them: the chef to follow the chantier, the
-- worker to see what is left. Nobody writes directly; set_quote_line_step
-- decides what a given caller may tick.
create policy quote_line_steps_read on public.quote_line_steps for select to authenticated
  using (company_id = public.current_profile_company_id());

/**
 * Ticks an operation off, or unticks it.
 *
 * Guarded exactly like declare_quote_line, and for the same reason: the day must
 * be the caller's, open and unfinished, the account active, and the line must
 * belong to a validated devis of the very chantier the day was declared on, so
 * nobody advances another site's work.
 */
create or replace function public.set_quote_line_step(step uuid, done boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  d public.work_days;
  s public.quote_line_steps;
begin
  perform 1 from public.profiles where id = auth.uid() for update;
  if done is null then raise exception 'Say whether the step is done'; end if;

  select * into d from public.work_days
  where employee_id = auth.uid() and ended_at is null and planned_end_at > now()
  order by started_at desc limit 1;
  if not found then raise exception 'Start a work day before declaring tasks'; end if;

  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Employee account required';
  end if;

  select st.* into s
  from public.quote_line_steps st
  join public.quote_lines l on l.id = st.quote_line_id
  join public.site_quotes q on q.id = l.quote_id
  where st.id = step
    and q.site_id = d.site_id
    and q.company_id = d.company_id
    and q.status = 'validated'
  for update of st;
  if not found then
    raise exception 'That step does not belong to this site''s quote';
  end if;

  if done then
    -- Ticking an already-ticked step is not an error and does not reassign it:
    -- the person who did the work keeps the credit.
    if s.done_at is null then
      update public.quote_line_steps
        set done_at = now(), done_by = auth.uid(), work_day_id = d.id
        where id = step;
    end if;
  else
    update public.quote_line_steps
      set done_at = null, done_by = null, work_day_id = null
      where id = step;
  end if;
end $$;

revoke all on function public.set_quote_line_step(uuid, boolean) from public, anon;
grant execute on function public.set_quote_line_step(uuid, boolean) to authenticated;

-- Dropped rather than replaced: the returned row gains a column, and
-- create-or-replace cannot change a function's return type.
drop function if exists public.day_quote_lines(uuid);

/** The devis lines for a day, now carrying their operations. */
create function public.day_quote_lines(day_id uuid)
returns table (
  line_id uuid,
  lot text,
  label text,
  unit text,
  quoted numeric,
  declared_total numeric,
  declared_today numeric,
  steps jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.lot,
    l.label,
    l.unit,
    l.quantity,
    coalesce((select sum(x.quantity) from public.task_declarations x where x.quote_line_id = l.id), 0),
    coalesce((
      select sum(x.quantity) from public.task_declarations x
      where x.quote_line_id = l.id and x.work_day_id = day_id
    ), 0),
    -- Nested rather than a second round trip: the task screen draws a line and
    -- its operations together or not at all.
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'step_id', st.id,
        'label', st.label,
        'done', st.done_at is not null,
        -- Named only when somebody else did it: "done by me" is already obvious
        -- from the tick, and the worker's own name adds nothing.
        'done_by_name', case
          when st.done_at is null or st.done_by = auth.uid() then null
          else (select trim(p.first_name || ' ' || p.last_name) from public.profiles p where p.id = st.done_by)
        end
      ) order by st.position)
      from public.quote_line_steps st where st.quote_line_id = l.id
    ), '[]'::jsonb)
  from public.work_days d
  join public.site_quotes q on q.site_id = d.site_id and q.status = 'validated'
  join public.quote_lines l on l.quote_id = q.id and l.kind = 'work'
  where d.id = day_id
    and d.employee_id = auth.uid()
  order by l.position;
$$;

revoke all on function public.day_quote_lines(uuid) from public, anon;
grant execute on function public.day_quote_lines(uuid) to authenticated;

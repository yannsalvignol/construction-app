-- Three days a locked chef can take for himself.
--
-- A wall that goes up at midnight on the fifteenth day lands on whatever he
-- was in the middle of: a devis half checked, a crew expecting their tasks
-- tomorrow morning. The lock is a billing conversation, not a punishment, and
-- a conversation can wait a day — three times, one day each, and then it
-- cannot wait any longer.
--
-- Counted on the company, not the chef: two chefs in one company get three
-- days between them, because it is the company's invoice.
alter table public.companies
  -- How many of the three have been taken.
  add column if not exists grace_days_used integer not null default 0,
  -- When the current one runs out; null before the first is taken.
  add column if not exists grace_until timestamptz;

/** How many single days a locked company may take before the wall is final. */
create or replace function public.grace_days() returns integer
language sql immutable set search_path = '' as $$ select 3 $$;

/**
 * Whether this company's access is shut.
 *
 * One definition, used by the screen and by every write that must refuse:
 * two copies of this expression would eventually disagree, and the one that
 * disagreed would be the one holding the money.
 */
create or replace function public.company_is_locked(c public.companies)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not c.subscription_active
     and now() >= c.trial_started_at + make_interval(days => public.trial_days())
     and (c.grace_until is null or now() >= c.grace_until)
$$;

create or replace function public.company_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when c.id is null then null else jsonb_build_object(
    'company_id', c.id,
    'active', c.subscription_active,
    'trial_ends_at', c.trial_started_at + make_interval(days => public.trial_days()),
    'days_left', greatest(0, ceil(
      extract(epoch from (c.trial_started_at + make_interval(days => public.trial_days()) - now())) / 86400
    )::integer),
    'locked', public.company_is_locked(c),
    -- How many single days are still there to take. Zero hides the button.
    'grace_left', greatest(0, public.grace_days() - c.grace_days_used),
    'grace_until', c.grace_until,
    -- Shown once, the first time a chef opens the app.
    'notice_seen', (select p.trial_notice_seen_at is not null
                    from public.profiles p where p.id = auth.uid())
  ) end
  from public.profiles me
  left join public.companies c on c.id = me.company_id
  where me.id = auth.uid();
$$;
revoke all on function public.company_access() from public, anon;
grant execute on function public.company_access() to authenticated;

/**
 * Takes one of the three days.
 *
 * Refuses when the company is not actually locked, so a chef cannot spend his
 * three days during the trial and have nothing left when he needs them. The
 * row is locked for the update: two phones pressing the button together must
 * spend one day between them, not two.
 */
create or replace function public.take_grace_day()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public.profiles; c public.companies;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role <> 'chef' then
    raise exception 'Only a chef can postpone this';
  end if;
  select * into c from public.companies where id = me.company_id for update;
  if not public.company_is_locked(c) then
    raise exception 'This account is not locked';
  end if;
  if c.grace_days_used >= public.grace_days() then
    raise exception 'No more days left to take';
  end if;
  update public.companies
     set grace_days_used = c.grace_days_used + 1,
         grace_until = now() + interval '1 day'
   where id = c.id;
  return public.company_access();
end $$;
revoke all on function public.take_grace_day() from public, anon;
grant execute on function public.take_grace_day() to authenticated;

-- Reads the same definition as the screen, so a day taken opens the writes too:
-- a reprieve that left the app read-only would be no reprieve at all.
create or replace function public.require_company_access()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare locked boolean;
begin
  select public.company_is_locked(c) into locked
  from public.profiles me join public.companies c on c.id = me.company_id
  where me.id = auth.uid();
  if coalesce(locked, false) then
    raise exception 'This account needs to be unlocked before it can be used';
  end if;
end $$;
revoke all on function public.require_company_access() from public, anon;
grant execute on function public.require_company_access() to authenticated, service_role;

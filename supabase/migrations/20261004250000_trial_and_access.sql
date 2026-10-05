-- Fifteen days, then a conversation.
--
-- A company may use everything for fifteen days from the day it is created.
-- After that its chef cannot get in until somebody here says the account is
-- paid for. That flag is set by hand, which is the right amount of machinery
-- for a business that signs its customers one phone call at a time: a billing
-- integration here would be more code than customers.
--
-- Dated from the company rather than from the chef's profile, because the
-- company is what is sold and what is paid for. A chef who deletes and
-- recreates his account does not get another fifteen days.
alter table public.companies
  add column if not exists trial_started_at timestamptz not null default now(),
  -- Set by hand while the company pays; cleared when it stops.
  add column if not exists subscription_active boolean not null default false;

-- Whether this chef has already been shown the fifteen-day notice.
alter table public.profiles
  add column if not exists trial_notice_seen_at timestamptz;

/** How long a new company may use everything before paying. */
create or replace function public.trial_days() returns integer
language sql immutable set search_path = '' as $$ select 15 $$;

-- Every company that exists today predates this and has been using the app
-- already; starting their clock now would lock them out within a fortnight
-- without warning. They are marked paid, and the trial applies to whoever
-- signs up next.
update public.companies set subscription_active = true;

/**
 * Where the caller's company stands: on trial, locked, or paid up.
 *
 * Returned as one object rather than a boolean so the screen can say how many
 * days are left without a second round trip, and so "locked" and "trial
 * ending tomorrow" are the same question asked once.
 */
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
    'locked', not c.subscription_active
      and now() >= c.trial_started_at + make_interval(days => public.trial_days()),
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

/** The chef has read the fifteen-day notice; it does not come back. */
create or replace function public.mark_trial_notice_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set trial_notice_seen_at = now()
  where id = auth.uid() and trial_notice_seen_at is null;
$$;
revoke all on function public.mark_trial_notice_seen() from public, anon;
grant execute on function public.mark_trial_notice_seen() to authenticated;

/**
 * Raised by anything a locked company must not be able to do.
 *
 * Enforced in the database rather than only on the screen: a lock that lives
 * in the app is a suggestion, and the whole point of this one is that it holds
 * when somebody would rather it did not.
 */
create or replace function public.require_company_access()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare locked boolean;
begin
  select not c.subscription_active
     and now() >= c.trial_started_at + make_interval(days => public.trial_days())
    into locked
  from public.profiles me join public.companies c on c.id = me.company_id
  where me.id = auth.uid();
  if coalesce(locked, false) then
    raise exception 'This account needs to be unlocked before it can be used';
  end if;
end $$;
revoke all on function public.require_company_access() from public, anon;
grant execute on function public.require_company_access() to authenticated, service_role;

-- The chef-side writes that a locked company must not be able to make. The
-- list is deliberately short: what a locked account must not do is add work
-- and spend our money. Reading what it already has, and an employee finishing
-- the day he started, are left alone — locking a man out of a shift he is
-- halfway through would punish the wrong person for his employer's invoice.
create or replace function public.claim_quote_parse(quote uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  target public.site_quotes;
  tz text;
  used integer;
  allowed integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role <> 'chef' then
    raise exception 'Only a chef can import a devis';
  end if;
  perform public.require_company_access();

  select * into target from public.site_quotes where id = quote for update;
  if not found or target.company_id <> me.company_id then
    raise exception 'Quote not found';
  end if;

  select c.time_zone, c.daily_parse_limit into tz, allowed
  from public.companies c where c.id = me.company_id;

  perform 1 from public.companies where id = me.company_id for update;

  select count(*) into used
  from public.site_quotes q
  where q.company_id = me.company_id
    and q.parsing_started_at is not null
    and (q.parsing_started_at at time zone coalesce(tz, 'UTC'))::date
        = (now() at time zone coalesce(tz, 'UTC'))::date
    and q.id <> quote;

  if allowed > 0 and used >= allowed then
    raise exception 'Daily devis reading limit reached';
  end if;

  update public.site_quotes
     set status = 'parsing',
         parse_error = null,
         parse_warning = null,
         parse_stage = null,
         parsing_started_at = now()
   where id = quote;
end $$;
revoke all on function public.claim_quote_parse(uuid) from public, anon;
grant execute on function public.claim_quote_parse(uuid) to authenticated;

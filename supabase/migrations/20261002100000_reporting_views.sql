-- Aggregate reporting, for a dashboard tool to point at.
--
-- A BI tool connecting straight to the application tables would be a standing
-- privacy problem: Grafana or Metabase holds a connection string, the person
-- reading the dashboard is not the person who consented, and a panel is one
-- typo away from showing a named worker's movements. So nothing here exposes a
-- person. Every view returns counts and medians over the whole platform, with
-- no names, no ids and no coordinates.
--
-- The views deliberately run with their owner's rights rather than the caller's
-- (no security_invoker), which is what lets a role with no table privileges
-- read the aggregates without RLS standing in the way. That is the whole point
-- of the schema, and the reason each view is written to be safe to read.
--
-- Deliberately platform-wide rather than per-company: with a handful of
-- customers, a per-company breakdown re-identifies the company, and a
-- per-company row with one employee re-identifies the employee.

create schema if not exists reporting;

/** How many companies exist, and how many are actually being used. */
create or replace view reporting.companies as
select
  count(*) as companies_total,
  count(*) filter (
    where exists (
      select 1 from public.work_days d
      where d.company_id = c.id and d.work_date > current_date - 30
    )
  ) as companies_active_30d
from public.companies c;

/** Headcount, and how much of it is real rather than abandoned. */
create or replace view reporting.accounts as
select
  count(*) filter (where role = 'chef' and deleted_at is null) as chefs,
  count(*) filter (where role = 'employee' and deleted_at is null and is_active) as employees_active,
  count(*) filter (where role = 'employee' and deleted_at is null and not is_active) as employees_inactive,
  count(*) filter (where deleted_at is not null) as accounts_deleted,
  count(*) filter (where role = 'employee' and location_mode = 'live') as employees_live_mode
from public.profiles;

/** The core usage signal: declared work days, by week. */
create or replace view reporting.activity_weekly as
select
  date_trunc('week', work_date)::date as week,
  count(*) as work_days,
  count(distinct employee_id) as employees,
  count(distinct site_id) as sites,
  count(distinct company_id) as companies,
  round(avg(extract(epoch from (coalesce(ended_at, planned_end_at) - started_at)) / 3600)::numeric, 1) as avg_hours
from public.work_days
where work_date > current_date - 365
group by 1
order by 1 desc;

/** Whether presence checks are being answered, which is the product working. */
create or replace view reporting.presence_weekly as
select
  date_trunc('week', r.due_at)::date as week,
  count(*) as requests,
  count(*) filter (where exists (select 1 from public.presence_check_ins c where c.request_id = r.id)) as answered,
  count(*) filter (
    where r.cancelled_at is null
      and r.expires_at <= now()
      and not exists (select 1 from public.presence_check_ins c where c.request_id = r.id)
  ) as missed
from public.presence_requests r
where r.due_at > now() - interval '365 days'
group by 1
order by 1 desc;

/** Lone-worker protection: how often it fires, and how fast anyone responds. */
create or replace view reporting.safety_weekly as
select
  date_trunc('week', raised_at)::date as week,
  kind,
  count(*) as raised,
  count(*) filter (where resolved_at is not null) as resolved,
  count(*) filter (where resolution = 'cancelled') as cancelled_by_worker,
  count(*) filter (where resolution = 'acknowledged') as taken_by_chef,
  -- A median rather than a mean: one alert left open overnight would otherwise
  -- make the whole week look negligent.
  round((percentile_cont(0.5) within group (
    order by extract(epoch from (resolved_at - raised_at))
  ) / 60)::numeric, 1) as median_minutes_to_resolve
from public.safety_alerts
where raised_at > now() - interval '365 days'
group by 1, 2
order by 1 desc, 2;

/** Consent: taken up, and withdrawn. Withdrawal rate is the number to watch. */
create or replace view reporting.consent as
select
  (select count(*) from public.presence_consents where revoked_at is null) as presence_given,
  (select count(*) from public.presence_consents where revoked_at is not null) as presence_withdrawn,
  (select count(*) from public.live_location_consents where revoked_at is null) as live_given,
  (select count(*) from public.live_location_consents where revoked_at is not null) as live_withdrawn,
  (select count(*) from public.profiles where role = 'employee' and lone_worker_watch) as lone_worker_watch_on,
  (select count(*) from public.profiles where role = 'employee' and not lone_worker_watch) as lone_worker_watch_off;

-- The role a dashboard tool connects as. Created without a login on purpose:
-- a password belongs in the tool's own configuration, never in a migration that
-- goes to a public repository. Grant it a password out of band with
--   alter role reporting_ro with login password '<generated>';
-- and give that password to the dashboard tool and nowhere else.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'reporting_ro') then
    create role reporting_ro nologin;
  end if;
end $$;

-- Nothing but the aggregates. No table privileges, so there is nothing for a
-- mistyped panel to reach.
grant usage on schema reporting to reporting_ro;
grant select on all tables in schema reporting to reporting_ro;
alter default privileges in schema reporting grant select on tables to reporting_ro;
revoke all on schema public from reporting_ro;

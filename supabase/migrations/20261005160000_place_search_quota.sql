-- A weekly ceiling on address lookups, because Google bills for them.
--
-- The Places key is held server-side so nobody can spend it from outside, and
-- the function is chef-only so nobody inside spends it who has no reason to.
-- Neither of those stops the bill: a chef with a sticky keyboard, a script
-- somebody wrote against their own account, or simply an unlucky loop costs
-- real money with nothing in the way.
--
-- Counted in sessions rather than requests, because that is what Google
-- counts. The app sends a session token with the keystrokes of one address
-- and the resolve that follows, so a whole lookup — type, hesitate, retype,
-- tap — bills once and counts once here. Fifty of those a week is a company
-- registering a new chantier most working days, which is far more than any
-- of them does.
alter table public.companies
  -- Per company, so a large customer can be given more without a deploy.
  -- Zero means no ceiling.
  add column if not exists weekly_place_search_limit integer not null default 50;

create table public.place_search_sessions (
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Google's session token, or a stand-in when an old client sends none.
  session text not null,
  created_at timestamptz not null default now(),
  primary key (company_id, session)
);
create index place_search_sessions_recent on public.place_search_sessions (company_id, created_at desc);

alter table public.place_search_sessions enable row level security;
-- No policies and no grants: only claim_place_search touches this, as the
-- definer. Stated rather than implied, because an empty policy list reads
-- like an oversight.
revoke all on public.place_search_sessions from public, anon, authenticated;

/**
 * Takes one of the week's lookups, or refuses.
 *
 * Returns how many are left after this one, so the app can warn before it
 * stops rather than only when it has. A session already counted this week is
 * free: the resolve that follows the keystrokes is part of the same lookup.
 *
 * The old rows are swept here rather than by the cron, because this is the
 * only thing that writes them and a week of one company's lookups is at most
 * a few dozen rows.
 */
create or replace function public.claim_place_search(session text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare me public.profiles; allowed integer; used integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role <> 'chef' then raise exception 'Only a chef can search addresses'; end if;
  perform public.require_company_access();

  select c.weekly_place_search_limit into allowed
    from public.companies c where c.id = me.company_id for update;

  delete from public.place_search_sessions
   where company_id = me.company_id and created_at < now() - interval '7 days';

  -- Already counted: the rest of this lookup costs nothing more.
  if exists (select 1 from public.place_search_sessions
              where company_id = me.company_id and place_search_sessions.session = claim_place_search.session) then
    select count(*) into used from public.place_search_sessions where company_id = me.company_id;
    return greatest(0, allowed - used);
  end if;

  select count(*) into used from public.place_search_sessions where company_id = me.company_id;
  if allowed > 0 and used >= allowed then
    raise exception 'Weekly address search limit reached';
  end if;

  insert into public.place_search_sessions(company_id, session)
  values (me.company_id, claim_place_search.session)
  on conflict do nothing;

  return case when allowed > 0 then greatest(0, allowed - used - 1) else -1 end;
end $$;
revoke all on function public.claim_place_search(text) from public, anon;
grant execute on function public.claim_place_search(text) to authenticated;

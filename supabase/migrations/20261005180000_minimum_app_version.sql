-- The oldest version of the app still allowed to run.
--
-- Two kinds of update, and only one of them can be forced quietly. A change
-- to the JavaScript travels over the air and the app can fetch and apply it
-- on its own; a change to the native code cannot, and the only way a phone
-- gets it is the person going to the store. Until now nothing told them to,
-- so a build from six months ago would keep calling functions that have moved
-- underneath it and failing in ways nobody could explain.
--
-- A floor rather than a target: the app compares its own version against this
-- and stops if it is below. Raised by hand, deliberately, and only when an
-- older build is genuinely broken — a wall in front of somebody on a chantier
-- is a serious thing to put there for a cosmetic release.
create table public.app_policy (
  -- One row, and the check says so: a second row with a different floor would
  -- be answered at random.
  id boolean primary key default true check (id),
  minimum_version text not null default '0.0.0',
  -- Said on the wall, under the heading. Null falls back to the app's own
  -- wording, which is all most releases need.
  note_fr text,
  note_en text,
  updated_at timestamptz not null default now()
);
insert into public.app_policy(id) values (true) on conflict do nothing;

alter table public.app_policy enable row level security;
-- Read by anyone the app can be opened by, signed in or not: a build too old
-- to use is too old to sign in with, and the wall has to come up before the
-- sign-in screen rather than after it.
grant select on public.app_policy to anon, authenticated;
create policy app_policy_read on public.app_policy for select to anon, authenticated using (true);
-- Written by nobody through the API. Raising the floor shuts people out of
-- their work, so it is a statement somebody types against the database on
-- purpose, not a row any key can update.

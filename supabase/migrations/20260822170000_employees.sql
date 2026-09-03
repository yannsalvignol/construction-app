-- ============================================================
-- Employee accounts
--
-- Employees sign in with a username + password rather than an
-- email (per product requirements: workers often don't have easy
-- email access). Supabase Auth only understands email/phone
-- identifiers, so each employee's auth.users row gets a
-- deterministic synthetic email of the form
-- "<username>@employee.local", built from their unique username.
-- The client translates a plain username into that address before
-- calling signInWithPassword; no lookup table is needed since the
-- mapping is a pure function of the username.
--
-- Employee accounts themselves are created by
-- supabase/functions/create-employee, a service-role Edge Function
-- (chefs cannot create other users' auth accounts from the client).
--
-- profiles_select_company_as_chef additionally lets a chef read
-- every profile in their own company (previously everyone could
-- only read their own row), which the Employees tab needs to list
-- the team. The helper functions run SECURITY DEFINER so the
-- policy doesn't recursively re-check itself against profiles.
-- ============================================================

alter table public.profiles
    add column username text;

create unique index profiles_username_unique_idx
    on public.profiles (lower(username))
    where username is not null;

create or replace function public.current_profile_company_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
    select company_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_profile_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
    select role from public.profiles where id = auth.uid()
$$;

grant execute on function public.current_profile_company_id() to authenticated;
grant execute on function public.current_profile_role() to authenticated;

create policy "profiles_select_company_as_chef"
on public.profiles
for select
to authenticated
using (
    public.current_profile_role() = 'chef'
    and company_id = public.current_profile_company_id()
);

-- ============================================================
-- Row Level Security: profiles & companies (minimal, read-only)
--
-- Scope: a user can read their own profile and their own company.
-- Writes (chef creating employees, onboarding, etc.) are handled
-- by later migrations once those flows are designed.
-- ============================================================

alter table public.profiles enable row level security;
alter table public.companies enable row level security;

grant select on public.profiles to authenticated;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

grant select on public.companies to authenticated;

create policy "companies_select_own"
on public.companies
for select
to authenticated
using (
    id in (
        select company_id
        from public.profiles
        where id = auth.uid()
    )
);

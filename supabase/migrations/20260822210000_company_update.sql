-- ============================================================
-- Let a chef edit their own company's info (currently just the
-- name) from the Account tab. Reuses the existing
-- current_profile_role()/current_profile_company_id() helpers so
-- the policy doesn't recursively re-check itself against profiles.
-- ============================================================

create policy "companies_update_own_as_chef"
on public.companies
for update
to authenticated
using (
    public.current_profile_role() = 'chef'
    and id = public.current_profile_company_id()
)
with check (
    public.current_profile_role() = 'chef'
    and id = public.current_profile_company_id()
);

grant update (name) on public.companies to authenticated;

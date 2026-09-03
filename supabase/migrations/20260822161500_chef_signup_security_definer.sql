-- ============================================================
-- Fix chef self-serve signup RLS violation
--
-- create_company_and_chef_profile() ran as SECURITY INVOKER, so its
-- `insert into companies ... returning id into new_company_id` was
-- checked not only against the INSERT policy but also against the
-- companies SELECT policy (Postgres re-checks RETURNING rows against
-- SELECT policies). companies_select_own requires a profiles row
-- that already points at the company, which doesn't exist yet at
-- that point in the signup, so the RETURNING always failed with
-- "new row violates row-level security policy for table companies".
--
-- The function already only trusts auth.uid() for identity and
-- hardcodes role = 'chef', so it's safe to run as SECURITY DEFINER,
-- bypassing RLS for its own inserts. search_path is pinned per
-- Supabase/Postgres guidance for SECURITY DEFINER functions.
-- ============================================================

create or replace function public.create_company_and_chef_profile(
    company_name text,
    chef_first_name text,
    chef_last_name text,
    chef_phone text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
    new_company_id uuid;
    new_profile public.profiles;
begin
    if exists (select 1 from public.profiles where id = auth.uid()) then
        raise exception 'A profile already exists for this user';
    end if;

    insert into public.companies (name)
    values (company_name)
    returning id into new_company_id;

    insert into public.profiles (id, company_id, first_name, last_name, role, phone)
    values (auth.uid(), new_company_id, chef_first_name, chef_last_name, 'chef', chef_phone)
    returning * into new_profile;

    return new_profile;
end;
$$;

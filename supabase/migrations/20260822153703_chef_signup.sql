-- ============================================================
-- Chef self-serve signup
--
-- The only self-registration path in the product: a brand new
-- Supabase Auth user creates their company and becomes its chef.
-- Employees are never created this way (see README, section 3).
--
-- create_company_and_chef_profile() bundles the company + profile
-- insert into a single atomic call so a signup can't leave behind
-- an auth user with no profile.
-- ============================================================

create policy "companies_insert_self_serve"
on public.companies
for insert
to authenticated
with check (true);

grant insert on public.companies to authenticated;

create policy "profiles_insert_own_as_chef"
on public.profiles
for insert
to authenticated
with check (id = auth.uid() and role = 'chef');

grant insert on public.profiles to authenticated;


create or replace function public.create_company_and_chef_profile(
    company_name text,
    chef_first_name text,
    chef_last_name text,
    chef_phone text default null
)
returns public.profiles
language plpgsql
security invoker
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

grant execute on function public.create_company_and_chef_profile(text, text, text, text) to authenticated;

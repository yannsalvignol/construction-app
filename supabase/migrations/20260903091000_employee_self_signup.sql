-- ============================================================
-- Employee self-serve signup via join code
--
-- Mirrors create_company_and_chef_profile's shape: the client
-- first creates a bare Supabase Auth account (username -> synthetic
-- email, same as every employee account), then calls this
-- SECURITY DEFINER function to attach that account to a company and
-- create its profile row. Split into two steps for the same reason
-- as chef signup -- see onboarding.tsx -- the auth account must
-- exist (auth.uid() populated) before a profile referencing it can
-- be inserted.
--
-- No INSERT policy is added for profiles as a result: this function
-- runs as its owner (postgres, which has BYPASSRLS) so it does not
-- need one, and deliberately staying that way means a client can
-- only ever create an employee row through this validated path --
-- never with an arbitrary company_id via a direct table insert.
--
-- The username isn't taken as a parameter: it's read back from this user's
-- own auth.users.email (every employee account's email is already
-- "<username>@employee.local", set at signUp() time -- see toAuthEmail() in
-- use-auth.tsx). Deriving it server-side, from the row auth.uid() actually
-- points at, means profiles.username can never drift from the email an
-- employee actually signs in with, and a client can't claim a display
-- username that doesn't match its own account.
-- ============================================================

create or replace function public.redeem_employee_join_code(
    input_join_code text,
    employee_first_name text,
    employee_last_name text,
    employee_phone text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
    target_company_id uuid;
    caller_email text;
    derived_username text;
    new_profile public.profiles;
begin
    if exists (select 1 from public.profiles where id = auth.uid()) then
        raise exception 'A profile already exists for this user';
    end if;

    select email into caller_email from auth.users where id = auth.uid();

    if caller_email is null or caller_email !~ '@employee\.local$' then
        raise exception 'This account is not set up for employee sign-in';
    end if;

    derived_username := lower(split_part(caller_email, '@', 1));

    if derived_username !~ '^[a-z0-9_.]{3,20}$' then
        raise exception 'Username must be 3-20 characters: lowercase letters, numbers, "_" or "."';
    end if;

    -- Parameter is deliberately not named `join_code`: inside this function's
    -- scope that would shadow (and in an unqualified WHERE clause, collide
    -- with) companies.join_code and fail with "ambiguous column reference".
    select companies.id into target_company_id
    from public.companies
    where companies.join_code = upper(trim(input_join_code));

    if target_company_id is null then
        raise exception 'That code doesn''t match any company. Double-check it with your chef.';
    end if;

    if exists (select 1 from public.profiles where lower(username) = derived_username) then
        raise exception 'That username is already taken';
    end if;

    insert into public.profiles (id, company_id, first_name, last_name, role, phone, username)
    values (
        auth.uid(),
        target_company_id,
        employee_first_name,
        employee_last_name,
        'employee',
        employee_phone,
        derived_username
    )
    returning * into new_profile;

    return new_profile;
exception
    when unique_violation then
        raise exception 'That username is already taken';
end;
$$;

grant execute on function public.redeem_employee_join_code(text, text, text, text) to authenticated;

-- ============================================================
-- Letting a chef rotate their company's join code (e.g. it leaked,
-- or they want to stop new signups temporarily) needs to guarantee
-- the replacement is unique, which a plain client-side column
-- UPDATE can't do -- hence a function rather than a column grant.
-- ============================================================

create or replace function public.regenerate_company_join_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    new_code text;
begin
    if public.current_profile_role() <> 'chef' then
        raise exception 'Only a chef can regenerate the join code';
    end if;

    new_code := public.generate_join_code();

    update public.companies
    set join_code = new_code
    where id = public.current_profile_company_id();

    return new_code;
end;
$$;

grant execute on function public.regenerate_company_join_code() to authenticated;

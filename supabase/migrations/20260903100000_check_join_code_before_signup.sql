-- ============================================================
-- Let the join screen validate a code before any account exists
--
-- redeem_employee_join_code() only runs after a Supabase Auth
-- account exists (it needs auth.uid()), so it can't be used to
-- check a code up front -- the product now wants the code checked
-- *before* showing the username/password fields, catching typos
-- before an account is ever created.
--
-- This has to be callable by a signed-out client (anon), since
-- that's exactly who is filling out this screen. It intentionally
-- returns nothing but the company name -- enough to show "You're
-- joining Acme Construction" -- not anything from profiles or a
-- way to enumerate companies (a miss returns zero rows, not a
-- distinguishable error).
-- ============================================================

create or replace function public.find_company_by_join_code(input_join_code text)
returns table (company_name text)
language sql
security definer
set search_path = public
stable
as $$
    select name
    from public.companies
    where join_code = upper(trim(input_join_code))
$$;

grant execute on function public.find_company_by_join_code(text) to anon, authenticated;

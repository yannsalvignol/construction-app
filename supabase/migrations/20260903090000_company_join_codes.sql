-- ============================================================
-- Company join codes
--
-- Alternative to a chef manually creating every employee account
-- (create-employee Edge Function): each company gets a short,
-- typeable code that a chef can hand out, and a prospective
-- employee redeems it during self-serve signup to be attached to
-- that company automatically. See employee_self_signup for the
-- redemption RPC.
--
-- The alphabet excludes visually ambiguous characters (0/O, 1/I/L)
-- since these codes are meant to be read off a phone screen or
-- shouted across a job site.
-- ============================================================

alter table public.companies
    add column join_code text;

create or replace function public.generate_join_code()
returns text
language plpgsql
as $$
declare
    alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    code text;
    attempt int := 0;
begin
    loop
        code := '';
        for i in 1..6 loop
            code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
        end loop;

        exit when not exists (select 1 from public.companies where join_code = code);

        attempt := attempt + 1;
        if attempt > 20 then
            raise exception 'Could not generate a unique join code';
        end if;
    end loop;

    return code;
end;
$$;

-- Backfill every existing company before the column is made required.
update public.companies
set join_code = public.generate_join_code()
where join_code is null;

alter table public.companies
    alter column join_code set not null;

create unique index companies_join_code_unique_idx
    on public.companies (join_code);

create or replace function public.set_company_join_code()
returns trigger
language plpgsql
as $$
begin
    if new.join_code is null then
        new.join_code := public.generate_join_code();
    end if;
    return new;
end;
$$;

create trigger companies_set_join_code
before insert on public.companies
for each row
execute function public.set_company_join_code();

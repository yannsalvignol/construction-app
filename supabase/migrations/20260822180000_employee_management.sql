-- ============================================================
-- Employee management: profile edits + per-employee toggles
--
-- Chefs need to edit an employee's contact info and flip simple
-- per-employee behaviors on/off (location tracking, photo proof
-- requirements, notifications, active/suspended). These are plain
-- columns on profiles rather than a new role -- per the "do not
-- create a third permanent role without discussion" rule, these
-- are just flags on an employee row, not a new kind of user.
--
-- Column-level UPDATE grants intentionally exclude username, role,
-- company_id and id: the edit UI only exposes contact info + the
-- toggles below. Letting this policy touch username would desync
-- it from the employee's actual auth.users.email set at creation
-- time (see create-employee Edge Function).
-- ============================================================

alter table public.profiles
    add column location_tracking_enabled boolean not null default false,
    add column equipment_photo_required boolean not null default false,
    add column clock_in_photo_required boolean not null default false,
    add column notifications_enabled boolean not null default true,
    add column is_active boolean not null default true;

create policy "profiles_update_employees_as_chef"
on public.profiles
for update
to authenticated
using (
    public.current_profile_role() = 'chef'
    and company_id = public.current_profile_company_id()
    and role = 'employee'
)
with check (
    public.current_profile_role() = 'chef'
    and company_id = public.current_profile_company_id()
    and role = 'employee'
);

grant update (
    first_name,
    last_name,
    phone,
    location_tracking_enabled,
    equipment_photo_required,
    clock_in_photo_required,
    notifications_enabled,
    is_active
) on public.profiles to authenticated;

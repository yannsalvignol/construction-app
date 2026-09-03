-- ============================================================
-- Prevent employees from self-editing chef-only toggle columns
--
-- Postgres column-level GRANTs are additive per role, not scoped to
-- a specific RLS policy: employee_management's
-- `grant update (location_tracking_enabled, equipment_photo_required,
-- clock_in_photo_required, notifications_enabled, is_active) ...
-- to authenticated` was meant to only take effect through
-- profiles_update_employees_as_chef, but profile_self_edit_avatar's
-- separate `profiles_update_own` policy (using id = auth.uid()) has
-- no column restriction of its own -- RLS filters rows, not columns
-- -- so once those columns were granted to `authenticated` at all,
-- any employee could flip them on their own row via a direct PATCH,
-- bypassing the chef-only UI entirely. Found via manual RLS testing.
--
-- Postgres has no per-policy column grant, so the fix has to be a
-- trigger: whenever the row being updated is the caller's own row
-- (auth.uid() = id, i.e. NOT a chef editing someone else's row,
-- since a chef's uid never equals the employee row's id), force
-- these five columns back to their previous value regardless of
-- what the request tried to set them to.
--
-- This supersedes employee_location_sharing's standalone
-- clear_location_on_tracking_disabled trigger rather than adding a
-- second BEFORE UPDATE trigger next to it: Postgres runs same-event
-- triggers in alphabetical order by name, and running the clear
-- first would read the self-edit's (about to be reverted)
-- location_tracking_enabled value, wiping a real last-known
-- position just because an employee *attempted* a change that gets
-- rejected. Folding both rules into one function makes the order
-- explicit and correct: revert the self-edit first, then decide
-- whether to clear location from the (possibly just-reverted) value.
-- ============================================================

drop trigger if exists profiles_clear_location_on_tracking_disabled on public.profiles;
drop function if exists public.clear_location_on_tracking_disabled();

create or replace function public.enforce_employee_profile_update_rules()
returns trigger
language plpgsql
as $$
begin
    if auth.uid() = new.id then
        new.location_tracking_enabled := old.location_tracking_enabled;
        new.equipment_photo_required := old.equipment_photo_required;
        new.clock_in_photo_required := old.clock_in_photo_required;
        new.notifications_enabled := old.notifications_enabled;
        new.is_active := old.is_active;
    end if;

    if new.location_tracking_enabled = false and old.location_tracking_enabled = true then
        new.last_latitude := null;
        new.last_longitude := null;
        new.location_updated_at := null;
    end if;

    return new;
end;
$$;

create trigger profiles_enforce_employee_profile_update_rules
    before update on public.profiles
    for each row
    execute function public.enforce_employee_profile_update_rules();

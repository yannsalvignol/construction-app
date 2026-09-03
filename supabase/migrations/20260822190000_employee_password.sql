-- ============================================================
-- Store employee login credentials for chef recall
--
-- The real password used to sign in is bcrypt-hashed in
-- auth.users and is genuinely irrecoverable, by design. Since
-- these employees often have no email recovery path, the product
-- also keeps a plain copy of their current password on their
-- profile so the chef who set it can look it up again later. This
-- is a deliberate trade-off (explicitly requested), not a general
-- security recommendation -- it's protected by the same chef-only
-- row access as the rest of an employee's contact info, nothing
-- more.
--
-- This column is intentionally left out of the authenticated
-- column-level UPDATE grant from the employee_management
-- migration: changing a password must go through the
-- reset-employee-password Edge Function so the real auth.users
-- hash and this display copy never desync. Direct client updates
-- would silently break login while showing a "correct" password.
-- ============================================================

alter table public.profiles
    add column employee_password text;

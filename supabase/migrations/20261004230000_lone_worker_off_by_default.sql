-- Off unless a company asks for it.
--
-- It was on by default, on the reasoning that a safety feature you have to
-- find and switch on protects only the workers who were never in danger. The
-- decision is the other way: a company gets it when it asks for it.
--
-- Existing companies are switched off with the default, rather than left on
-- under a rule that no longer describes them — a feature that is off for every
-- new customer and on for the four who happen to predate the change is not a
-- default, it is an accident waiting to be explained.
alter table public.companies
  alter column lone_worker_enabled set default false;

update public.companies set lone_worker_enabled = false where lone_worker_enabled;

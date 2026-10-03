-- Live location becomes the setup a new employee starts in.
--
-- The chef enabled it one employee at a time, which meant the map was empty on
-- the day a company started using the app and stayed empty until somebody found
-- the switch. The chantier map is the feature; having to turn it on per person
-- made it look like an option nobody had asked for.
--
-- What does NOT change, and must not: the employee's own agreement. Nothing is
-- transmitted until he has read the live-location notice and accepted it, and
-- withdrawing stops it. This moves which setup a company starts in, not whether
-- a worker is asked.
alter table public.profiles alter column location_mode set default 'live';

-- Existing employees keep what their chef chose. A chef who deliberately left
-- somebody on checkpoint did not ask for that to be undone by a deploy, and a
-- worker who was told he is not followed should not find out otherwise from a
-- release note he will never read.

# Every command, in one place

What to type to ship the app, to change what a company can do, and to look at
what is going on. The reasoning behind each lever lives in
`docs/OPERATIONS.md`; this file is the short form you reach for when something
needs doing.

SQL goes into the Supabase SQL editor
(**Dashboard → SQL Editor → New query**), or `psql` if you prefer. Shell
commands run from the repository root.

---

## 1. Before anything you ship

```bash
npm run preflight     # lockfile, EAS env vars, native sync, version rule
npm test              # the database contracts, against real Postgres
npm run typecheck     # tsc --noEmit
npm run lint
```

`preflight` is the one that stops a broken release. It refuses the build if a
native dependency changed without a version bump, which is the mistake that
would otherwise ship an update to binaries that cannot run it.

---

## 2. Shipping

### Over the air — minutes, no review

For anything that is not native code: screens, copy, logic, styles, fixes.

```bash
npx eas update --channel preview    --message "essai"        # internal builds only
npx eas update --channel production --message "ce que ça corrige"
```

Phones take it on the next launch or the next return to the foreground, and
reload themselves straight away.

```bash
npx eas update:list --branch production          # what has been published
npx eas update:republish --group <id>            # put a known-good one back
```

### A new binary — days, reviewed

Needed when native code changed: a new `expo-*` or `react-native-*` package, a
permission, the icon, an SDK upgrade.

```bash
# 1. bump "version" in app.json   (1.1.0 -> 1.2.0)
npm run preflight

# iOS
npx eas-cli build --platform ios --profile production --auto-submit

# Android
npx eas-cli build --platform android --profile production --auto-submit

# both at once
npx eas-cli build --platform all --profile production --auto-submit
```

Without `--auto-submit`, send a finished build later:

```bash
npx eas-cli submit --platform ios --latest
npx eas-cli submit --platform android --latest
```

Android goes to the **internal** track as a **draft** — promote it in the Play
Console when you have looked at it. The first Android upload of all must be
done by hand in the console; see `docs/PLAY_STORE_SUBMISSION.md` §7.

### Useful around a build

```bash
npx eas-cli build:list --limit 5
npx eas-cli credentials --platform android       # keystore, Play service account
npx eas-cli credentials --platform ios
npx eas-cli env:list --environment production    # EXPO_PUBLIC_*, maps keys
```

### Running it locally

```bash
npm start                      # Metro, for a development build
npx expo run:ios --device      # onto a plugged-in iPhone
npm run android
```

---

## 3. The backend

No review, no version, live the moment it lands.

```bash
npx supabase db push                                   # apply new migrations
npx supabase functions deploy post-site-note           # one function
npx supabase functions deploy parse-quote presence-dispatch   # several
npx supabase secrets list
npx supabase secrets set OPENAI_API_KEY=...            # never commit these
```

The functions: `complete-password-change` `complete-password-reset`
`complete-signup` `create-employee` `delete-account` `parse-quote`
`place-search` `post-site-note` `presence-dispatch` `reset-employee-password`
`send-planning` `start-password-change` `start-password-reset` `start-signup`.

### The website

```bash
npm run web:deploy
```

---

## 4. Accounts and access

### A company has paid, or has stopped

```bash
node scripts/trial-access.mjs list              # who has access, and who does not
node scripts/trial-access.mjs on  <company-id>  # paid: chef and crew, at once
node scripts/trial-access.mjs off <company-id>  # stopped paying
```

`on` also hands back the three postponements. The chef's screen clears when he
next opens the app; his employees sign in again with the credentials they
always had.

By hand:

```sql
update public.companies
   set subscription_active = true, grace_days_used = 0, grace_until = null
 where name = '...';
```

### Who is stopped, and when

| | when | what happens |
|---|---|---|
| Chef | 15 days after the company was created, plus his three postponements | a wall with the number to call |
| Employees | 7 days after that | signed out, told to ask their chef |

```sql
-- give one company a longer trial
update public.companies set trial_started_at = now() where name = '...';
```

### Suspending one person, or one chantier

```sql
update public.profiles set is_active = false where username = '...';
update public.sites    set is_active = false where name = '...';
```

Nothing is deleted: what was declared stays declared. An inactive account
cannot start a day or be given work; an inactive chantier cannot be chosen.

---

## 5. Features, per company

```sql
-- Protection du travailleur isolé. Off everywhere by default.
update public.companies set lone_worker_enabled = true  where name = '...';
update public.companies set lone_worker_enabled = false where name = '...';

-- Devis read by the AI, per day. 0 = no ceiling.
update public.companies set daily_parse_limit = 20 where name = '...';

-- Address lookups, per week. 0 = no ceiling.
update public.companies set weekly_place_search_limit = 200 where name = '...';
```

### Per employee

```sql
-- Live position on the chef's map, or presence checks only.
update public.profiles set location_mode = 'live' where username = '...';
update public.profiles set location_mode = 'checkpoint' where username = '...';

-- Photographs asked for at the start of a day.
update public.profiles
   set equipment_photo_required = true, clock_in_photo_required = false
 where username = '...';

-- Take one man out of the lone-worker watch.
update public.profiles set lone_worker_watch = false where username = '...';
```

---

## 6. Forcing people onto a new version

JavaScript updates apply themselves; nobody has to be told. Only raise this
floor when an older binary is genuinely broken against the server — a wall in
front of somebody on a chantier is a serious thing to put there.

```sql
select minimum_version, updated_at from public.app_policy;

update public.app_policy set minimum_version = '1.2.0', updated_at = now();

-- optional wording for one release
update public.app_policy
   set note_fr = 'Les devis ont changé de format. Mettez à jour pour continuer.',
       note_en = 'Devis changed format. Update to keep reading them.'
 where id;
```

---

## 7. Looking at what is happening

```sql
-- companies, their access, their ceilings
select name, subscription_active, trial_started_at, grace_days_used,
       daily_parse_limit, weekly_place_search_limit, lone_worker_enabled
  from public.companies order by created_at desc;

-- who is working right now
select p.first_name, p.last_name, s.name as chantier, d.started_at, d.planned_end_at
  from public.work_days d
  join public.profiles p on p.id = d.employee_id
  join public.sites s on s.id = d.site_id
 where d.ended_at is null and d.planned_end_at > now();

-- devis read today, against the limit
select c.name, count(*) as lus, c.daily_parse_limit
  from public.site_quotes q join public.companies c on c.id = q.company_id
 where q.parsing_started_at::date = current_date
 group by c.name, c.daily_parse_limit;

-- address lookups this week
select c.name, count(*) as recherches, c.weekly_place_search_limit
  from public.place_search_sessions s join public.companies c on c.id = s.company_id
 where s.created_at > now() - interval '7 days'
 group by c.name, c.weekly_place_search_limit;

-- alerts nobody has closed
select * from public.safety_alerts where resolved_at is null;
```

Edge function logs: **Supabase Dashboard → Edge Functions → the function →
Logs**. That is the only place a server-side failure is visible today; there
is no error reporting in the app itself.

---

## 8. Development only

Never on a company that matters.

```bash
node scripts/trial-access.mjs expire <company-id> [minutes]  # see the locked screen
node scripts/trial-access.mjs unsee  <company-id>            # see the welcome again
node scripts/trial-access.mjs restore <company-id>           # undo both

node scripts/seed-castor-demo.mjs --dry-run
node scripts/demo.mjs
```

---

## What has no command

Deleting a company, or a person, from the outside. Account deletion is in the
app — *Compte → Supprimer mon compte* — because it has to remove Storage
objects as well as rows, and the function that does it is the only thing that
knows the whole list.

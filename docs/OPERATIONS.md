# Levers that work without a build

Everything here takes effect at once — no EAS build, no Apple review, no
`eas update`. One SQL statement or one secret.

That matters because the alternative is a week, and some of these are things
you need on a Tuesday afternoon when a customer phones.

> **The app is not asked to co-operate.** Each of these is enforced on the
> server, so a copy of the app installed months ago obeys it too. That is
> deliberate: a switch that only works for people who have updated is not a
> switch, it is a hope. The one exception is noted where it applies.

---

## Protection du travailleur isolé

The one feature that acts on its own: nobody presses anything, the server
notices a man has stopped moving, asks him, and tells his chef when he does not
answer. Which is why it needs an off switch that does not wait a week — a watch
that misfires on a crew in a basement wakes a chef at midnight for nothing,
twice, and then nobody believes the third one.

```sql
-- one company
update public.companies set lone_worker_enabled = false where name = '...';

-- everywhere
update public.companies set lone_worker_enabled = false;

-- back on
update public.companies set lone_worker_enabled = true;
```

**What it stops:** the stillness question, the alert that follows silence, and
the position the phone reports to feed them — which gives the battery back on a
chantier.

**What it does not stop: the SOS button.** That is a man deciding he needs
help. It cannot misfire, and taking it from him is not what anybody means by
"turn off the false alarms". His card says so rather than going quiet:

> « La surveillance automatique n'est pas activée dans votre entreprise. Le
> bouton d'alerte reste disponible. »

**Old apps:** one that predates the switch keeps reporting its position. That
costs battery and is never unsafe, because the sweeps that would act on those
reports are gated server-side.

### Its timings

Changing these changes the feature's character, so change them deliberately.

| | now | what it is |
|---|---|---|
| `lone_worker_still_for()` | 25 minutes | stillness before he is asked |
| `lone_worker_answer_window()` | 3 minutes | to answer before the chef is told |
| `lone_worker_moved_meters()` | 35 m | below this is a man shifting his weight |

```sql
create or replace function public.lone_worker_still_for() returns interval
language sql immutable set search_path = '' as $$ select interval '40 minutes' $$;
```

### One worker at a time

```sql
update public.profiles set lone_worker_watch = false where username = '...';
```

His own switch, which he controls from his own screen. The company switch sits
above it: when the company is off, his decides nothing.

---

## Reading devis

All three are Edge Function secrets — `npx supabase secrets set NAME=value`,
then redeploy is **not** needed; the function reads them per invocation.

| secret | default | what it does |
|---|---|---|
| `PARSE_QUOTE_MODEL` | `gpt-5.6-luna` | the model that reads the devis |
| `PARSE_STEPS_MODEL` | `gpt-5.6-luna` | the model that breaks lines into operations |
| `PARSE_TEXT_PROBE` | unset | `off` skips text extraction; every PDF is read as a picture |

`PARSE_QUOTE_MODEL` is currently **set** in production, so the default in the
source is not what decides. What actually ran is recorded per devis:

```sql
select file_name, parse_model, parse_source, input_tokens, output_tokens
from public.site_quotes order by parsed_at desc limit 10;
```

Before changing the reading model, run the bench — a devis read wrong is a
wrong price in a contract:

```bash
OPENAI_API_KEY=sk-... node scripts/compare-quote-models.mjs devis.pdf gpt-5.6-luna <other>
```

It scores against prices transcribed by hand from the paper: how many printed
prices came back, and how many came back that are printed nowhere. A model that
invents 58 885 fails, however fluent its labels.

`PARSE_TEXT_PROBE=off` exists for one case — if reading a devis ever goes wrong
in a way that looks like the text probe, take it out of the path in one command
and put it back the same way.

---

## Start-of-day photos

```sql
update public.profiles
   set equipment_photo_required = true, clock_in_photo_required = false
 where username = '...';
```

Also on the chef's employee card. The server refuses to start a day without the
photos that were asked for.

> **This one has the exception.** It is enforced only against an app that sends
> `can_photograph` — a build with the camera step. An older app is asked for
> nothing, because it has no way to comply, and locking a man out of his own
> work day over a setting his screen cannot satisfy is worse than the setting
> waiting for his next update.
>
> That was learned the hard way: five workers across four companies were locked
> out within an hour of this shipping, because the switch had been turned on
> back when it did nothing.

---

## Live location

```sql
update public.profiles set location_mode = 'checkpoint' where username = '...';
```

`live` shares position continuously while a day is open; `checkpoint` only
answers the presence requests. The worker's own agreement is separate and he
can withdraw it himself — this does not override that.

---

## Suspending people and chantiers

```sql
update public.profiles set is_active = false where username = '...';
update public.sites    set is_active = false where name = '...';
```

An inactive account cannot start a day, declare anything, or be given work. An
inactive chantier cannot be chosen. Neither deletes anything: what was declared
stays declared.

---

## What is *not* here

Anything that changes the shape of an answer the app reads — a renamed
function, a removed field, a changed return type. Those are live for everyone
the moment `supabase db push` finishes, including copies of the app installed
months ago.

**Add, never remove or rename.** Where a signature must change, replace it with
one whose new arguments have defaults, so a call that predates the change still
resolves — and then check the *behaviour* too, which is the half I got wrong
once already. See `docs/UPDATES.md`.

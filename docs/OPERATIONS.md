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

**Off by default.** A company gets the watch when it asks for it.

```sql
-- give it to one company
update public.companies set lone_worker_enabled = true where name = '...';

-- take it back
update public.companies set lone_worker_enabled = false where name = '...';

-- everywhere, either way
update public.companies set lone_worker_enabled = false;
```

**Off means gone.** The card, the switch and the alert button disappear from
the worker's screen, the stillness question and the alert that follows silence
stop, and the phone stops reporting its position to feed them — which gives the
battery back on a chantier.

Refused on the server too, not only hidden: a copy of the app installed before
this still has the button drawn, and a feature switched off that still works
for whoever has not updated is not switched off.

**Alerts already open are left alone.** They are a man who asked for help
before the switch was thrown; stranding them unresolvable would be the one
outcome worse than a false alarm. Resolving keeps working, no new ones can be
raised.

> ### This was the justification for background location
>
> Apple rejected the app under guideline 2.5.4 because background location
> served only employee tracking. Protection du travailleur isolé was built as
> the independent justification, and the review notes say so.
>
> With it off everywhere, the app still asks for background location — for live
> position sharing, which is the use Apple rejected. That is not a problem
> today, because the permission is only requested when a worker turns live
> sharing on. It becomes one at the next review if the submission still claims
> PTI as the reason.
>
> Before the next submission: either switch it on for the companies that use
> it and say so, or rewrite that part of the review notes to describe what the
> app actually does.

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

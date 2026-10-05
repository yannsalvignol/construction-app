# Shipping a change

Two routes out of this repository, and the difference between them is a week.

| | Reaches users in | Apple review | What it can change |
|---|---|---|---|
| `eas update` | minutes | no | JS/TS, styles, images, copy |
| `eas build` + submit | days | yes | anything, including native code |
| `supabase db push` | **seconds, no review at all** | no | the database every installed version talks to |

---

## The ordinary case: an OTA update

```bash
npx eas update --channel production --message "ce que ça corrige"
```

Users get it the next time they open the app: it downloads in the background
and applies on the following launch. No review, no build, no waiting.

Apple permits this explicitly — interpreted code that does not change the
app's purpose (App Store Review Guideline 3.3.2). Shipping a different app
this way is how the permission gets withdrawn, so it is for fixes and
improvements to the app that was approved, not for a new one.

**It only works from the next production build onward.** The build currently
on the App Store is 1.0.0, made before `expo-updates` existed, and has no
mechanism to fetch anything; it will live out its life as it is. Build and
submit 1.1.0 once, and every release after that can go over the air.

From 1.1.0 the app also stops waiting for the *following* launch: it checks on
startup and on every return to the foreground, and reloads itself as soon as
it has the new bundle. See **Forcing an update** below.

### What an update cannot carry

Anything the binary has to be rebuilt for:

- a new native dependency, or a version bump of one
- a change to permissions, `Info.plist`, or the Android manifest
- icons, splash screen, bundle identifier
- an Expo SDK upgrade

Publish one of those as an update and it reaches a binary that does not have
the native code behind it. That is a crash on launch, for every user who takes
the update, with no review process in the way to catch it.

---

## The rule this depends on

`app.json` sets `runtimeVersion: { policy: "appVersion" }`. Every build and
every update carrying the same `version` string are declared compatible. Today
that string is `1.1.0`.

So: **a native change must come with a new `version` in `app.json`.** Bump it,
build, submit. Updates then target the new version and never reach the old
binaries.

`npm run preflight` enforces this. It records the native dependency list beside
the version it shipped with, and fails the build if that list has changed while
`version` has not.

> ### Why not the `fingerprint` policy, which the Expo docs recommend
>
> Because of what it hashes here. `@expo/fingerprint` lists `ios` and `android`
> as `bareNativeDir` sources — this project has those directories, and they are
> **git-ignored**. EAS Build generates its own copies in the cloud; this machine
> generated different ones at some other time. A one-byte difference between
> them is a different runtime version, and an update that silently never
> arrives: no error, no warning, just users who never receive the fix.
>
> `appVersion` trades that for a rule a person has to follow. A literal string
> both sides read from the same file is worth a check in preflight.

---

## Channels

Set per build profile in `eas.json`, so an update reaches one kind of build and
not another:

| profile | channel |
|---|---|
| `development` | `development` |
| `preview` | `preview` |
| `production` | `production` |

Publishing to `preview` lets you try an update on an internal build without
touching anything a customer has.

---

## A full release, when native did change

```bash
# 1. bump "version" in app.json          (1.1.0 -> 1.2.0)
npm run preflight                         # lockfile, EAS env vars, native sync, version rule
npx eas build --platform ios --profile production --auto-submit
```

Then attach the build to a new version in App Store Connect and submit. Updates
to a release already in review go to the version being reviewed, so publish
them deliberately.

---

## The backend has no review and no version

```bash
npx supabase db push
npx supabase functions deploy parse-quote
```

Both are live for everyone the moment they finish — including copies of the app
that were installed months ago and will never be updated.

**Add, never remove or rename.** A new column, a new field in a JSON answer, a
new argument with a default: an older app ignores them. Removing a field,
changing a return type, renaming a function: an older app breaks, and you find
out from a user.

Where a function's signature must change, replace it with one whose new
arguments have defaults, so a call that predates the change still resolves.

**A compatible signature is not a compatible behaviour.** `start_work_day`
gained its photo arguments that way, with defaults, and the old app's two-
argument call kept resolving — and five workers across four companies were
locked out of their own work days within the hour, because the chef had
switched the requirement on back when it did nothing, and their build has no
camera step to satisfy it with. The signature was fine. The rule was not.

So a requirement that needs something of the app asks the app first:
`can_photograph` is sent only by a build that has the camera step, and the
requirement is enforced only when it arrives. An older app loses a feature it
never had; it does not lose the ability to work.

> An old client silently missing a feature is survivable. An old client locked
> out is not. When a change needs something new *from the app*, make the app
> say so, and treat its silence as the old behaviour.

> This is the reason to keep OTA working. With it, the window during which an
> old version is running is days. Without it, it is however long a user takes
> to open the App Store — which for a work tool on a chantier can be never.

## Forcing an update

Two kinds, and only one can be forced quietly.

**Over the air.** A JavaScript change is fetched and applied by the app
itself, on launch and whenever it returns to the foreground. Nobody is asked
and nobody has to do anything: the app reloads and the new code is running.
That covers most releases, and it is why the wall below should be rare.

**Through the store.** Native code cannot travel over the air. When an old
binary is genuinely broken against the server — a function it calls has
changed shape, a column it writes is gone — raise the floor:

```sql
update public.app_policy set minimum_version = '1.1.0', updated_at = now();
```

Anything below that version stops at a screen with one button, which opens
the store. No dismissal and no "later": a "later" means a chef declaring work
into a version whose writes the server has stopped accepting, and learning
about it at the end of the week.

Optional wording for a particular release, shown instead of the default
sentence:

```sql
update public.app_policy
   set note_fr = 'Les devis ont changé de format. Mettez à jour pour continuer à les lire.',
       note_en = 'Devis changed format. Update to keep reading them.'
 where id;
```

The row is readable by anyone and writable through no key at all — raising
the floor shuts people out of their work, so it is typed against the database
on purpose. Check what is live with:

```sql
select minimum_version, updated_at from public.app_policy;
```

**Raise it only when an older build is actually broken.** A wall in front of
somebody standing on a chantier is a serious thing to put there, and the
honest reason to put it there is that the alternative is worse.

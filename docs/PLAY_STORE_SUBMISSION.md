# Play Store submission — CASPROD 1.0

Companion to `docs/APP_STORE_SUBMISSION.md`. Assets are generated into
`~/Desktop/casprod-play/` (icon 512×512, feature graphic 1024×500, two 9:16
screenshots). Play Console: https://play.google.com/console

## 0. Before anything: background location

`app.json` requests `ACCESS_BACKGROUND_LOCATION`. The justification Google
cares about is **protection du travailleur isolé** — lone-worker protection —
not the chef's map. Google weighs a safety use far more kindly than a
visibility one, and this is a safety use: a man alone on a chantier who falls
from a scaffold, is caught in a trench collapse or takes a shock has nobody to
call for help, and his employer owes him a duty of care. A phone in the pocket
of a body that has stopped moving is the only thing that can notice.

How it works, in the words the forms want:

> While an employee has a declared work day open and has agreed to the notice,
> his position is reported in the background. If it has not moved more than
> 35 m for 25 minutes, the app asks whether he is all right; if he does not
> answer within 3 minutes, his site manager is alerted by push notification
> with the last known position so somebody can go and look. Moving again
> answers the question by itself. The watch stops with the declared day.

The same background stream also powers optional live sharing for the chef's
map, which is secondary and is described as such.

Google requires a **video (YouTube link) showing the in-app prominent
disclosure, the permission prompt, and the feature working**, and rejections
are common on a first pass. Record 30–60 s: employee opens the day screen →
reads the notice → accepts → Android's "Allow all the time" prompt → phone
left still → "Êtes-vous d'accord ?" appears → unanswered → chef's phone shows
the alert. Upload unlisted, paste the link in the form.

**Internal, not for any form:** check the watch is running on the demo company
before recording and before submitting. A feature a reviewer cannot exercise is
one Google assumes does not exist.

```sql
update public.companies set lone_worker_enabled = true where name = '<demo company>';
```

(The fallback of dropping background location for v1 is still available —
`app.json` plus `requestBackgroundPermissionsAsync` in `lib/live-location.ts`
— but it removes lone-worker protection, not just the map, so it is a safety
decision and not a packaging one.)

## 1. Google Play Console account

One-time 25 USD registration at https://play.google.com/console/signup, as
an *individual* or *organization*. Identity verification can take 1–2 days —
start this first if not done. Since November 2023 individual accounts must
also run a **closed test with at least 12 testers for 14 days** before
production access is granted; organization accounts skip this. Budget for it.

## 2. Create the app

Console → **Create app**: name `CASPROD`, default language *French (France)*,
App, Free. Declarations: not a news app, not COVID-related.

## 3. Build and first upload (manual, required by Google)

```bash
npm run preflight
npx eas-cli build --platform android --profile production
```
EAS generates and stores the upload keystore on first run (answer *yes* to
"Generate a new Android Keystore?"). Download the `.aab` from the build page.

Console → **Test and release → Testing → Internal testing → Create new
release** → upload the `.aab` → *Use Google-generated key* for Play App
Signing → Save. Google requires the first upload to be manual; every later
release can use `npx eas-cli submit --platform android --latest` once a
service account is set up (Console → Users and permissions).

**Google Maps key.** After the first upload, Console → *Test and release →
Setup → App signing* shows the **App signing key certificate SHA-1**. Add it
to the Maps API key restrictions in Google Cloud alongside the debug SHA-1;
otherwise the Play-signed build shows blank maps. Also add the **Upload key
SHA-1** printed by `npx eas-cli credentials --platform android`.

## 4. App content (Policy → App content)

- **Privacy policy**: `https://casprod.app/privacy`
- **Ads**: No.
- **App access**: *All or some functionality is restricted* → add
  instructions: chef `demo.chef@casprod.app` / `Casprod-Demo-2026`, employee
  username `youssef.demo` / `Casprod-Demo-2026`. Same note as Apple: employees
  sign in with a username.
- **Content rating**: questionnaire → Utility/Productivity → all No → *Everyone*.
- **Target audience**: 18 and over.
- **News app**: No. **COVID**: No. **Government app**: No.
- **Data safety** (section 5).
- **Financial features**: none.
- **Health**: none.
- **Account deletion**: *Yes, users can request deletion* → in-app path
  *Compte → Supprimer mon compte*, web URL `https://casprod.app/support`
  (section "Supprimer son compte"). Data deleted: identity, contact, photos,
  location; retained: anonymised declared work (company records).
- **Sensitive permissions → Location (background)** — *Core feature*:
  "Lone-worker safety protection on construction sites. While an employee has
  a declared work day open and has given explicit in-app consent, his position
  is reported in the background. If it has not moved more than 35 m for 25
  minutes the app asks whether he is all right; if he does not answer within 3
  minutes his site manager is alerted with the last known position, so somebody
  can go and look — a worker alone on a chantier who has fallen cannot call for
  help himself. The same stream optionally shows the site manager who is on
  site. Both stop automatically at the end of the declared day or when consent
  is withdrawn, and only the latest position is stored; no trail is kept."
  + YouTube link.
- **Foreground service**: type *location*, same justification. The persistent
  notification tells the employee the watch is running, which is also the
  prominent disclosure Google asks for.
- **Photo and video permissions**: the app uses the system photo picker /
  camera intent (expo-image-picker), no `READ_MEDIA_IMAGES` — declare *not
  used* if asked.

## 5. Data safety form

Collects data: **Yes**. Encrypted in transit: **Yes**. Deletion request: **Yes**.

| Data | Collected | Shared | Required | Purpose |
|---|---|---|---|---|
| Name | Yes | No | Yes | App functionality, account management |
| Email (chef) | Yes | No | Yes | Account management |
| Phone | Yes | No | Optional | App functionality |
| User IDs | Yes | No | Yes | Account management |
| Precise location | Yes | No | Optional (consent) | App functionality, **safety** |
| Photos | Yes | No | Optional (consent) | App functionality |
| Device / other IDs (push token) | Yes | No | Yes | App functionality |

Nothing is shared with third parties; no advertising, no analytics SDK.
Ephemeral processing: No (data is stored). Independent security review: No.

## 6. Store listing (Grow → Store presence → Main store listing)

- **App name**: `CASPROD`
- **Short description** (80): `Chantiers, équipes et présence — en clair, avec l'accord de chacun.`
- **Full description**: reuse the App Store description from
  `docs/APP_STORE_SUBMISSION.md` §3 (same text).
- **App icon**: `icon-512.png`. **Feature graphic**: `feature-graphic.png`.
- **Phone screenshots**: `screenshot-1.png`, `screenshot-2.png` (min 2; add
  more later from the emulator when convenient).
- **Category**: Business. **Tags**: optional.
- **Contact**: `contact@casprod.app`, website `https://casprod.app`.

## 7. Release path

1. Internal testing: install on your own Android phone via the opt-in link,
   run through sign-in, day, presence check, live map, account deletion.
2. Individual account: promote to **Closed testing**, gather 12 testers,
   wait 14 days, then apply for production access in *Dashboard*.
3. **Production → Create release** → same `.aab` (or a new build) → roll out
   to 100 %. Review usually 1–3 days for a new app; longer if background
   location is declared.

# Play Store submission — CASPROD 1.0

Companion to `docs/APP_STORE_SUBMISSION.md`. Assets are generated into
`~/Desktop/casprod-play/` (icon 512×512, feature graphic 1024×500, two 9:16
screenshots). Play Console: https://play.google.com/console

## 0. Before anything: background location

`app.json` requests `ACCESS_BACKGROUND_LOCATION` for live sharing. Google
reviews this permission much more strictly than Apple: the *App content →
Sensitive permissions* form requires a **video (YouTube link) showing the
in-app prominent disclosure, the permission prompt, and the feature working**,
and rejections are common on a first pass. Two options:

- **Keep it.** Record a 30–60 s screen capture: employee opens the day screen
  → live-sharing notice → accepts → Android's "Allow all the time" prompt →
  chef's Live tab shows the pin. Upload unlisted on YouTube, paste the link in
  the form. Justification text is in section 4.
- **Drop it for v1.** Live sharing then only works while the app is open (a
  foreground service with a persistent notification still counts as "open" on
  Android). One-line change in `app.json` plus removing
  `requestBackgroundPermissionsAsync` in `lib/live-location.ts`; presence checks
  are unaffected. Faster approval, no video; ask Claude to make the change.

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
- **Sensitive permissions → Location (background)** — only if kept:
  *Core feature*: "Live position sharing during a declared work day, enabled
  by the employer per employee and started only after the employee's explicit
  in-app consent. Position is sent every ~2 minutes while the declared day is
  open, including in background, so the site manager can see who is on site.
  Stops automatically at end of day or when consent is withdrawn. Only the
  latest position is stored." + YouTube link.
- **Foreground service**: type *location*, same justification.
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
| Precise location | Yes | No | Optional (consent) | App functionality |
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

# App Store submission — CASPROD 1.0 (MVP)

What to paste into App Store Connect, and what still has to be done by hand
before pressing Submit. Companion to `PROJECT_STATUS.md`; the legal texts the
app links to are in `docs/legal/`.

## 1. Review Notes (App Review Information → Notes)

Paste as-is, in English. Reviewers read this before opening the app; the
background-location line is the one they will look for.

```
CASPROD is a workforce app for small construction companies. Two roles:

- CHEF (site manager): creates the company, adds construction sites, adds
  employees or shares a join code, sees who has declared a work day, and which
  tasks were declared.
- EMPLOYEE: declares a work day on a site, declares completed tasks from a
  fixed catalogue, and answers 2–3 random presence checks per declared day
  (a photo taken on the spot + a single GPS reading).

DEMO ACCOUNTS (already linked to the same company, with one site created):
  Chef:     <email>  /  <password>
  Employee: username <username>  /  <password>
  (Employees sign in with a username, not an email.)

PROTECTION DU TRAVAILLEUR ISOLÉ (lone-worker protection)
- This is the safety feature the background location mode exists for, and the
  reason the app is used on sites where a man works out of sight of anyone
  else. French and Moroccan employers owe a duty of care to a worker alone on
  a chantier; a fall from a scaffold, a trench collapse or an electric shock
  leaves nobody to call for help.
- How it works: while an employee has a declared work day open and has agreed
  to the notice, his phone reports its position in the background. If the
  position has not moved more than 35 m for 25 minutes, the app asks him
  whether he is all right. If he does not answer within 3 minutes, his site
  manager is alerted by push notification with the last known position, so
  somebody can go and look. Moving again answers the question by itself.
- The employee can switch his own watch off at any time, and the whole
  feature stops when he ends his declared day.
- To see it: sign in as the demo employee, start a work day, accept the
  notice, and leave the phone still — or press the alert button on the day
  screen, which raises the same alert immediately and shows it on the chef's.

LOCATION USE
- Presence checks read the location ONCE, only when the employee taps to
  answer a check. No background access is involved.
- Optional "live sharing": a chef can enable it per employee. It only starts
  after the employee reads a dedicated notice and explicitly agrees inside
  the app, runs only while a work day the employee declared is open, sends a
  position roughly every 2 minutes (including in background, which is why
  the app declares the location background mode), and stops automatically
  when the employee ends the day or withdraws consent. Only the latest
  position is stored; no movement history is kept. The employee can withdraw
  at any time from the day screen and can sign out at any time.
- The SAME background stream feeds lone-worker protection above, which is the
  safety reason the background mode is requested: a position that stops
  moving is what raises the alarm. Without background location a worker who
  has fallen cannot be noticed, because a phone in a pocket on a stationary
  body stops reporting the moment the screen locks.
- To see it: sign in as the chef → Employees → open the demo employee →
  enable "Live location". Then sign in as the employee, accept the notice,
  start a work day. The chef's "Live" tab shows the pin.

CAMERA / PHOTOS
- The camera is used only to take the presence-check photo, and only after
  the employee taps. Photo library access is used only to pick a profile
  picture from the account screen. Photos and coordinates from presence
  checks are deleted after 30 days.

ACCOUNT DELETION
- Account → "Delete my account" → confirm → a five-second countdown the user
  can still cancel. Works for both roles. A chef deleting their account
  deletes the company and its employees' accounts, which the confirmation
  text states.

BUSINESS MODEL — NO IN-APP PURCHASE
- CASPROD is sold to construction companies, not to individuals. A company is
  invoiced directly by us, outside the app, like any B2B service.
- Nothing can be bought in the app. There is no store, no plan selection, no
  price and no link to a pricing page anywhere in the binary.
- A new company gets 15 days of access. The chef sees a one-time welcome
  screen stating the number of days. After that, if we have not activated the
  company's access, the chef sees a screen asking him to call or write to us
  so we can reactivate it. That screen also lets him carry on for one more
  day, three times, without contacting anyone. Employees are never gated by
  this.
- The phone number and e-mail address on those screens are for account
  activation and support. They are the only outbound links in the app.
- The demo chef account above has an active access, so the reviewer never
  meets that screen.

PUSH NOTIFICATIONS
- Used only to tell an employee that a presence check is due. Permission is
  requested after the employee has agreed to presence checks.

The app is in French with an English switch on the account screen.
```

If the reviewer should also see the access screen, say so explicitly and give
a second chef account that is locked — never leave it to chance.

Fill in the four credential placeholders before submitting. The demo
employee must already have accepted the presence notice OR the notes must say
the reviewer will be asked to accept it — either is fine, but do not leave the
reviewer facing an unexplained consent gate.

## 2. App Privacy (nutrition label)

Answer "Yes, we collect data", then declare:

| Data type            | Collected | Linked to user | Used for tracking | Purpose            |
|----------------------|-----------|----------------|-------------------|--------------------|
| Name                 | Yes       | Yes            | No                | App functionality  |
| Email address        | Yes (chef)| Yes            | No                | App functionality  |
| Phone number         | Yes (opt.)| Yes            | No                | App functionality  |
| User ID              | Yes       | Yes            | No                | App functionality  |
| Precise location     | Yes       | Yes            | No                | App functionality  |
| Photos or videos     | Yes       | Yes            | No                | App functionality  |
| Coarse location      | No        |                |                   |                    |
| Device ID / Crash / Analytics / Advertising data | No | | | |

"Used for tracking" is No everywhere: nothing is shared with data brokers or
used for ads. Push tokens are not a declared category (they are treated as
part of app functionality).

## 3. Things only you can do

- [ ] Host `docs/legal/privacy-policy.md` and `docs/legal/terms.md` on a
      public URL (GitHub Pages, Notion public page, a static Supabase bucket…).
      Fill in the placeholders first (publisher identity, contact address).
- [ ] Put the two URLs in `.env` and on EAS:
      `EXPO_PUBLIC_PRIVACY_POLICY_URL`, `EXPO_PUBLIC_TERMS_URL`
      (`npx eas-cli env:create --name EXPO_PUBLIC_PRIVACY_POLICY_URL --value <url> --environment production`, same for terms).
      `npm run preflight` fails until they exist on EAS.
- [ ] App Store Connect → App Information → Privacy Policy URL = the same URL.
- [ ] Deploy the backend to the hosted project: `npx supabase db push`,
      `npx supabase functions deploy delete-account create-employee reset-employee-password presence-dispatch`,
      then the cron job from `supabase/operations/schedule-presence.sql`
      (see `docs/BACKEND.md`). Account deletion does not work in production
      until the migration and `delete-account` are deployed.
- [ ] APNs key in EAS credentials (`npx eas-cli credentials` → iOS → Push
      Notifications), otherwise presence checks never reach iOS devices.
- [ ] Create the two demo accounts on the production database, link them,
      create one site, and put the credentials in the Review Notes.
- [ ] Screenshots: 6.7" and 6.5" iPhone are mandatory; iPad only if you keep
      iPad support enabled (consider `"supportsTablet": false` in `app.json`
      for the MVP to avoid the iPad screenshot set and iPad-layout review).
- [ ] Age rating questionnaire (all "None"), category "Business", price Free.
- [ ] Export compliance is already declared (`ITSAppUsesNonExemptEncryption: false`).

## 4. Shipping an update over the live version

1.0.0 stays on the store, serving everyone, until 1.1.0 is approved **and
released**. Nothing you do below takes it down or interrupts anybody; the two
coexist until the moment you swap them.

### Build and upload

```bash
npm run preflight
npx eas-cli build --platform ios --profile production --auto-submit
```

`--auto-submit` uploads it to App Store Connect when the build finishes.
Without it: `npx eas-cli submit --platform ios --latest`.

Then **wait for processing** — TestFlight → Builds shows "Processing" for ten
to thirty minutes. The build cannot be attached to a version until it is done,
and it will simply not appear in the list before then.

### Create the version

App Store Connect → the app → **iOS App** in the left column → **+ Version or
Platform** → `1.1.0`. It has to match `app.json`'s `version` exactly.

This gives you a fresh, editable copy of every field. **The live version's
metadata is frozen; the new version's is not** — so this is where screenshots,
description and keywords are replaced, and nothing you type here affects what
is on the store until 1.1.0 goes live.

### Replace the listing

- **Screenshots** — the only piece Apple is fussy about. Upload the largest
  iPhone size it asks for and it scales the rest; it will tell you the exact
  pixels in the uploader. Drag to reorder: the first two are what people see
  without scrolling, so they should be the chantier list and the day screen,
  not a settings page.
- **Description, keywords, subtitle, support URL** — overwrite freely.
- **Promotional text** — the one field that can be changed later without a
  review, at any time, including while a version is live. Anything you expect
  to reword belongs there rather than in the description.
- **What's New in This Version** — required for an update, and read. Say what
  changed in a sentence or two, in French.

### Attach the build and submit

- **Build** section → **+** → pick the processed build.
- **Export compliance**: standard HTTPS only, no proprietary cryptography.
- **App Review Information**: the notes in §1 of this document, and demo
  accounts that work — a reviewer locked out is a rejection.
- **Version Release**: choose **Manually release this version**. Automatic
  means it goes live the hour it is approved, which may be three in the
  morning. Manual means you press the button when you are awake and watching.
- **Add for Review** → **Submit**.

Review is typically a day or two. You will get "In Review", then "Pending
Developer Release" if you chose manual — the app is approved and waiting for
you.

### Release

Press **Release this version**. It propagates to the store over a few hours.

For a release carrying a lot of change, **Phased Release for Automatic
Updates** (a checkbox on the version) rolls it to 1 %, 2 %, 5 % … of existing
users over seven days and can be paused if something is wrong. New downloads
get it immediately either way. There is no undo on the App Store, so a phased
release is the only brake you have.

### After it is live

From 1.1.0 onward, a JavaScript fix no longer needs any of this:

```bash
npx eas update --channel production --message "ce que ça corrige"
```

See `docs/UPDATES.md` for what can and cannot travel that way.

---

## 5. Guideline 3.1 — why no in-app purchase

Worth knowing before anyone adds a "see our pricing" button back.

A free app that is a companion to a paid service billed elsewhere is exempt
from in-app purchase under **3.1.3(f)**, but only "provided there is no
purchasing inside the app, or calls to action for purchase outside of the
app." The second half is what gets apps rejected: a link to a pricing page,
a plan name, a price, or a button that says "subscribe" is read as steering
under **3.1.1**, and Morocco's storefront gets neither the US link-entitlement
from the Epic injunction nor the EU DMA carve-out.

So the app says what access a company has and where to write to change it,
and says nothing at all about money. `SALES_EMAIL` in
`SALES_PHONE` and `SALES_EMAIL` in `src/components/access-gate.tsx` are the
only outbound links; the comment above them says why. The pricing page lives on the website, which is where a chef who
wants prices will look anyway.

## 6. Known non-blockers

- Console warning "Can't perform a React state update on a component that
  hasn't mounted yet" from `expo-router/useLinking.native.js` on Android
  cold-start via deep link — dev-only, upstream, no user impact.
- Terms of service are a short MVP text; that is acceptable as long as the
  link works and the page is not empty.

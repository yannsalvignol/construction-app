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
  company's access, the chef sees a screen asking him to write to us so we can
  reactivate it. Employees are never gated by this.
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

## 4. Guideline 3.1 — why no in-app purchase

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

## 5. Known non-blockers

- Console warning "Can't perform a React state update on a component that
  hasn't mounted yet" from `expo-router/useLinking.native.js` on Android
  cold-start via deep link — dev-only, upstream, no user impact.
- Terms of service are a short MVP text; that is acceptable as long as the
  link works and the page is not empty.

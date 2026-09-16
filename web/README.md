# web/ — everything that lives at casprod.app

Separate from the Expo mobile app on purpose: the web side has its own
feature set (chef-only) and its own stack. It shares only the Supabase
backend (`supabase/`) with the phone app.

| Folder | What | Stack | Deploys to |
|---|---|---|---|
| `site/` | Public landing + legal pages (`/`, `/privacy`, `/terms`, `/support`) | Hand-written HTML/CSS/JS, three.js hero | https://casprod.app |
| `app/` | Chef workspace (`/login`, `/signup`, `/onboarding`, `/dashboard`, `/employees`, `/sites`, `/live`, `/account`) | Vite + React + TypeScript, supabase-js | https://casprod.app/login |

Both ship together as **one** Cloudflare Pages project (`casprod`):
`web/build.mjs` assembles `web/dist` from the two, and writes the `_redirects`
that route the app paths to the SPA shell (`app.html`) while everything else
stays a static file of the landing.

```bash
npm run web:build     # from the repo root → web/dist
npm run web:deploy    # build + deploy to production
```

Adding an app route: add it to `APP_ROUTES` in `web/build.mjs` and to the
router in `web/app/src/App.tsx`.

## Landing (`site/`)

The legal pages are generated from `docs/legal/*.md` (`npm run site`, also
run by `web:build`). `index.html`, `landing.css`, `landing.js` are edited by
hand; bump the `?v=` on the CSS/JS links in `index.html` when they change.

## Chef workspace (`app/`)

```bash
cd web/app
cp .env.example .env      # then fill VITE_SUPABASE_PUBLISHABLE_KEY (same value as the root .env)
npm install
npm run dev               # http://localhost:5173/login
```

Employees never use it: an employee profile sees a "use the phone app"
notice, and there is no join-with-code flow here. Everything goes through
the same RLS policies, RPCs (`chef_dashboard`, `site_team`, `live_team`,
`remove_employee`, `remove_site`, `regenerate_company_join_code`) and Edge
Functions (`create-employee`, `reset-employee-password`, `delete-account`)
as the mobile app, so a rule enforced for the phone is enforced here too.

Site creation geocodes with OpenStreetMap Nominatim (no key, light use);
the mobile app uses the platform geocoder, so a same address may resolve to
slightly different coordinates.

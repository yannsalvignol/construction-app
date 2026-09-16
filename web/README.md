# web/ — everything that lives at casprod.app

Separate from the Expo mobile app on purpose: the web side has its own
feature set (chef-only) and its own stack. It shares only the Supabase
backend (`supabase/`) with the phone app.

| Folder | What | Stack | Deploys to |
|---|---|---|---|
| `site/` | Public landing + legal pages (`/privacy`, `/terms`, `/support`) | Hand-written HTML/CSS/JS, three.js hero | Cloudflare Pages project **casprod** → https://casprod.app |
| `app/` | Chef workspace: sign-in, company sign-up, dashboard, employees, sites, live positions, account | Vite + React + TypeScript, supabase-js | Cloudflare Pages project **casprod-web** → https://app.casprod.app |

## Landing (`site/`)

The legal pages are generated from `docs/legal/*.md`:

```bash
npm run site                                  # from the repo root → web/site/{privacy,terms,support}
npx wrangler pages deploy web/site --project-name casprod --branch main --commit-dirty=true
```

`index.html`, `landing.css`, `landing.js` are edited by hand. Bump the `?v=`
on the CSS/JS links in `index.html` when deploying a change.

## Chef workspace (`app/`)

```bash
cd web/app
cp .env.example .env      # then fill VITE_SUPABASE_PUBLISHABLE_KEY (same value as the root .env)
npm install
npm run dev               # http://localhost:5173
npm run deploy            # build + deploy to casprod-web
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

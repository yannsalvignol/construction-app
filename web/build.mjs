#!/usr/bin/env node
// Assembles web/dist = landing site + chef app, the single deploy unit for
// the casprod.app Cloudflare Pages project.
//
//   /             landing (web/site/index.html)
//   /privacy …    legal pages generated from docs/legal
//   /login, /dashboard, /employees/… the chef app (web/app, a Vite SPA whose
//                 shell is app.html; Pages rewrites the app routes to it)

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WEB = new URL('.', import.meta.url).pathname;
const DIST = path.join(WEB, 'dist');
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('node', [path.join(WEB, 'site-build.mjs')], WEB);
run('npm', ['run', 'build'], path.join(WEB, 'app'));

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);
cpSync(path.join(WEB, 'site'), DIST, { recursive: true });
cpSync(path.join(WEB, 'app/dist'), DIST, { recursive: true });

// App routes. Anything under these prefixes is the SPA; everything else is a
// static file of the landing. Kept explicit so a typo in a landing link
// still 404s instead of silently opening the app.
export const APP_ROUTES = ['/login', '/signup', '/onboarding', '/dashboard', '/employees', '/sites', '/planning', '/live', '/account'];
writeFileSync(path.join(DIST, '_redirects'),
  APP_ROUTES.flatMap((r) => [`${r}  /app  200`, `${r}/*  /app  200`]).join('\n') + '\n');

writeFileSync(path.join(DIST, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/app.html
  X-Frame-Options: DENY
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/vendor/*
  Cache-Control: public, max-age=31536000, immutable

/landing.css
  Cache-Control: public, max-age=300, must-revalidate

/landing.js
  Cache-Control: public, max-age=300, must-revalidate

/style.css
  Cache-Control: public, max-age=300, must-revalidate
`);
console.log(`web/dist assembled (${APP_ROUTES.length} app routes)`);

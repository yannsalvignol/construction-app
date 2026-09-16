#!/usr/bin/env node
// Exports the Expo app for the web (the chef's browser workspace at
// app.casprod.app) into dist/, always against the hosted Supabase project.
//
// .env.local points the dev build at the local Supabase stack and Expo CLI
// gives it precedence over .env, so a plain `expo export` from a dev machine
// would silently ship a bundle that talks to 127.0.0.1. Reading .env here and
// forcing its values into the process environment (which Expo never
// overrides) makes the export deterministic wherever it runs.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const env = { ...process.env };
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
if (!env.EXPO_PUBLIC_SUPABASE_URL?.startsWith('https://')) {
  console.error('EXPO_PUBLIC_SUPABASE_URL in .env must be the hosted project URL');
  process.exit(1);
}
const result = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist'], { stdio: 'inherit', env });
process.exit(result.status ?? 1);

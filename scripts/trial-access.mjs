#!/usr/bin/env node
// Moves a company's trial clock, so the two access screens can actually be
// looked at. The lock is fifteen days from `companies.trial_started_at`, which
// means there is no way to see the locked screen without either waiting a
// fortnight or backdating the clock — so: backdate the clock.
//
// This writes to whatever project .env points at. It is a development tool,
// not an admin console; flipping a real customer's access is a deliberate SQL
// statement somebody types on purpose, not a script anyone can run twice.
//
//   node scripts/trial-access.mjs list
//   node scripts/trial-access.mjs expire <company-id> [minutes]   # default 1
//   node scripts/trial-access.mjs unsee  <company-id>             # welcome again
//   node scripts/trial-access.mjs restore <company-id>            # active, clock reset
//
// Needs in .env / .env.local:
//   EXPO_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const file of ['.env', '.env.local']) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1]] ??= m[2];
  }
}
const db = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const [cmd, arg] = process.argv.slice(2);

async function list() {
  const { data, error } = await db
    .from('companies')
    .select('id,name,trial_started_at,subscription_active,profiles(id,role,first_name,last_name,trial_notice_seen_at)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  for (const c of data) {
    const chefs = (c.profiles ?? []).filter((p) => p.role === 'chef');
    console.log(
      `${c.name}\n  id=${c.id}\n  active=${c.subscription_active} trial_started=${c.trial_started_at}` +
      `\n  chefs: ${chefs.map((p) => `${`${p.first_name} ${p.last_name}`}${p.trial_notice_seen_at ? '' : ' (notice unseen)'}`).join(', ') || '—'}`
    );
  }
}

async function expire(id, minutes) {
  // 15 days ago, plus however many minutes are wanted before the lock bites.
  const started = new Date(Date.now() - 15 * 86400_000 + Number(minutes) * 60_000);
  const { error } = await db.from('companies')
    .update({ trial_started_at: started.toISOString(), subscription_active: false })
    .eq('id', id);
  if (error) throw error;
  console.log(`locks at ${new Date(started.getTime() + 15 * 86400_000).toLocaleTimeString()}`);
}

async function restore(id) {
  const { error } = await db.from('companies')
    .update({ trial_started_at: new Date().toISOString(), subscription_active: true })
    .eq('id', id);
  if (error) throw error;
  console.log('restored: active again, clock reset');
}

/** Lets the welcome screen appear again for every chef of a company. */
async function unsee(id) {
  const { error } = await db.from('profiles')
    .update({ trial_notice_seen_at: null }).eq('company_id', id).eq('role', 'chef');
  if (error) throw error;
  console.log('welcome screen will show again');
}

if (cmd === 'list') await list();
else if (cmd === 'expire') await expire(arg, process.argv[4] ?? 1);
else if (cmd === 'restore') await restore(arg);
else if (cmd === 'unsee') await unsee(arg);
else console.log('usage: trial.mjs list | expire <company> [minutes] | restore <company> | unsee <company>');

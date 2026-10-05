#!/usr/bin/env node
// Who has access, and the two commands that change it.
//
// `on` is what to run when a company has paid: it lifts the chef's wall and
// the crew's in the same statement, immediately, with nothing to redeploy and
// nobody to tell. `off` is the end of a subscription.
//
// The rest moves a trial clock so the access screens can be looked at without
// waiting a fortnight. Development only.
//
// This writes to whatever project .env points at, which is production.
//
//   node scripts/trial-access.mjs list
//   node scripts/trial-access.mjs on  <company-id>   # paid: everyone back in
//   node scripts/trial-access.mjs off <company-id>   # stopped paying
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

/**
 * A company has paid.
 *
 * One flag covers both walls: the chef's screen clears the next time he opens
 * the app, and his men — who were signed out — simply sign in again with the
 * credentials they always had. Nothing is reissued and nothing was deleted.
 *
 * The three postponements are given back at the same time. They exist for the
 * days between an invoice and its payment, and a company that has now paid
 * should not start its next cycle having already spent them.
 */
async function on(id) {
  const { data, error } = await db.from('companies')
    .update({ subscription_active: true, grace_days_used: 0, grace_until: null })
    .eq('id', id).select('name').single();
  if (error) throw error;
  console.log(`${data.name} : accès rétabli. Le chef et ses employés peuvent se reconnecter.`);
}

/** The end of a subscription: the clock that was frozen starts again. */
async function off(id) {
  const { data, error } = await db.from('companies')
    .update({ subscription_active: false })
    .eq('id', id).select('name,trial_started_at').single();
  if (error) throw error;
  console.log(`${data.name} : accès suspendu.`);
  console.log('  Le chef est arrêté immédiatement si ses quinze jours sont passés,');
  console.log('  ses employés une semaine après lui.');
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
else if (cmd === 'on') await on(arg);
else if (cmd === 'off') await off(arg);
else if (cmd === 'expire') await expire(arg, process.argv[4] ?? 1);
else if (cmd === 'restore') await restore(arg);
else if (cmd === 'unsee') await unsee(arg);
else console.log('usage: trial-access.mjs list | on <company> | off <company> | expire <company> [minutes] | restore <company> | unsee <company>');

#!/usr/bin/env node
// Fills the demo company with past activity: declared work days and the task
// declarations that go with them, so the dashboards, the chantier screens and
// a person's activity history have something real to show.
//
// Everything it writes goes through the same tables the phones write to
// (work_days, task_declarations), so nothing here is a special case the app
// has to know about.
//
// Usage:
//   node scripts/seed-history.mjs                 # the last 30 days
//   node scripts/seed-history.mjs --days=90       # a longer history
//   node scripts/seed-history.mjs --company="Autre SARL"
//   node scripts/seed-history.mjs --wipe          # remove what it wrote
//
// Needs EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv(file) {
  try {
    for (const line of readFileSync(resolve(file), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch { /* optional file */ }
}
loadEnv('.env.local');
loadEnv('.env');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const DAYS = Number(flag('days', '30'));
const COMPANY = flag('company', 'Castor Ingénierie');
const WIPE = args.includes('--wipe');
const TIME_ZONE_OFFSET = '+01:00'; // Africa/Casablanca, all year

/** Employees work most days; a chantier is not a 100% attendance sheet. */
const ATTENDANCE = 0.85;
/** Sunday off. Saturday is a working day on these sites. */
const isWorked = (date) => date.getUTCDay() !== 0;

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (put the key in .env.local).');
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const fail = (step, error) => { console.error(`✖ ${step}:`, error.message ?? error); process.exit(1); };

/** Stable pseudo-random in [0,1) from a string: a rerun writes the same story. */
function rand(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
const pick = (list, seed) => list[Math.floor(rand(seed) * list.length) % list.length];

/** A believable amount for one person, one day, in that unit. */
function quantityFor(unit, seed) {
  const r = rand(seed);
  switch (unit) {
    case 'unit': return 1 + Math.floor(r * 4);
    case 'm': return Math.round((4 + r * 26) * 2) / 2;
    case 'm2': return Math.round((6 + r * 30) * 2) / 2;
    case 'm3': return Math.round((1 + r * 7) * 2) / 2;
    case 'kg': return 20 + Math.floor(r * 180);
    default: return 1;
  }
}

const { data: company, error: companyError } = await admin
  .from('companies').select('id, name').eq('name', COMPANY).maybeSingle();
if (companyError) fail('company lookup', companyError);
if (!company) fail('company lookup', new Error(`No company named "${COMPANY}". Run seed-castor-demo.mjs first.`));

const { data: employees, error: employeesError } = await admin
  .from('profiles').select('id, first_name, last_name')
  .eq('company_id', company.id).eq('role', 'employee').is('deleted_at', null).order('first_name');
if (employeesError) fail('employees', employeesError);

const { data: sites, error: sitesError } = await admin
  .from('sites').select('id, name').eq('company_id', company.id).eq('is_active', true).order('name');
if (sitesError) fail('sites', sitesError);

if (!employees.length || !sites.length) fail('data', new Error('The company has no employees or no active sites.'));

// Dates: yesterday backwards. Today is left to simulate-castor-live.mjs, which
// opens the day the app shows as in progress.
const days = [];
for (let back = 1; back <= DAYS; back++) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - back);
  if (isWorked(date)) days.push(date.toISOString().slice(0, 10));
}

if (WIPE) {
  const { data: existing, error } = await admin
    .from('work_days').select('id').eq('company_id', company.id).in('work_date', days);
  if (error) fail('read work days', error);
  const ids = (existing ?? []).map((row) => row.id);
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500);
    const { error: declError } = await admin.from('task_declarations').delete().in('work_day_id', slice);
    if (declError) fail('delete declarations', declError);
    const { error: dayError } = await admin.from('work_days').delete().in('id', slice);
    if (dayError) fail('delete work days', dayError);
  }
  console.log(`Wiped ${ids.length} work days and their declarations over the last ${DAYS} days.`);
  process.exit(0);
}

const { data: codes, error: codesError } = await admin
  .from('task_codes').select('code, unit, category_code').eq('is_active', true);
if (codesError) fail('task codes', codesError);
// The demo company is a plumbing / HVAC contractor; electrical shows up on its
// sites too. Keeping the catalogue narrow makes the dashboards readable.
const trade = codes.filter((c) => c.category_code === 'plumbing_hvac' || c.category_code === 'electrical');
const unitOf = Object.fromEntries(trade.map((c) => [c.code, c.unit]));

// One chantier per employee for the whole period: a crew stays on its site,
// which is what makes a chantier's history readable.
const siteOf = Object.fromEntries(
  employees.map((employee, index) => [employee.id, sites[index % sites.length].id])
);

console.log(`${company.name}: ${employees.length} employees, ${sites.length} sites, ${days.length} working days`);

const { data: already, error: alreadyError } = await admin
  .from('work_days').select('employee_id, work_date').eq('company_id', company.id).in('work_date', days);
if (alreadyError) fail('existing work days', alreadyError);
const seen = new Set((already ?? []).map((row) => `${row.employee_id}:${row.work_date}`));

const rows = [];
for (const date of days) {
  for (const employee of employees) {
    const key = `${employee.id}:${date}`;
    if (seen.has(key)) continue;
    if (rand(`present:${key}`) > ATTENDANCE) continue;
    const start = `${date}T08:00:00${TIME_ZONE_OFFSET}`;
    const hours = 7 + Math.floor(rand(`hours:${key}`) * 3);
    const end = `${date}T${String(8 + hours).padStart(2, '0')}:00:00${TIME_ZONE_OFFSET}`;
    rows.push({
      employee_id: employee.id,
      company_id: company.id,
      site_id: siteOf[employee.id],
      work_date: date,
      started_at: new Date(start).toISOString(),
      planned_end_at: new Date(end).toISOString(),
      ended_at: new Date(end).toISOString(),
    });
  }
}

const created = [];
for (let i = 0; i < rows.length; i += 500) {
  const { data, error } = await admin.from('work_days').insert(rows.slice(i, i + 500)).select('id, employee_id, site_id, work_date');
  if (error) fail('insert work days', error);
  created.push(...(data ?? []));
  process.stdout.write(`\rwork days ${created.length}/${rows.length}`);
}
process.stdout.write('\n');

const declarations = [];
for (const day of created) {
  const count = 1 + Math.floor(rand(`count:${day.id}`) * 3);
  const used = new Set();
  for (let n = 0; n < count; n++) {
    const code = pick(trade, `code:${day.id}:${n}`).code;
    if (used.has(code)) continue;
    used.add(code);
    declarations.push({
      work_day_id: day.id,
      employee_id: day.employee_id,
      company_id: company.id,
      site_id: day.site_id,
      task_code: code,
      quantity: quantityFor(unitOf[code], `qty:${day.id}:${code}`),
      declared_at: new Date(`${day.work_date}T16:00:00${TIME_ZONE_OFFSET}`).toISOString(),
    });
  }
}

for (let i = 0; i < declarations.length; i += 500) {
  const { error } = await admin.from('task_declarations').insert(declarations.slice(i, i + 500));
  if (error) fail('insert declarations', error);
  process.stdout.write(`\rdeclarations ${Math.min(i + 500, declarations.length)}/${declarations.length}`);
}
process.stdout.write('\n');

console.log(`✔ ${created.length} work days and ${declarations.length} declarations over the last ${DAYS} days.`);
if (!created.length) console.log('  (nothing new — the period already has history; use --wipe to redo it)');

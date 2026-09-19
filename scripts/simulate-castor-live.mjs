#!/usr/bin/env node
// Simulates live location sharing for the Castor Ingénierie demo company.
//
// Picks employees from the S37 teams, opens a work day for each of them today
// on their chantier, marks them "partage en direct", and then keeps posting a
// position every 30 s while the script runs: most of them jitter around inside
// the chantier, a few are far away (fournisseur, route) and drive in slowly.
// Positions expire after 15 minutes without an update, so leave it running
// during the demo and Ctrl-C afterwards.
//
// It also declares tasks the way the phones do: each worker has the tasks of
// their S37 planning line mapped to catalogue codes with a realistic daily
// target; a share proportional to the time of day is declared at start, then
// quantities keep creeping up every few ticks so the chef sees the day's
// production build up. Declarations stay after --stop (they are the record).
//
// Usage:
//   node scripts/simulate-castor-live.mjs          # start / keep sharing
//   node scripts/simulate-castor-live.mjs --stop   # close the days, delete positions
//
// Needs EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see seed script).

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv(file) {
  try {
    for (const line of readFileSync(resolve(file), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch { /* optional */ }
}
loadEnv('.env.local');
loadEnv('.env');

const STOP = process.argv.includes('--stop');
const COMPANY_NAME = 'Castor Ingénierie';
const TIME_ZONE = 'Africa/Casablanca'; // UTC+1 all year
const TICK_MS = 30_000;

// username → chantier name (as seeded), where they are right now ('site' =
// inside the chantier; a number = that many km away, driving in), and the
// day's tasks as [catalogue code, realistic quantity for one day].
const SHARING = [
  // Maison Porsche
  { username: 'hicham.daou',        site: 'Maison Porsche',            where: 'site', tasks: [['CVC_CALORIFUGE', 18], ['CVC_DIFFUSEUR', 3]] },
  { username: 'hamza.elfatihi',     site: 'Maison Porsche',            where: 'site', tasks: [['CVC_CALORIFUGE', 14], ['CVC_DIFFUSEUR', 3]] },
  { username: 'yassine.chahid',     site: 'Maison Porsche',            where: 8, tasks: [['PLB_PPR_DN40', 12], ['PLB_PVC_DN40', 8]] },
  // Kssora
  { username: 'miloud.elkardouhi',  site: 'Kssora Immo — Hôtel Ksora', where: 'site', tasks: [['PLB_PVC_DN100', 6], ['SAN_WC', 2]] },
  { username: 'youssef.elbdioui',   site: 'Kssora Immo — Hôtel Ksora', where: 'site', tasks: [['PLB_PPR_DN25', 16]] },
  { username: 'nabil.zerraf',       site: 'Kssora Immo — Hôtel Ksora', where: 'site', tasks: [['PLB_PVC_DN40', 12]] },
  { username: 'anass.elferkaty',    site: 'Kssora Immo — Hôtel Ksora', where: 'site', tasks: [['PLB_PVC_DN40', 11]] },
  { username: 'rachid.serhani',     site: 'Kssora Immo — Hôtel Ksora', where: 'site', tasks: [['CVC_GAINE_DN125', 8]] },
  { username: 'driss.tla',          site: 'Kssora Immo — Hôtel Ksora', where: 11, tasks: [['CVC_GAINE_DN200', 12]] },
  // Marriott
  { username: 'abdessamad.belych',  site: 'Hôtel Marriott',            where: 'site', tasks: [['PLB_PVC_DN100', 10], ['SAN_WC', 3]] },
  { username: 'tarik.elmekhrami',   site: 'Hôtel Marriott',            where: 'site', tasks: [['PLB_PVC_DN100', 8]] },
  { username: 'ali.khadir',         site: 'Hôtel Marriott',            where: 'site', tasks: [['PLB_PPR_DN40', 15]] },
  { username: 'youness.belych',     site: 'Hôtel Marriott',            where: 'site', tasks: [['SAN_DOUCHE', 3]] },
  { username: 'bouabid.hadmaoui',   site: 'Hôtel Marriott',            where: 7, tasks: [['PLB_PPR_DN40', 6]] },
  // Aston Martin
  { username: 'hicham.amir',        site: 'Aston Martin',              where: 'site', tasks: [['CVC_CLIM_MURAL', 1]] },
  { username: 'zaki.hamza',         site: 'Aston Martin',              where: 'site', tasks: [['CVC_GAINE_DN200', 10], ['ELE_CABLE_U1000', 40]] },
  // Villas
  { username: 'abdelhaq.elkhadiri', site: 'Villa Faiza',               where: 'site', tasks: [['SAN_EVIER', 3], ['SAN_ROBINET', 6], ['PLB_PPR_DN25', 10]] },
  { username: 'othmane.hayouti',    site: 'Villa Yacoubi',             where: 'site', tasks: [['ELE_CABLE_U1000', 60], ['CVC_GAINE_DN125', 15]] },
  { username: 'smail.abanaaim',     site: 'Villa Yacoubi',             where: 'site', tasks: [['SAN_BAIGNOIRE', 1], ['SAN_WC', 2]] },
  { username: 'omar.kakih',         site: 'Villa Ghizlan Sentisi',     where: 'site', tasks: [['SAN_CHAUFFE_EAU', 1]] },
  { username: 'ayoub.chergaoui',    site: 'Hôtel Casablanca',          where: 'site', tasks: [['CVC_GAINE_DN200', 4]] },
  // LBV Meknès
  { username: 'osama.elmir',        site: 'LBV Meknès',                where: 'site', tasks: [['PLB_PVC_DN100', 12]] },
  { username: 'abderrahim.achaano', site: 'LBV Meknès',                where: 'site', tasks: [['PLB_PVC_DN40', 10]] },
  { username: 'armel.nkouka',       site: 'LBV Meknès',                where: 15, tasks: [['CVC_CLIM_MURAL', 1], ['CVC_DIFFUSEUR', 1]] },
  // Villa Bahia
  { username: 'mohamed.elmir',      site: 'Villa Bahia — Bahia Beach', where: 'site', tasks: [['PLB_PVC_DN100', 9]] },
  { username: 'taoufik.elmir',      site: 'Villa Bahia — Bahia Beach', where: 'site', tasks: [['PLB_PVC_DN100', 6], ['SAN_WC', 1]] },
];

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const fail = (step, error) => { console.error(`✖ ${step}:`, error.message ?? error); process.exit(1); };

// --- geo helpers ------------------------------------------------------------
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
function offset(lat, lng, northM, eastM) {
  return { lat: lat + northM / M_PER_DEG_LAT, lng: lng + eastM / mPerDegLng(lat) };
}
const rand = (min, max) => min + Math.random() * (max - min);
function randomInDisc(lat, lng, radiusM) {
  const r = radiusM * Math.sqrt(Math.random());
  const a = Math.random() * 2 * Math.PI;
  return offset(lat, lng, r * Math.cos(a), r * Math.sin(a));
}

// --- today in Casablanca ----------------------------------------------------
function localDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const today = localDate();
const startedAt = new Date(`${today}T08:00:00+01:00`);
const plannedEndAt = new Date(Math.max(Date.parse(`${today}T19:00:00+01:00`), Date.now() + 2 * 3600_000));

// --- lookups ----------------------------------------------------------------
const { data: company, error: companyError } = await admin.from('companies').select('id').eq('name', COMPANY_NAME).single();
if (companyError) fail('company lookup (run the seed first)', companyError);

const { data: profiles, error: profilesError } = await admin.from('profiles')
  .select('id, username, first_name, last_name').eq('company_id', company.id).eq('role', 'employee');
if (profilesError) fail('profiles', profilesError);
const profileByUsername = Object.fromEntries(profiles.map((p) => [p.username, p]));

const { data: sites, error: sitesError } = await admin.from('sites')
  .select('id, name, latitude, longitude').eq('company_id', company.id);
if (sitesError) fail('sites', sitesError);
const siteByName = Object.fromEntries(sites.map((s) => [s.name, s]));

const { data: taskCodes, error: codesError } = await admin.from('task_codes').select('code, unit');
if (codesError) fail('task codes', codesError);
const unitByCode = Object.fromEntries(taskCodes.map((t) => [t.code, t.unit]));

const members = SHARING.map((m) => {
  const profile = profileByUsername[m.username];
  const site = siteByName[m.site];
  if (!profile) fail('config', new Error(`no employee with username ${m.username}`));
  if (!site) fail('config', new Error(`no site named ${m.site}`));
  for (const [code] of m.tasks) if (!unitByCode[code]) fail('config', new Error(`unknown task code ${code}`));
  return { ...m, profile, site, declared: {} };
});
const memberIds = members.map((m) => m.profile.id);

// --- stop -------------------------------------------------------------------
if (STOP) {
  const { error: posError } = await admin.from('live_positions').delete().in('employee_id', memberIds);
  if (posError) fail('delete positions', posError);
  const { error: dayError } = await admin.from('work_days').update({ ended_at: new Date().toISOString() })
    .in('employee_id', memberIds).eq('work_date', today).is('ended_at', null);
  if (dayError) fail('close work days', dayError);
  console.log(`Stopped: positions removed and today's days closed for ${members.length} employees.`);
  process.exit(0);
}

// --- start: live mode, consent, open day -------------------------------------
const { error: modeError } = await admin.from('profiles').update({ location_mode: 'live' }).in('id', memberIds);
if (modeError) fail('set location_mode', modeError);

const { error: consentError } = await admin.from('live_location_consents').upsert(
  memberIds.map((employee_id) => ({ employee_id, notice_version: '2026-09-08', accepted_at: startedAt.toISOString(), revoked_at: null })),
  { onConflict: 'employee_id' });
if (consentError) fail('consents', consentError);

const workDayIds = {};
for (const m of members) {
  const { data: existing } = await admin.from('work_days').select('id, ended_at')
    .eq('employee_id', m.profile.id).eq('work_date', today).maybeSingle();
  if (existing) {
    if (existing.ended_at) {
      const { error } = await admin.from('work_days').update({ ended_at: null, planned_end_at: plannedEndAt.toISOString() }).eq('id', existing.id);
      if (error) fail(`reopen day ${m.username}`, error);
    }
    workDayIds[m.profile.id] = existing.id;
    continue;
  }
  const { data, error } = await admin.from('work_days').insert({
    employee_id: m.profile.id, company_id: company.id, site_id: m.site.id, work_date: today,
    started_at: startedAt.toISOString(), planned_end_at: plannedEndAt.toISOString(),
  }).select('id').single();
  if (error) fail(`open day ${m.username}`, error);
  workDayIds[m.profile.id] = data.id;
}

// --- declarations -------------------------------------------------------------
const DAY_START = Date.parse(`${today}T08:00:00+01:00`);
const DAY_END = Date.parse(`${today}T18:00:00+01:00`);
const dayFraction = Math.min(1, Math.max(0, (Date.now() - DAY_START) / (DAY_END - DAY_START)));
const round = (value, unit) => (unit === 'unit' ? Math.round(value) : Math.round(value * 2) / 2);

async function declare(now) {
  const rows = [];
  for (const m of members) {
    for (const [code, quantity] of Object.entries(m.declared)) {
      if (quantity <= 0) continue;
      rows.push({
        work_day_id: workDayIds[m.profile.id], employee_id: m.profile.id, company_id: company.id,
        site_id: m.site.id, task_code: code, quantity, declared_at: now,
      });
    }
  }
  if (!rows.length) return 0;
  const { error } = await admin.from('task_declarations').upsert(rows, { onConflict: 'work_day_id,task_code' });
  if (error) fail('declarations', error);
  return rows.length;
}

// What has already been done at this hour: a share of the day's target, a bit
// uneven from one worker to the next. Workers still on the road have nothing.
for (const m of members) {
  if (m.where !== 'site') continue;
  for (const [code, target] of m.tasks) {
    m.declared[code] = round(target * dayFraction * rand(0.55, 1.05), unitByCode[code]);
  }
}
const declaredAtStart = await declare(new Date().toISOString());

// --- initial positions --------------------------------------------------------
for (const m of members) {
  if (m.where === 'site') {
    m.pos = randomInDisc(m.site.latitude, m.site.longitude, 60);
  } else {
    // Somewhere `where` km out, heading back at a driving pace.
    const a = Math.random() * 2 * Math.PI;
    m.pos = offset(m.site.latitude, m.site.longitude, m.where * 1000 * Math.cos(a), m.where * 1000 * Math.sin(a));
    m.speedMps = rand(8, 14); // ~30-50 km/h
  }
}

async function tick() {
  const now = new Date().toISOString();
  const rows = members.map((m) => {
    if (m.where === 'site') {
      // Wander a few metres, stay within the plot.
      const next = offset(m.pos.lat, m.pos.lng, rand(-12, 12), rand(-12, 12));
      const inside = randomInDisc(m.site.latitude, m.site.longitude, 70);
      const dNorth = (next.lat - m.site.latitude) * M_PER_DEG_LAT;
      const dEast = (next.lng - m.site.longitude) * mPerDegLng(m.site.latitude);
      m.pos = Math.hypot(dNorth, dEast) > 80 ? inside : next;
    } else {
      // Drive toward the site; park inside once close.
      const dNorth = (m.site.latitude - m.pos.lat) * M_PER_DEG_LAT;
      const dEast = (m.site.longitude - m.pos.lng) * mPerDegLng(m.site.latitude);
      const dist = Math.hypot(dNorth, dEast);
      const step = m.speedMps * (TICK_MS / 1000);
      if (dist <= step + 100) { m.where = 'site'; m.pos = randomInDisc(m.site.latitude, m.site.longitude, 60); }
      else m.pos = offset(m.pos.lat, m.pos.lng, (dNorth / dist) * step + rand(-20, 20), (dEast / dist) * step + rand(-20, 20));
    }
    return {
      employee_id: m.profile.id, company_id: company.id, work_day_id: workDayIds[m.profile.id],
      latitude: m.pos.lat, longitude: m.pos.lng,
      accuracy_meters: m.where === 'site' ? rand(4, 18) : rand(10, 35), recorded_at: now,
    };
  });
  const { error } = await admin.from('live_positions').upsert(rows, { onConflict: 'employee_id' });
  if (error) fail('positions', error);

  // Roughly one worker in five adds to a declaration each tick, until the day
  // is done (a little over target is fine — some days go well).
  let bumped = 0;
  if (Date.now() < DAY_END + 3600_000) {
    for (const m of members) {
      if (m.where !== 'site' || Math.random() > 0.2) continue;
      const [code, target] = m.tasks[Math.floor(Math.random() * m.tasks.length)];
      const unit = unitByCode[code];
      const current = m.declared[code] ?? 0;
      if (current >= target * 1.3) continue;
      const step = unit === 'unit' ? 1 : rand(1, Math.max(2, target / 4));
      m.declared[code] = round(Math.min(current + step, target * 1.3), unit);
      bumped++;
    }
  }
  if (bumped) await declare(now);

  const away = members.filter((m) => m.where !== 'site').length;
  console.log(`${now.slice(11, 19)} ${members.length} positions — ${members.length - away} sur chantier, ${away} en route — ${bumped} déclaration(s) mise(s) à jour`);
}

await tick();
console.log(`\n${declaredAtStart} tâches déjà déclarées pour aujourd'hui (${Math.round(dayFraction * 100)} % de la journée écoulée).`);
console.log(`Sharing for ${members.length} employees. Leave this running during the demo; Ctrl-C to pause, --stop to end the day.`);
setInterval(() => tick().catch((e) => console.error(e)), TICK_MS);

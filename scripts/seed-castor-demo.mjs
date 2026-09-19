#!/usr/bin/env node
// Seeds a demo company for Castor Ingénierie from the two files the chef gave us:
//   - CASTOR_Etat_nominatif_plombiers_frigoristes_Aout2026.pdf  → workers, August sites
//   - Planning_suivi_S37_07-12092026.xlsx                        → S37 teams, sites, tasks
//
// Writes: 1 company, 1 chef, employees (auth users + profiles), sites, and the
// published S37 planning. Names only — CIN, CNSS, hourly rates and payment
// mode from the PDF are deliberately NOT imported (no field for them, and no
// reason for a demo to hold them).
//
// Usage:
//   node scripts/seed-castor-demo.mjs            # seed (refuses if the company exists)
//   node scripts/seed-castor-demo.mjs --dry-run  # print what would be created
//   node scripts/seed-castor-demo.mjs --wipe     # delete the company and its auth users
//
// Needs in .env / .env.local:
//   EXPO_PUBLIC_SUPABASE_URL      (the target project)
//   SUPABASE_SERVICE_ROLE_KEY     (Supabase → Settings → API; never EXPO_PUBLIC_)

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
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

const DRY_RUN = process.argv.includes('--dry-run');
const WIPE = process.argv.includes('--wipe');
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ---------------------------------------------------------------------------
// Data from the files
// ---------------------------------------------------------------------------
const COMPANY_NAME = 'Castor Ingénierie';
const CHEF = {
  email: 'chef.castor@casprod.app',
  firstName: 'Direction',
  lastName: 'Castor Ingénierie',
};

// Sites. The files only name the chantiers (no street address), so the address
// says so and the pin sits in the right city/district, not the exact plot.
// LBV = Label'Vie stores, as written in the file.
const SITES = [
  { key: 'PORSCHE',      name: 'Maison Porsche',        city: 'Casablanca', lat: 33.5883, lng: -7.6320 },
  { key: 'HOTEL_CASA',   name: 'Hôtel Casablanca',      city: 'Casablanca', lat: 33.5950, lng: -7.6180 },
  { key: 'VILLA_FAIZA',  name: 'Villa Faiza',           city: 'Casablanca', lat: 33.5650, lng: -7.6400 },
  { key: 'KSORA',        name: 'Kssora Immo — Hôtel Ksora', city: 'Casablanca', lat: 33.6000, lng: -7.6350 },
  { key: 'GHIZLAN',      name: 'Villa Ghizlan Sentisi', city: 'Casablanca', lat: 33.5550, lng: -7.6600 },
  { key: 'YACOUBI',      name: 'Villa Yacoubi',         city: 'Casablanca', lat: 33.5450, lng: -7.6500 },
  { key: 'ASTON',        name: 'Aston Martin',          city: 'Casablanca', lat: 33.5800, lng: -7.5700 },
  { key: 'MARRIOTT',     name: 'Hôtel Marriott',        city: 'Casablanca', lat: 33.5830, lng: -7.5750 },
  { key: 'LBV_MEKNES',   name: 'LBV Meknès',            city: 'Meknès',     lat: 33.8935, lng: -5.5473 },
  { key: 'BAHIA',        name: 'Villa Bahia — Bahia Beach', city: 'Bouznika', lat: 33.7890, lng: -7.1590 },
  // August-only chantiers from the état nominatif
  { key: 'LBV_AOUAMA',   name: 'LBV Aouama',            city: 'Tanger',     lat: 35.7280, lng: -5.8790 },
  { key: 'SKODA_SALE',   name: 'Maison Skoda Salé',     city: 'Salé',       lat: 34.0531, lng: -6.7985 },
  { key: 'SARA_CERAME',  name: 'Sara Cerame',           city: 'Casablanca', lat: 33.5400, lng: -7.5900 },
  { key: 'LBV_TIT',      name: 'LBV Tit Mellil',        city: 'Tit Mellil', lat: 33.5539, lng: -7.4823 },
  { key: 'AUDI',         name: 'Maison Audi',           city: 'Casablanca', lat: 33.5900, lng: -7.6000 },
  { key: 'VILLA_ABID',   name: 'Villa Abid',            city: 'Casablanca', lat: 33.5700, lng: -7.6100 },
];

// Workers from the état nominatif (28 + 5 "pointés sans fiche"). The PDF's
// NOM/PRÉNOM order is inconsistent row to row; first/last below follow the
// given name, cross-checked against the S37 planning and August site history.
// `key` is how the planning refers to the person.
const NAMED_WORKERS = [
  // Frigoristes
  { key: 'MANSOUF',     first: 'Khalid',      last: 'Mansouf',      trade: 'frigoriste' },
  { key: 'ZAKI',        first: 'Zaki',        last: 'Hamza',        trade: 'frigoriste' },
  { key: 'HAMZA_ELF',   first: 'Hamza',       last: 'Elfatihi',     trade: 'frigoriste' },
  { key: 'ARMEL',       first: 'Armel',       last: 'Nkouka',       trade: 'frigoriste' },
  { key: 'OTMAN_HAY',   first: 'Othmane',     last: 'Hayouti',      trade: 'frigoriste' },
  // Plombiers
  { key: 'ABDERAHIM',   first: 'Abderrahim',  last: 'Achaanoune',   trade: 'plombier' },
  { key: 'MILOUD_ELA',  first: 'Miloud',      last: 'Elattary',     trade: 'plombier' },
  { key: 'CHERKAOUI',   first: 'Younes',      last: 'Cherkaoui',    trade: 'plombier' },
  { key: 'YASSINE_CH',  first: 'Yassine',     last: 'Chahid',       trade: 'plombier' },
  { key: 'OUSSAMA',     first: 'Osama',       last: 'El-Mir',       trade: 'plombier' },
  { key: 'ELMIR_MOH',   first: 'Mohamed',     last: 'Elmir',        trade: 'plombier' },
  { key: 'ABDELHAK',    first: 'Abdelhaq',    last: 'Elkhadiri',    trade: 'plombier' },
  { key: 'AYOUB_CH',    first: 'Ayoub',       last: 'Chergaoui',    trade: 'plombier' },
  { key: 'ABDELMOGHIT', first: 'Abdelmoghit', last: 'Elmir',        trade: 'plombier' },
  { key: 'TAOUFIK',     first: 'Taoufik',     last: 'Elmir',        trade: 'plombier' },
  { key: 'ABANAIM',     first: 'Smail',       last: 'Abanaaim',     trade: 'plombier' },
  { key: 'BELYCH_Y',    first: 'Youness',     last: 'Belych',       trade: 'plombier' },
  { key: 'ALI',         first: 'Ali',         last: 'Khadir',       trade: 'plombier' },
  { key: 'BELYCH_A',    first: 'Abdessamad',  last: 'Belych',       trade: 'plombier' },
  { key: 'TARIK',       first: 'Tarik',       last: 'El Mekhrami',  trade: 'plombier' },
  { key: 'NABIL',       first: 'Nabil',       last: 'Zerraf',       trade: 'plombier' },
  { key: 'YOUSSEF_ELB', first: 'Youssef',     last: 'El-Bdioui',    trade: 'plombier' },
  { key: 'DRISS',       first: 'Driss',       last: 'Tla',          trade: 'plombier' },
  { key: 'YASSINE_Z',   first: 'Yassine',     last: 'Zouhair',      trade: 'plombier' },
  { key: 'RACHID',      first: 'Rachid',      last: 'Serhani',      trade: 'plombier' },
  { key: 'AMIR',        first: 'Hicham',      last: 'Amir',         trade: 'plombier' },
  { key: 'OMAR',        first: 'Omar',        last: 'Kakih',        trade: 'plombier' },
  { key: 'HICHAM_DAOU', first: 'Hicham',      last: 'Daou',         trade: 'plombier' },
  // Pointés sans fiche au fichier du personnel
  { key: 'MILOUD_ELK',  first: 'Miloud',      last: 'El Kardouhi',  trade: 'à déclarer' },
  { key: 'BOUABID',     first: 'Bouabid',     last: 'Hadmaoui',     trade: 'à déclarer' },
  { key: 'ANAS_ELF',    first: 'Anass',       last: 'El Ferkaty',   trade: 'à déclarer' },
  { key: 'ANAS_BAKHA',  first: 'Anas',        last: 'Bakha',        trade: 'à déclarer' },
  { key: 'AYOUB_BOU',   first: 'Ayoub',       last: 'Bouhadi',      trade: 'à déclarer' },
];

// People who appear in the S37 planning but not in the plombiers/frigoristes
// list (other trades, or simply not on file). First name only.
const PLANNING_ONLY_WORKERS = [
  'Oussama', 'Abdelkarim', 'Mourad', 'Mansour', 'Brahim', 'Mohamed', 'Abdessamad', 'Marwane', 'Kiki',
  'Samir', 'Dhina', 'Youssef', 'Chtaib', 'Chedmi', 'Montasir', 'Lmidi', 'Zakaria', 'Bahnini',
  'Yakin', 'Said', 'Mounim', 'Otman', 'Karim', 'Hamza', 'Abderahman',
].map((first) => ({ key: `P_${first.toUpperCase()}`, first, last: '', trade: 'à déclarer' }));

const ALL_WORKERS = [...NAMED_WORKERS, ...PLANNING_ONLY_WORKERS];

// Planning S37 — one row per équipe, exactly as in the sheet (LUN→SAM all X).
// Team members reference worker keys; matching to the nominative list follows
// the August site history in the PDF.
const S37 = { from: '2026-09-07', days: 6, start: '08:00', end: '17:00' };
const PLANNING_ROWS = [
  { site: 'PORSCHE', team: ['P_OUSSAMA', 'HICHAM_DAOU', 'HAMZA_ELF'],
    task: 'Passage cuivre splits gainables (Q6) double hauteur ; passage et pose flexible isolé Ø250, 60 ml ; fabrication boîtes de soufflage (Q18) ; raccordement gainables DRV frigorifique et électrique (Q11).' },
  { site: 'PORSCHE', team: ['YASSINE_CH', 'P_ABDELKARIM'],
    task: 'Passage réseau RIA RDC (Q2), filetage et pose tube 21 ml ; réseau RIA RDC vers étage, filetage et pose 24 ml ; raccordement condensats gainables DRV (Q11) et splits gainables (Q6).' },
  { site: 'HOTEL_CASA', team: ['AYOUB_CH', 'P_MOURAD'],
    task: 'Pose gaine double peau extérieure buanderie, 24 ml.' },
  { site: 'VILLA_FAIZA', team: ['ABDELHAK'],
    task: 'Passage polyéthylène Ø32, tranchée et pose tube 10 ml ; pose niche compteur et raccordement ; pose 3 éviers et raccordement ; pose robinets équerre 1/2"×3/8" (Q22) ; pose siphons de sol 150×150 (Q4) ; mise sous pression du chauffage par le sol refait.' },
  { site: 'KSORA', team: ['MILOUD_ELK', 'P_MANSOUR'],
    task: 'Passage PVC gaines 4e étage (Q6) ; pose culottes en attente et raccordement PVC EP, 24 ml ; pose bâti-supports et raccordement EU + alimentation WC et douche, 12 u.' },
  { site: 'KSORA', team: ['YOUSSEF_ELB', 'P_BRAHIM'],
    task: 'Passage PPR alimentation couloir 2e étage, 100 ml.' },
  { site: 'KSORA', team: ['NABIL', 'ANAS_ELF'],
    task: 'Passage PVC Ø40 et Ø50 lavabos et douches, sanitaires chambres 4e étage (Q15), 70 ml.' },
  { site: 'KSORA', team: ['RACHID', 'P_MOHAMED'],
    task: 'Passage VMC 4e étage, 40 ml ; calfeutrement soigné de la modification chauffe-eau, 21 chambres 1er étage.' },
  { site: 'KSORA', team: ['DRISS'],
    task: 'Passage VMC au niveau des gaines (Q7), 72 ml en Ø200/Ø160/Ø125, piquages compris.' },
  { site: 'KSORA', team: ['P_ABDESSAMAD', 'P_MARWANE'],
    task: 'Passage flexible isolé Ø200 soufflage et reprise, 1er étage, 21 chambres, 220 ml.' },
  { site: 'GHIZLAN', team: ['OMAR', 'P_KIKI', 'P_SAMIR'],
    task: "Nettoyage filtres pompe à chaleur eau glacée ; vérification et nettoyage des filtres à tamis et de soufflage des ventilo-convecteurs ; changement de la résistance du ballon d'eau chaude solaire, vérification ECS ; démarrage et essais d'une chaudière électrique pour SPA." },
  { site: 'YACOUBI', team: ['OTMAN_HAY', 'P_DHINA'],
    task: "Prolongement tube cuivre DRV du RDC jusqu'au sous-sol ; tirage câbles d'alimentation et câblage des unités intérieures DRV R+1, R+2 et RDC ; déplacement unité intérieure cuisine ; terminer tube VMC extraction avec flexibles 1er étage et RDC." },
  { site: 'YACOUBI', team: ['ABANAIM', 'P_YOUSSEF'],
    task: 'Pose et finitions préinstallation baignoire SDB parentale ; mise sous pression colonnes montantes PPR chauffage et EF/EC ; pose et raccordement bâti-supports WC et bidet RDC.' },
  { site: 'ASTON', team: ['AMIR', 'P_CHTAIB'],
    task: 'Pose et complément cuivre pour alimentation des unités extérieures ; déplacement de 3 unités extérieures, raccordement au niveau terrasse compris.' },
  { site: 'ASTON', team: ['ZAKI', 'P_CHEDMI'],
    task: "Déplacement des caissons d'extraction, d'air neuf et de désenfumage, prolongement des gaines et raccordement ; tirage câbles et câblage unités intérieures DRV ; pose et raccordement tubes électriques climatisation." },
  { site: 'MARRIOTT', team: ['BELYCH_A', 'P_MONTASIR'],
    task: 'Préparation et pose supports tube carré Ø40 pour bâti-supports RDC côté zone Aston Martin, pose des bâti-supports comprise ; pose et complément chutes EV et EUS du vide sanitaire RDC au sous-sol.' },
  { site: 'MARRIOTT', team: ['TARIK', 'YASSINE_Z', 'P_LMIDI'],
    task: "Préparation et pose supports pour collecteur d'évacuation EP/EU/EUS au sous-sol Aston Martin (Ø160 et Ø125)." },
  { site: 'MARRIOTT', team: ['P_ZAKARIA', 'P_BAHNINI'],
    task: 'Pose et complément réseaux de condensats et évacuations vasques/douches, chambres 1er étage et RDC côté ZAID.' },
  { site: 'MARRIOTT', team: ['ALI', 'P_YAKIN'],
    task: 'Terminer réseaux sprinkler des têtes de chambres avec balcon côté piscine, 1er et 2e étages ; commencer la distribution du réseau sprinkler RDC côté accueil.' },
  { site: 'MARRIOTT', team: ['BELYCH_Y', 'P_SAID'],
    task: 'Pose et raccordement receveurs de douche : chambres restantes du 1er étage et ensemble des chambres du 2e étage, côté témoin.' },
  { site: 'MARRIOTT', team: ['P_MOUNIM', 'BOUABID'],
    task: 'Prolongement tubes noirs Ø4" pour alimenter le magasin n°5 ; pose et soudure vannes papillon Ø4" 1er étage côté ZAID et RDC accueil ; prolongement réseaux incendie pour armoires RIA RDC et 1er étage côté ZAID.' },
  { site: 'LBV_MEKNES', team: ['OUSSAMA', 'ABDERAHIM'],
    task: 'Pose collecteur tube PVC sous-sol ; raccordement des évacuations de la boucherie et du bloc sanitaire.' },
  { site: 'LBV_MEKNES', team: ['ARMEL', 'P_OTMAN'],
    task: "Raccordement cuivre de la cassette, pose du split en mezzanine et pose de l'unité extérieure." },
  { site: 'LBV_MEKNES', team: ['ABDELMOGHIT', 'P_KARIM', 'P_HAMZA'],
    task: 'Tirage câbles split, cassette et caisson ; pose condensats.' },
  { site: 'BAHIA', team: ['ELMIR_MOH'],
    task: 'Pose tubes PVC piscine, gargouilles et caniveaux de douche.' },
  { site: 'BAHIA', team: ['TAOUFIK', 'P_ABDERAHMAN'],
    task: 'Dépose et pose du support de bidet, calfeutrement de la tranchée PVC Ø110 ; carottages pour évacuations douches, WC et équipements.' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ascii = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function password(length = 8) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('');
}
function usernames(workers) {
  const taken = new Set();
  return workers.map((w) => {
    const base = (w.last === '' ? ascii(w.first) : `${ascii(w.first)}.${ascii(w.last)}`).slice(0, 18);
    let name = base.length >= 3 ? base : `${base}000`.slice(0, 3);
    let n = 2;
    while (taken.has(name)) name = `${base.slice(0, 16)}${n++}`;
    taken.add(name);
    return { ...w, username: name, password: password() };
  });
}
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const workers = usernames(ALL_WORKERS);
const byKey = Object.fromEntries(workers.map((w) => [w.key, w]));
for (const row of PLANNING_ROWS) for (const k of row.team) if (!byKey[k]) throw new Error(`Unknown worker key ${k}`);
const shiftCount = PLANNING_ROWS.reduce((n, r) => n + r.team.length, 0) * S37.days;

console.log(`Target: ${SUPABASE_URL ?? '(EXPO_PUBLIC_SUPABASE_URL missing)'}`);
console.log(`Company: ${COMPANY_NAME} — chef ${CHEF.email}`);
console.log(`Employees: ${workers.length} (${NAMED_WORKERS.length} from the état nominatif, ${PLANNING_ONLY_WORKERS.length} planning-only)`);
console.log(`Sites: ${SITES.length} — Planning S37: ${PLANNING_ROWS.length} équipes, ${shiftCount} shifts`);

if (DRY_RUN) {
  console.log('\nEmployees (username → name):');
  for (const w of workers) console.log(`  ${w.username.padEnd(20)} ${w.first} ${w.last}`);
  process.exit(0);
}
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('\nMissing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (put the key in .env.local).');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const fail = (step, error) => { console.error(`\n✖ ${step}:`, error.message ?? error); process.exit(1); };

const { data: existing, error: lookupError } = await admin.from('companies').select('id').eq('name', COMPANY_NAME).maybeSingle();
if (lookupError) fail('company lookup', lookupError);

if (WIPE) {
  if (!existing) { console.log('Nothing to wipe.'); process.exit(0); }
  const { data: profiles } = await admin.from('profiles').select('id').eq('company_id', existing.id);
  for (const p of profiles ?? []) {
    const { error } = await admin.auth.admin.deleteUser(p.id);
    if (error && !/not found/i.test(error.message)) fail(`delete auth user ${p.id}`, error);
  }
  const { error } = await admin.from('companies').delete().eq('id', existing.id);
  if (error) fail('delete company', error);
  console.log(`Wiped ${COMPANY_NAME}: ${profiles?.length ?? 0} users and the company (sites, planning cascade).`);
  process.exit(0);
}

if (existing) {
  console.error(`\n${COMPANY_NAME} already exists (${existing.id}). Run with --wipe first to recreate it.`);
  process.exit(1);
}

// Company
const { data: company, error: companyError } = await admin
  .from('companies').insert({ name: COMPANY_NAME, time_zone: 'Africa/Casablanca' }).select('id, join_code').single();
if (companyError) fail('create company', companyError);
console.log(`\n✔ company ${company.id} (join code ${company.join_code})`);

// Chef
const chefPassword = password(10);
const { data: chefUser, error: chefError } = await admin.auth.admin.createUser({
  email: CHEF.email, password: chefPassword, email_confirm: true,
});
if (chefError) fail('create chef auth user', chefError);
const { error: chefProfileError } = await admin.from('profiles').insert({
  id: chefUser.user.id, company_id: company.id, first_name: CHEF.firstName, last_name: CHEF.lastName, role: 'chef',
});
if (chefProfileError) fail('create chef profile', chefProfileError);
console.log(`✔ chef ${CHEF.email}`);

// Employees — same writes as the create-employee edge function.
const employeeIds = {};
for (const w of workers) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: `${w.username}@employee.local`, password: w.password, email_confirm: true,
  });
  if (error) fail(`create auth user ${w.username}`, error);
  const { error: profileError } = await admin.from('profiles').insert({
    id: created.user.id, company_id: company.id, first_name: w.first, last_name: w.last,
    role: 'employee', username: w.username, employee_password: w.password,
  });
  if (profileError) fail(`create profile ${w.username}`, profileError);
  employeeIds[w.key] = created.user.id;
}
console.log(`✔ ${workers.length} employees`);

// Sites
const siteIds = {};
for (const s of SITES) {
  const { data, error } = await admin.from('sites').insert({
    company_id: company.id, name: s.name,
    address: `${s.city} — adresse exacte à compléter`,
    latitude: s.lat, longitude: s.lng,
  }).select('id').single();
  if (error) fail(`create site ${s.name}`, error);
  siteIds[s.key] = data.id;
}
console.log(`✔ ${SITES.length} sites`);

// Planning S37, published (the phones would have received it on the Monday).
const shifts = [];
for (const row of PLANNING_ROWS) {
  for (const key of row.team) {
    for (let d = 0; d < S37.days; d++) {
      shifts.push({
        company_id: company.id, employee_id: employeeIds[key], site_id: siteIds[row.site],
        work_date: addDays(S37.from, d), start_time: S37.start, end_time: S37.end,
        note: row.task.slice(0, 300), created_by: chefUser.user.id,
        published_at: `${S37.from}T07:00:00Z`,
      });
    }
  }
}
const { error: shiftsError } = await admin.from('planned_shifts').insert(shifts);
if (shiftsError) fail('create planned shifts', shiftsError);
console.log(`✔ ${shifts.length} planned shifts (S37, ${S37.from} → ${addDays(S37.from, S37.days - 1)})`);

console.log('\n=== Chef login ===');
console.log(`email:    ${CHEF.email}`);
console.log(`password: ${chefPassword}`);
console.log(`join code: ${company.join_code}`);
console.log('\nEmployee usernames/passwords are visible to the chef in the app (Employés).');

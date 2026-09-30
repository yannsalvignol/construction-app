#!/usr/bin/env node
// Gives the demo chantiers a devis, so the dashboards have a real denominator.
//
// The app shows an avancement only for a chantier whose devis has been
// imported and validated — placeholder percentages were deleted on purpose.
// Without this step the demo company looks like seventeen chantiers nobody
// has ever quoted, which is not what it is meant to demonstrate.
//
// The devis are written straight into the tables rather than through the
// parser: seeding should not spend money on an API, and what is being
// demonstrated is the avancement, not the reading.
//
// Usage:
//   node scripts/seed-quotes.mjs            # most chantiers, a few left empty
//   node scripts/seed-quotes.mjs --all       # every chantier, no empty ones
//   node scripts/seed-quotes.mjs --company="Autre SARL"
//   node scripts/seed-quotes.mjs --wipe
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
const COMPANY = flag('company', 'Castor Ingénierie');
const WIPE = args.includes('--wipe');
/** Every chantier gets one, including those normally left without. */
const ALL = args.includes('--all');

/** Chantiers without a devis, so the empty state is demonstrated too. */
const WITHOUT_QUOTE = 0.2;

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (put the key in .env.local).');
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const fail = (step, error) => { console.error(`✖ ${step}:`, error.message ?? error); process.exit(1); };

/** Stable pseudo-random in [0,1) from a string: a rerun writes the same devis. */
function rand(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/** A believable quantity and price for a line, by unit. */
function figuresFor(unit, seed) {
  const r = rand(seed);
  switch (unit) {
    case 'm': return { quantity: Math.round(20 + r * 280), price: Math.round(60 + r * 240) };
    case 'm2': return { quantity: Math.round(10 + r * 140), price: Math.round(120 + r * 380) };
    case 'm3': return { quantity: Math.round(2 + r * 40), price: Math.round(400 + r * 900) };
    case 'kg': return { quantity: Math.round(50 + r * 900), price: Math.round(12 + r * 20) };
    default: return { quantity: 1 + Math.floor(r * 12), price: Math.round(800 + r * 9000) };
  }
}

const LOTS = ['PLOMBERIE-SANITAIRE', 'CLIMATISATION - VENTILATION', 'CHAUFFAGE', 'ELECTRICITE'];

const { data: company, error: companyError } = await admin
  .from('companies').select('id, name').eq('name', COMPANY).maybeSingle();
if (companyError) fail('company lookup', companyError);
if (!company) fail('company lookup', new Error(`No company named "${COMPANY}". Run seed-castor-demo.mjs first.`));

if (WIPE) {
  const { data: quotes, error } = await admin.from('site_quotes').select('id').eq('company_id', company.id);
  if (error) fail('read quotes', error);
  const ids = (quotes ?? []).map((q) => q.id);
  if (ids.length) {
    await admin.from('task_declarations').update({ quote_line_id: null }).in('quote_line_id',
      ((await admin.from('quote_lines').select('id').in('quote_id', ids)).data ?? []).map((l) => l.id));
    const { error: deleteError } = await admin.from('site_quotes').delete().in('id', ids);
    if (deleteError) fail('delete quotes', deleteError);
  }
  console.log(`Wiped ${ids.length} devis.`);
  process.exit(0);
}

const { data: sites, error: sitesError } = await admin
  .from('sites').select('id, name').eq('company_id', company.id).eq('is_active', true).order('name');
if (sitesError) fail('sites', sitesError);

const { data: codes, error: codesError } = await admin
  .from('task_codes').select('code, unit, label_fr, category_code').eq('is_active', true);
if (codesError) fail('task codes', codesError);

const { data: existing } = await admin
  .from('site_quotes').select('site_id').eq('company_id', company.id);
const already = new Set((existing ?? []).map((q) => q.site_id));

let created = 0;
let declared = 0;

for (const site of sites) {
  if (already.has(site.id)) continue;
  if (!ALL && rand(`skip:${site.id}`) < WITHOUT_QUOTE) continue;

  // 12 to 30 lines under two or three lots, which is the size of a real
  // villa devis and enough to make an avancement bar mean something.
  const lineCount = 12 + Math.floor(rand(`count:${site.id}`) * 19);
  const lotCount = 2 + Math.floor(rand(`lots:${site.id}`) * 2);
  const lots = LOTS.slice(0, lotCount);

  const lines = [];
  let position = 0;
  for (const lot of lots) {
    lines.push({ position: position++, lot: `LOT: ${lot}`, label: `LOT: ${lot}`, kind: 'heading' });
    const perLot = Math.max(3, Math.round(lineCount / lotCount));
    for (let i = 0; i < perLot; i++) {
      const pool = codes.filter((c) => c.category_code === (lot.startsWith('ELEC') ? 'electrical' : 'plumbing_hvac'));
      if (!pool.length) continue;
      const code = pool[Math.floor(rand(`code:${site.id}:${lot}:${i}`) * pool.length) % pool.length];
      const { quantity, price } = figuresFor(code.unit, `fig:${site.id}:${lot}:${i}`);
      lines.push({
        position: position++,
        lot: `LOT: ${lot}`,
        label: `${i + 1}- ${(code.label_fr ?? code.code).toUpperCase()}`,
        candidate_label: `${i + 1}- ${(code.label_fr ?? code.code).toUpperCase()}`,
        kind: 'work',
        source_unit: code.unit === 'm' ? 'ML' : code.unit === 'unit' ? 'P' : code.unit.toUpperCase(),
        unit: code.unit,
        quantity,
        unit_price: price,
        amount_ht: quantity * price,
        task_code: code.code,
      });
    }
  }

  const total = lines.reduce((sum, line) => sum + (line.amount_ht ?? 0), 0);

  const { data: quote, error: quoteError } = await admin
    .from('site_quotes')
    .insert({
      company_id: company.id,
      site_id: site.id,
      uploaded_by: (await admin.from('profiles').select('id').eq('company_id', company.id).eq('role', 'chef').limit(1).single()).data.id,
      // No bytes behind this path: the devis is seeded, not imported. Opening
      // the file will fail, which is the one thing this demo cannot fake.
      file_path: `${company.id}/${site.id}/demo-devis.pdf`,
      file_name: `Devis ${site.name}.pdf`,
      mime_type: 'application/pdf',
      size_bytes: 120_000,
      status: 'validated',
      parsed_at: new Date().toISOString(),
      total_ht: total,
      currency: 'MAD',
    })
    .select('id')
    .single();
  if (quoteError) fail(`quote for ${site.name}`, quoteError);

  const { data: inserted, error: linesError } = await admin
    .from('quote_lines')
    .insert(lines.map((line) => ({ ...line, quote_id: quote.id, company_id: company.id })))
    .select('id, quantity, kind');
  if (linesError) fail(`lines for ${site.name}`, linesError);

  await admin.from('quote_milestones').insert([
    { quote_id: quote.id, company_id: company.id, position: 0, label: 'ACOMPTE DE 40%', percent: 40, is_retention: false },
    { quote_id: quote.id, company_id: company.id, position: 1, label: '30% A la livraison du matériel', percent: 30, is_retention: false },
    { quote_id: quote.id, company_id: company.id, position: 2, label: '20% A la fin des travaux selon métré réalisé', percent: 20, is_retention: false },
    { quote_id: quote.id, company_id: company.id, position: 3, label: '10% RG à restituer après une année de garantie', percent: 10, is_retention: true },
  ]);

  // Declare part of the devis against real work days, so the avancement is
  // computed from the same path the app uses rather than written by hand.
  const { data: days } = await admin
    .from('work_days')
    .select('id, employee_id, company_id, site_id')
    .eq('site_id', site.id)
    .limit(40);

  if (days?.length) {
    const share = rand(`share:${site.id}`); // 0 to 1 of the devis done
    const work = (inserted ?? []).filter((line) => line.kind === 'work' && line.quantity);
    const rows = [];
    const used = new Set();
    for (const [index, line] of work.entries()) {
      if (rand(`done:${line.id}`) > share) continue;
      const day = days[index % days.length];
      const key = `${day.id}:${line.id}`;
      if (used.has(key)) continue;
      used.add(key);
      const fraction = 0.3 + rand(`frac:${line.id}`) * 0.7;
      rows.push({
        work_day_id: day.id,
        employee_id: day.employee_id,
        company_id: day.company_id,
        site_id: day.site_id,
        quote_line_id: line.id,
        quantity: Math.max(1, Math.round(Number(line.quantity) * fraction)),
      });
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from('task_declarations').insert(rows.slice(i, i + 500));
      if (error) fail('declarations', error);
    }
    declared += rows.length;
  }

  created++;
  process.stdout.write(`\rdevis ${created}`);
}

process.stdout.write('\n');
console.log(`✔ ${created} devis validés, ${declared} déclarations rattachées à leurs lignes.`);
if (!created) console.log('  (rien de nouveau — les chantiers ont déjà leur devis ; --wipe pour recommencer)');

#!/usr/bin/env node
// Which model can actually read a scanned devis.
//
//   OPENAI_API_KEY=sk-... node scripts/compare-quote-models.mjs \
//     "/Users/yann/Downloads/2026-09-18 10-33.pdf" gpt-4o gpt-5.6-luna gpt-5.6-terra gpt-5.6-sol
//
// The key is read from the environment and never printed. Nothing is written to
// the database: this calls OpenAI directly and scores the answer against the
// prices printed on page 1, transcribed by hand from the document.
//
// The metric is deliberately blunt. A devis is wrong in exactly one way that
// matters: a number that is not the number on the paper. So we count how many
// of the printed unit prices came back, and how many prices came back that are
// printed nowhere. A model that invents 58 885 fails, however fluent its
// labels.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , pdfPath, ...models] = process.argv;
const key = process.env.OPENAI_API_KEY;
if (!key) { console.error('Set OPENAI_API_KEY.'); process.exit(1); }
if (!pdfPath || !models.length) {
  console.error('Usage: compare-quote-models.mjs <devis.pdf> <model> [model...]');
  process.exit(1);
}

/** Page 1 of the Marriott devis, transcribed from the document itself. */
const TRUTH = [
  ['1.1.1', 'Cellule étanche interrupteur MT motorisée arrivée et départ', 2, 71610],
  ['1.1.2', 'Cellule étanche de comptage moyenne tension', 1, 167772],
  ['1.1.3', 'Cellule étanche protection générale par disjoncteur double sectionnement', 1, 276664],
  ['1.1.4', 'Cellule étanche de protection du transformateur', 1, 68426],
  ['1.2', 'Liaison moyenne tension entre cellule et transformateur', 1, 2823],
  ['1.3', 'Transformateur MT/BT puissance 800KVA-20kV/B2', 1, 210282],
  ['1.4', 'Relevage du facteur de puissance à vide 40kVAR', 1, 8570],
  ['1.5', 'Armoire ou coffret de comptage', 1, 567],
  ['1.6', 'Accessoires de sécurité', 1, 7672],
  ['1.7', 'Prises de terre et du neutre -circuit de Terre', 1, 2557],
  ['1.8', 'Relai de défaut de terre communiquant', 1, 38418],
  ['1.9', 'Eclairage et PC du poste', 1, 2557],
  ['1.10', 'Extracteur (Ventilation mécanique)', 1, 3864],
  ['1.11', 'Menuiserie métallique', 1, 32054],
  ['1.12', 'Coffret comptage statique', 1, 567],
  ['1.13', 'Armoire générale basse tension 1200 A 3P3D débrochable', 1, 64790],
  ['1.14', 'Poste asservi 2 voies (PA)', 1, 103095],
  ['1.15', 'Relais de terre communiquant', 1, 38646],
  ['2.1', 'Groupe moteur+alternateur 315kVA insonorisé posé en toiture', 1, 420566],
  ['1200', "Capot d'insonorisation", 1, 57629],
  ['2.3', 'Lot de pièces de rechange', 1, 19322],
  ['2.4', 'Armoire normal/secours', 1, 37510],
  ['2.5', 'Prise de terre du neutre', 1, 2613],
  ['3.1', 'Amélioration de la Prise de terre par des piquets de terre', 1, 2841],
  ['3.2', 'Prise de terre informatique', 1, 3864],
  ['3.3', 'Liaison équipotentielles - (Hors chambres et suites)', 7, 192],
  ['4.1', "Liaison entre le transformateur et l'AGBT en 4x4x240mm² U1000 RO2V", 15, 6228],
  ['4.2', "Liaison entre l'AGBT et le TGBT N en 4x4x240mm² U1000 RO2V", 40, 6228],
];
const TRUE_PRICES = new Set(TRUTH.map((row) => row[3]));

const SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: ['string', 'null'], description: "Le numéro imprimé: 1.1.1, 2.4, A…" },
          label: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit_price: { type: ['number', 'null'] },
        },
        required: ['number', 'label', 'quantity', 'unit_price'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
};

const SYSTEM = `Tu lis une page de devis du bâtiment, imprimée puis scannée.
Restitue CHAQUE ligne du tableau, dans l'ordre, avec son numéro imprimé exact, son libellé mot pour mot, sa quantité et son prix unitaire.
Les chiffres sont la raison d'être du document: relis chaque prix sur l'image, ne déduis jamais un prix d'une autre ligne, ne recopie jamais le prix de la ligne précédente.
Une ligne sans prix (un titre de section) garde quantity et unit_price à null.`;

/** 200 dpi: a six-figure price in a scanned table is not legible at less. */
function renderPage(pdf, page, dpi = 200) {
  const out = join(tmpdir(), `devis-p${page}-${dpi}.png`);
  if (!existsSync(out)) {
    execFileSync('python3', ['-c', `
import fitz
d = fitz.open(${JSON.stringify(pdf)})
d[${page - 1}].get_pixmap(dpi=${dpi}).save(${JSON.stringify(out)})
`]);
  }
  return readFileSync(out).toString('base64');
}

async function run(model, imageB64) {
  const started = Date.now();
  const body = {
    model,
    response_format: { type: 'json_schema', json_schema: { name: 'page', strict: true, schema: SCHEMA } },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Relève toutes les lignes de cette page.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageB64}`, detail: 'high' } },
        ],
      },
    ],
  };
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (!response.ok) {
    const detail = await response.text();
    return { model, error: detail.slice(0, 200), seconds };
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) return { model, error: 'no content', seconds };
  let lines;
  try { lines = JSON.parse(text).lines ?? []; }
  catch (e) { return { model, error: 'unparseable JSON: ' + e.message, seconds }; }

  const prices = lines.map((l) => l.unit_price).filter((p) => typeof p === 'number' && p > 0);
  const found = new Set(prices.filter((p) => TRUE_PRICES.has(p)));
  const invented = prices.filter((p) => !TRUE_PRICES.has(p));
  const numbers = new Set(lines.map((l) => (l.number ?? '').trim()).filter(Boolean));
  const numbersRight = TRUTH.filter(([n]) => numbers.has(n)).length;

  return {
    model,
    seconds,
    rows: lines.length,
    priceRecall: `${found.size}/${TRUE_PRICES.size}`,
    invented: invented.length,
    inventedSample: [...new Set(invented)].slice(0, 5),
    numbering: `${numbersRight}/${TRUTH.length}`,
    tokens: `${data.usage?.prompt_tokens ?? '?'} in / ${data.usage?.completion_tokens ?? '?'} out`,
  };
}

const image = renderPage(pdfPath, 1);
console.log(`Page 1 at 200 dpi, ${(image.length / 1e6).toFixed(1)} MB base64`);
console.log(`Ground truth: ${TRUTH.length} printed rows, ${TRUE_PRICES.size} distinct unit prices\n`);

const results = [];
for (const model of models) {
  process.stdout.write(`${model} … `);
  try { results.push(await run(model, image)); }
  catch (e) { results.push({ model, error: e.message }); }
  console.log('done');
}

console.log('\n' + '-'.repeat(96));
console.log(
  'model'.padEnd(20) + 'rows'.padEnd(7) + 'prices right'.padEnd(15) +
  'invented'.padEnd(10) + 'numbering'.padEnd(12) + 'time'.padEnd(8) + 'tokens'
);
console.log('-'.repeat(96));
for (const r of results) {
  if (r.error) { console.log(r.model.padEnd(20) + 'ERROR  ' + r.error); continue; }
  console.log(
    r.model.padEnd(20) + String(r.rows).padEnd(7) + r.priceRecall.padEnd(15) +
    String(r.invented).padEnd(10) + r.numbering.padEnd(12) + (r.seconds + 's').padEnd(8) + r.tokens
  );
  if (r.inventedSample.length) {
    console.log(''.padEnd(20) + 'prices printed nowhere: ' + r.inventedSample.join(', '));
  }
}
console.log('-'.repeat(96));

mkdirSync(join(tmpdir(), 'devis-compare'), { recursive: true });
const report = join(tmpdir(), 'devis-compare', 'results.json');
writeFileSync(report, JSON.stringify(results, null, 2));
console.log(`\nFull results: ${report}`);

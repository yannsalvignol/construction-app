import OpenAI from 'npm:openai@4.104.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Reads a devis into quote_lines (docs/DEVIS_AVANCEMENT.md).
//
// The model reads and proposes; the chef decides. Nothing written here is
// shown as progress until a chef has been through the review screen and the
// quote's status becomes 'validated' — extraction from a clean tabular PDF is
// close to solved, from a photograph of an annotated paper devis it is not,
// and a wrong quantity poisons every percentage derived from it.
//
// The work happens after the response is sent: a devis of a few pages takes
// tens of seconds, far longer than a chef should watch a spinner and longer
// than the client would wait. The app follows `site_quotes.status`.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** The units the app counts in; the devis speaks ML, P, E, M2. */
const UNITS = ['m', 'm2', 'm3', 'unit', 'kg'] as const;

const SCHEMA = {
  type: 'object',
  properties: {
    printed_line_count: {
      type: 'integer',
      description:
        "Combien de lignes imprimées cette page porte au total (travail, en-têtes de lot, remises), comptées sur le document avant d'être restituées. Compte, ne déduis pas de ta propre réponse.",
    },
    total_ht: {
      type: ['number', 'null'],
      description: 'Total HT as printed on the devis, or null if absent.',
    },
    currency: { type: 'string', description: 'ISO code, e.g. MAD or EUR.' },
    milestones: {
      type: 'array',
      description:
        "The payment schedule printed on the devis (acompte, à la livraison, à la fin des travaux, retenue de garantie). Empty if the document states none.",
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: 'The condition as printed, verbatim: "A la livraison du matériel".',
          },
          percent: {
            type: ['number', 'null'],
            description: 'Percentage of the total, when expressed as one.',
          },
          amount_ht: {
            type: ['number', 'null'],
            description: 'A fixed amount, when the devis names one instead of a percentage.',
          },
          is_retention: {
            type: 'boolean',
            description:
              'True for a retenue de garantie or similar holdback released after a warranty period, which is not payment for work done.',
          },
        },
        required: ['label', 'percent', 'amount_ht', 'is_retention'],
        additionalProperties: false,
      },
    },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lot: {
            type: ['string', 'null'],
            description:
              "Le titre de la section où la ligne est imprimée, EN ENTIER: numéro ET intitulé, tel qu'imprimé — \"A Courant fort\", \"LOT N° 10 : COURANT FORT COURANT FAIBLE\". Jamais la seule lettre ou le seul numéro: \"A\" tout court ne dit rien à personne. Si la section n'a pas d'intitulé imprimé, null.",
          },
          label: {
            type: 'string',
            description:
              "The line's wording exactly as printed, including its number or letter. Never translated or rewritten.",
          },
          kind: {
            type: 'string',
            enum: ['work', 'heading', 'discount'],
            description:
              'heading: a numbered title with no quantity of its own. discount: a negative line such as REMISE COMMERCIALE. work: everything that is actual work or supply.',
          },
          source_unit: {
            type: ['string', 'null'],
            description: 'The unit as printed: ML, M2, P, E, U…',
          },
          unit: {
            type: ['string', 'null'],
            enum: [...UNITS, null],
            description:
              'source_unit mapped to ours: ML->m, M2->m2, M3->m3, P and E and U->unit, KG->kg. Null on a heading.',
          },
          quantity: { type: ['number', 'null'] },
          unit_price: { type: ['number', 'null'] },
          amount_ht: { type: ['number', 'null'] },
          task_code: {
            type: ['string', 'null'],
            description:
              'A code from the catalogue provided, when the line plainly matches one. Null when unsure — a wrong code is worse than none, because it makes a false progress figure.',
          },
        },
        required: ['lot', 'label', 'kind', 'source_unit', 'unit', 'quantity', 'unit_price', 'amount_ht', 'task_code'],
        additionalProperties: false,
      },
    },
  },
  required: ['printed_line_count', 'total_ht', 'currency', 'milestones', 'lines'],
  additionalProperties: false,
};

const SYSTEM = `Tu lis des devis du bâtiment (plomberie, CVC, électricité) au Maroc et en France.

Règles:
- Restitue CHAQUE ligne imprimée, dans l'ordre du document, sans en fusionner ni en inventer.
- Garde le libellé d'origine mot pour mot, numéro ou lettre compris ("3- RESEAUX FRIGORIFIQUES", "a- Ø250").
- Une ligne numérotée qui ne porte aucune quantité et qui chapeaute des sous-lignes est un "heading". Restitue-la comme ligne ET reporte son titre complet dans le "lot" des lignes qu'elle chapeaute.
- "lot" porte toujours l'intitulé, pas seulement le repère: "A Courant fort", jamais "A".
- Une remise, un rabais ou toute ligne négative est un "discount", jamais du travail.
- Reporte les quantités et les prix tels quels. N'arrondis pas, ne recalcule pas, ne corrige pas une incohérence: elle appartient au document.
- task_code: uniquement si la correspondance est évidente. Dans le doute, null.
- Les en-têtes et pieds de page répétés (adresse, RC, ICE, pagination) ne sont pas des lignes.
- Les conditions de paiement (acompte, à la livraison, à la fin des travaux, retenue de garantie) vont dans "milestones", jamais dans les lignes, et gardent leur formulation d'origine.`;

const STEPS_SYSTEM = `Tu prépares le travail sur chantier (plomberie, CVC, électricité) à partir des lignes d'un devis déjà lu.

Pour chaque ligne, liste les opérations successives qu'un ouvrier exécute pour la réaliser, et qu'il peut déclarer faites une par une.

- Décompose par défaut. Presque toute ligne posée sur un chantier se décompose: "Pose radiateur" se fait en fixant puis en raccordant, et ces deux-là se cochent séparément sur le terrain.
- Une à trois étapes, trois au maximum. Deux est le cas courant.
- Une étape est une opération, pas une mesure: pas de quantité, pas de pourcentage, pas de "50% posé".
- Une étape doit être vérifiable sur place en regardant l'installation.
- Formule à l'infinitif, sans numérotation, en deux ou trois mots: "Fixer", "Câbler les asservissements", "Tester". Pas de phrase.
- N'invente rien que le libellé n'implique pas: reste sur les gestes que le métier impose pour cet ouvrage-là.
- Tableau vide dans deux cas seulement:
  - une fourniture seule, un matériel livré non posé, une location — rien n'est exécuté sur place;
  - un libellé qui ne dit pas ce qu'on y fait.
  Dans tous les autres cas, décompose: une ligne rendue vide est une ligne que personne ne pourra cocher.

Exemples.
"Poste asservi 2 voies (PA)" → ["Fixer", "Câbler les asservissements", "Tester"]
"Pose radiateur" → ["Fixer le radiateur", "Raccorder les tubes"]
"5- POSE SIPHON DE SOL" → ["Sceller le siphon", "Raccorder l'évacuation"]
"Groupe moteur + alternateur 315 kVA insonorisé, posé en toiture" → ["Poser les plots anti-vibrations", "Mettre en place sur la dalle", "Raccorder puissance, commande et terre"]
"Fourniture de 12 ml de gaine spirale Ø125" → []`;

const STEPS_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: "L'index de la ligne, tel qu'il a été donné." },
          steps: { type: 'array', items: { type: 'string' } },
        },
        required: ['index', 'steps'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
} as const;

/**
 * The model that reads the devis.
 *
 * The cheap tier, on evidence rather than on principle. The flagship was the
 * safe assumption — a devis read wrong is a wrong price in a contract — but
 * measured against a ten-page scan whose page 1 was transcribed by hand, both
 * tiers returned all twenty-four printed unit prices and neither invented one.
 * Same answer, a fifth of the price: 1.3 dirhams a devis against 4.5.
 *
 * Measure again before trusting this on a document unlike that one. The reading
 * is where the money is, and the only reason to be on the cheap tier is that it
 * was shown to read as well, not that it is cheap.
 */
const READ_MODEL = Deno.env.get('PARSE_QUOTE_MODEL') || 'gpt-5.6-luna';
/**
 * Turning wording that has already been read into a list of operations is the
 * easy half, and never touches a number, so it runs on the cheap tier.
 */
const STEPS_MODEL = Deno.env.get('PARSE_STEPS_MODEL') || 'gpt-5.6-luna';


/**
 * How many times a short reading is asked again. Two: the first recovers the
 * usual shortfall, the second catches a devis long enough that the recovery
 * itself stopped short, and a third has never been the difference between a
 * usable devis and an unusable one.
 */
const MAX_RECOVERY_PASSES = 2;

/** Lines per steps request. Text only, so this is about the answer's size. */
const STEPS_BATCH = 30;
/** Steps batches at once. Text-only and on the cheap tier, so wider than the pages. */
const STEPS_CONCURRENCY = 6;
/**
 * After this, a parse still marked running is taken to be dead. One request now
 * reads the whole devis, so a healthy parse is minutes at worst, and a chef who
 * hit a failure should not be locked out of retrying for a quarter of an hour.
 */
const STALE_PARSE_MS = 5 * 60_000;

/** More than this is a method statement, not a line of a devis. */
const MAX_STEPS_PER_LINE = 3;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) return json({ error: 'Parsing is not configured' }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Validated with the service-role client: the caller's own token is checked
  // against auth, never used to widen what this function may read.
  const token = authHeader.replace('Bearer ', '');
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller.user) return json({ error: 'Not authenticated' }, 401);

  const { quoteId, only, background } = await req.json().catch(() => ({}));
  if (!quoteId) return json({ error: 'Missing quoteId' }, 400);

  const { data: profile } = await admin
    .from('profiles')
    .select('company_id, role')
    .eq('id', caller.user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'chef') return json({ error: 'Only a chef can import a devis' }, 403);

  const { data: quote } = await admin
    .from('site_quotes')
    .select('id, company_id, file_path, mime_type, status, parsing_started_at, parse_warning')
    .eq('id', quoteId)
    .maybeSingle();
  if (!quote || quote.company_id !== profile.company_id) return json({ error: 'Quote not found' }, 404);
  // Generating the operations on their own, and answering with what happened.
  // This one waits: the chef pressed a button and is watching, and the report
  // is the point — it goes back to him so Metro shows it line by line.
  if (only === 'steps') {
    const started = Date.now();
    const run = (async () => {
      const report = await generateSteps(admin, new OpenAI({ apiKey: openaiKey }), quote.id, quote.company_id);
      const note = stepsNote(report);
      // What the reading said is kept — "331 lignes sur 333" is still true and
      // still the chef's business — but what a previous operations pass said
      // is not: it is about this pass, and this pass has just answered. Left
      // in, a devis that failed once and succeeded twice still told the chef
      // its sub-tasks had not been generated.
      const kept = (quote.parse_warning ?? '')
        .split(' ; ')
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith(STEPS_NOTE_PREFIX))
        .join(' ; ');
      await admin
        .from('site_quotes')
        .update({ parse_warning: [kept, note].filter(Boolean).join(' ; ') || null })
        .eq('id', quote.id);
      console.log(`[parse-quote] steps ${quote.id}: ${JSON.stringify(report)}`);
      return { report, note };
    })();

    // Started by the reading: answer at once so that invocation can end, and
    // keep working in this one, which has a budget of its own.
    if (background) {
      // @ts-expect-error EdgeRuntime is provided by the Supabase runtime.
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(run);
      else await run;
      return json({ ok: true, status: 'steps' }, 202);
    }

    // Pressed by a chef who is watching: he gets the whole account of it.
    const { report, note } = await run;
    return json({ ok: report.inserted > 0, report, note, model: STEPS_MODEL, seconds: (Date.now() - started) / 1000 }, 200);
  }

  // A parse still plausibly running is protected; one older than this function
  // can live is abandoned, and refusing to restart it would strand the devis.
  if (quote.status === 'parsing') {
    const since = quote.parsing_started_at ? Date.now() - Date.parse(quote.parsing_started_at) : Infinity;
    if (since < STALE_PARSE_MS) return json({ ok: true, status: 'parsing' }, 200);
  }

  await admin.from('site_quotes')
    .update({ status: 'parsing', parse_error: null, parse_warning: null, parsing_started_at: new Date().toISOString() })
    .eq('id', quote.id);

  // Answer now; the parse continues on its own. The client watches the status.
  const work = parse(admin, openaiKey, quote, authHeader);
  // @ts-expect-error EdgeRuntime is provided by the Supabase runtime.
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work);
  else await work;

  return json({ ok: true, status: 'parsing' }, 202);
});

type Quote = { id: string; company_id: string; file_path: string; mime_type: string; parsing_started_at?: string | null; parse_warning?: string | null };

/** Supabase and OpenAI both reject with plain objects, which String() turns
 *  into "[object Object]" — the reason has to be dug out deliberately. */
function describe(failure: unknown): string {
  if (failure instanceof Error) return failure.message;
  if (failure && typeof failure === 'object') {
    const e = failure as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint, e.code && `(${e.code})`].filter(Boolean);
    if (parts.length) return parts.join(' — ');
    try { return JSON.stringify(failure); } catch { /* fall through */ }
  }
  return String(failure);
}

/** Chunked: spreading a multi-megabyte array into String.fromCharCode at once
 *  overflows the call stack. */
function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/** Runs the tasks a few at a time, keeping their results in order. */
async function pooled<T>(tasks: (() => Promise<T>)[], width: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, tasks.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= tasks.length) return;
        results[index] = await tasks[index]();
      }
    })
  );
  return results;
}

type StepsReport = {
  workLines: number;
  batches: number;
  answered: number;
  attached: number;
  inserted: number;
  failures: string[];
  sample: { label: string; steps: string[] }[];
  /** The first answer verbatim, kept only when none of it could be used. A
   *  count of what did not work says nothing about why. */
  rejected?: string;
};

/**
 * The operations each work line breaks down into, read from the lines as
 * stored rather than from the answer that produced them.
 *
 * Working off the database rather off the reading removes the one thing that
 * broke this silently: the model was asked to echo back an index, and a model
 * that renumbers its answer lost every operation without a single error. Here
 * each batch carries its own line ids, so an answer is matched by its place in
 * the batch and an echoed index is only a hint.
 *
 * Returns what happened rather than logging it: the caller may be a chef
 * pressing a button, and the terminal he is watching is his own.
 */
async function generateSteps(
  admin: ReturnType<typeof createClient>,
  openai: OpenAI,
  quoteId: string,
  companyId: string
): Promise<StepsReport> {
  const report: StepsReport = {
    workLines: 0, batches: 0, answered: 0, attached: 0, inserted: 0, failures: [], sample: [],
  };
  // Named so the caller can see the two rounds apart, and so a devis where the
  // second round changes nothing is recognisable from the log alone.

  const { data: rows, error: readError } = await admin
    .from('quote_lines')
    .select('id, label, kind, position')
    .eq('quote_id', quoteId)
    .eq('kind', 'work')
    .order('position');
  if (readError) { report.failures.push(`lecture des lignes: ${readError.message}`); return report; }

  const work = (rows ?? []) as { id: string; label: string }[];
  report.workLines = work.length;
  if (!work.length) return report;

  type Row = { id: string; label: string };
  const ask = async (lines: Row[], size: number) => {
    const batches: Row[][] = [];
    for (let from = 0; from < lines.length; from += size) batches.push(lines.slice(from, from + size));
    report.batches += batches.length;
    return pooled(
      batches.map((batch) => async () => {
        try {
          const response = await openai.chat.completions.create({
            model: STEPS_MODEL,
            max_completion_tokens: 8000,
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'etapes', strict: true, schema: STEPS_SCHEMA },
            },
            messages: [
              { role: 'system', content: STEPS_SYSTEM },
              {
                role: 'user',
                content:
                  `Décompose les ${batch.length} lignes ci-dessous. Une entrée par ligne, avec son index.\n\n` +
                  batch.map((line, i) => `${i}. ${line.label.slice(0, 300)}`).join('\n'),
              },
            ],
          });
          return { batch, response, error: '' };
        } catch (failure) {
          return { batch, response: null, error: describe(failure) };
        }
      }),
      STEPS_CONCURRENCY
    );
  };

  const steps: { quote_line_id: string; company_id: string; position: number; label: string }[] = [];
  const covered = new Set<string>();
  let answers = await ask(work, STEPS_BATCH);

  // A second round for whatever came back without operations. The model
  // answers for some of a batch and silently drops the rest — half the lines
  // of a three-hundred-line devis, in practice — and nothing in the reply
  // says which. Asked again in small batches, most of them answer: the first
  // round's omissions are a length problem, not a judgement that the line
  // needs no operations.
  for (let round = 0; round < 2; round++) {
  for (const { batch, response, error } of answers) {
    if (error) { report.failures.push(error.slice(0, 200)); continue; }
    if (!response) continue;
    const body = response.choices[0]?.message?.content;
    if (!body || response.choices[0]?.finish_reason === 'length') {
      report.failures.push(`réponse vide ou tronquée (${response.choices[0]?.finish_reason ?? 'sans contenu'})`);
      continue;
    }
    let proposed: { index: number; steps: string[] }[] = [];
    try {
      proposed = (JSON.parse(body) as { lines: { index: number; steps: string[] }[] }).lines ?? [];
    } catch (failure) { report.failures.push(`réponse illisible: ${describe(failure)}`); continue; }
    report.answered += proposed.length;
    if (!report.attached && !report.rejected) report.rejected = body.slice(0, 600);

    proposed.forEach((entry, order) => {
      // The index is a hint; the batch is indexed from zero for this reason, so
      // a model that renumbers lands on the same line anyway.
      const line = batch[entry.index] ?? batch[order];
      if (!line) return;
      const labels = (Array.isArray(entry.steps) ? entry.steps : [])
        .map((label) => String(label ?? '').trim().slice(0, 200))
        .filter((label) => label.length > 0)
        .slice(0, MAX_STEPS_PER_LINE);
      if (!labels.length) return;
      report.attached++;
      covered.add(line.id);
      if (report.sample.length < 3) report.sample.push({ label: line.label.slice(0, 70), steps: labels });
      report.rejected = undefined;
      labels.forEach((label, position) => {
        steps.push({ quote_line_id: line.id, company_id: companyId, position, label });
      });
    });
  }
    if (round === 1) break;
    const missed = work.filter((line) => !covered.has(line.id));
    if (!missed.length) break;
    // Ten at a time: the omissions are what a long answer loses at the end,
    // so a shorter answer is the fix rather than a sterner instruction.
    answers = await ask(missed, 10);
  }

  // Replaces whatever a previous run left, so pressing the button twice does
  // not stack two breakdowns on one line.
  const ids = work.map((line) => line.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await admin.from('quote_line_steps').delete().in('quote_line_id', ids.slice(i, i + 200));
    if (error) { report.failures.push(`suppression: ${error.message}`); break; }
  }
  for (let i = 0; i < steps.length; i += 500) {
    const { error } = await admin.from('quote_line_steps').insert(steps.slice(i, i + 500));
    if (error) { report.failures.push(`insertion: ${error.message}`); break; }
    report.inserted += steps.slice(i, i + 500).length;
  }
  return report;
}

/** Every note the operations pass writes starts with this, so the next pass
 *  can take back what the last one said without touching the reading's own
 *  warnings. */
const STEPS_NOTE_PREFIX = 'Sous-tâches';

/** What to tell the chef when a devis comes back with no operations. */
function stepsNote(r: StepsReport): string | null {
  if (r.inserted > 0) {
    return r.failures.length
      ? `${STEPS_NOTE_PREFIX} partiellement générées : ${r.failures[0].slice(0, 120)}`
      : null;
  }
  if (r.failures.length) return `${STEPS_NOTE_PREFIX} non générées : ${r.failures[0].slice(0, 160)}`;
  if (r.workLines === 0) return `${STEPS_NOTE_PREFIX} non générées : aucune ligne de travail dans ce devis.`;
  if (r.answered === 0) return `${STEPS_NOTE_PREFIX} non générées : ${r.workLines} ligne(s) envoyée(s), aucune réponse.`;
  return `${STEPS_NOTE_PREFIX} non générées : ${r.answered} réponse(s) reçue(s), aucune rattachée à une ligne.`;
}

async function parse(
  admin: ReturnType<typeof createClient>,
  openaiKey: string,
  quote: Quote,
  /** The caller's own token, to hand to the follow-up that breaks the lines
   *  down: it runs as him, under the same checks, in its own invocation. */
  authHeader: string
) {
  try {
    // Every page of the devis, in the order they were captured. A paper
    // devis photographed page by page is one quote, not several.
    const { data: pageRows } = await admin
      .from('quote_pages')
      .select('file_path, mime_type')
      .eq('quote_id', quote.id)
      .order('position');
    const pages = pageRows?.length
      ? pageRows
      : [{ file_path: quote.file_path, mime_type: quote.mime_type }];

    // The devis goes to OpenAI as a file, uploaded with its own bytes.
    //
    // It used to be read here first: pdf.js for a text layer, pdf-lib to cut it
    // into pages, and a hand-rolled base64 loop over every one of them. That is
    // twenty megabytes of string work in JavaScript, and this runtime allows two
    // seconds of CPU — the function was killed three seconds in, having spent
    // its whole budget before sending a single request. Waiting on OpenAI costs
    // no CPU at all; encoding the file ourselves cost all of it.
    //
    // So nothing is parsed, cut or encoded here. The bytes are streamed to the
    // Files API as multipart and referenced by id, and the model does the
    // reading — it handles a text layer and a scan alike, which is the other
    // reason the local inspection was not earning its keep.
    const fileIds: string[] = [];
    const images: { mime: string; base64: string }[] = [];

    for (const page of pages) {
      const { data: file, error: downloadError } = await admin.storage
        .from('site-quotes')
        .download(page.file_path);
      if (downloadError || !file) throw new Error(`Could not read the file: ${downloadError?.message}`);

      if (page.mime_type === 'application/pdf') {
        const form = new FormData();
        form.append('purpose', 'user_data');
        form.append('file', file, page.file_path.split('/').pop() || 'devis.pdf');
        const upload = await fetch('https://api.openai.com/v1/files', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openaiKey}` },
          body: form,
        });
        if (!upload.ok) {
          throw new Error(`Could not send the devis for reading: ${(await upload.text()).slice(0, 200)}`);
        }
        fileIds.push((await upload.json()).id as string);
      } else {
        // A photographed page is a phone picture, small enough that encoding it
        // is not what kills us, and image_url takes no file id.
        images.push({
          mime: page.mime_type || 'image/jpeg',
          base64: toBase64(new Uint8Array(await file.arrayBuffer())),
        });
      }
    }

    if (!fileIds.length && !images.length) {
      throw new Error('Ce devis ne contient aucune page lisible.');
    }

    // The catalogue travels with the request: the model can only suggest a
    // code it has been shown, which is what keeps suggestions mappable.
    const { data: codes } = await admin
      .from('task_codes')
      .select('code, unit, label_fr')
      .eq('is_active', true);
    const catalogue = (codes ?? []).map((c) => `${c.code} (${c.unit}) ${c.label_fr ?? ''}`.trim()).join('\n');

    const openai = new OpenAI({ apiKey: openaiKey });

    type Parsed = {
      printed_line_count?: number;
      total_ht: number | null;
      currency: string;
      milestones?: Record<string, unknown>[];
      lines: Record<string, unknown>[];
    };

    // One request for the whole devis. Splitting it existed only because gpt-4o
    // could not emit more than 16k tokens; these models allow 128k, which is a
    // three-hundred-line devis with room over. One request also means the model
    // sees the lot headings on the page they are printed on, so nothing has to
    // be carried across a seam afterwards.
    const response = await openai.chat.completions.create({
      model: READ_MODEL,
      max_completion_tokens: 100000,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'devis', strict: true, schema: SCHEMA },
      },
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `Catalogue de codes tâches disponibles:\n${catalogue}\n\n` +
                `Relève toutes les lignes de ce devis, dans l'ordre du document, page après page.`,
            },
            ...fileIds.map((id) => ({ type: 'file' as const, file: { file_id: id } })),
            ...images.map((image) => ({
              type: 'image_url' as const,
              image_url: { url: `data:${image.mime};base64,${image.base64}`, detail: 'high' as const },
            })),
          ] as never,
        },
      ],
    });

    const model = response.model ?? null;
    // Summed with the operations pass below, so the recorded cost is the devis.
    let inputTokens = response.usage?.prompt_tokens ?? 0;
    let outputTokens = response.usage?.completion_tokens ?? 0;
    if (response.choices[0]?.finish_reason === 'length') {
      throw new Error('Ce devis dépasse ce que le modèle peut rendre en une fois.');
    }
    const body = response.choices[0]?.message?.content;
    if (!body) throw new Error('The model returned no content');
    const parsed = JSON.parse(body) as Parsed;
    parsed.lines ??= [];

    const warnings: string[] = [];
    // Omission is a known failure of structured extraction: the line is printed
    // and simply absent from the answer, with nothing in the response saying so.
    // Models also stop short of a long list rather than refusing it — the same
    // devis has come back 327, 328 and 89 lines on identical input. So the devis
    // is asked to count its own lines, and a short answer is read again.
    //
    // Asking for what is missing rather than for the whole devis again: the
    // first answer's lines were not wrong, they were incomplete, and a second
    // full pass would be as likely to stop short as the first.
    //
    // The model's own count is the weaker of the two signals: a model that
    // stops short of a long list stops counting it too, and this devis came
    // back saying it had found all 160 of the 160 lines it claimed to see,
    // where the document has 295. The printed total is the signal that does
    // not come from the reading — the devis states 13 718 771 and the lines
    // summed to 8 732 268, which no amount of self-consistency can explain
    // away. Either shortfall asks again.
    const counted = typeof parsed.printed_line_count === 'number' ? parsed.printed_line_count : 0;
    const sumOf = (lines: Record<string, unknown>[]) => lines
      .filter((line) => (line.kind ?? 'work') === 'work')
      .reduce((total, line) => total + (Number(line.amount_ht) || 0), 0);
    const short = () => {
      if (parsed.lines.length < counted) return true;
      const sum = sumOf(parsed.lines);
      return !!parsed.total_ht && sum > 0 && sum / parsed.total_ht < 0.9;
    };
    for (let attempt = 0; attempt < MAX_RECOVERY_PASSES && short(); attempt++) {
      const have = parsed.lines.map((line) => String(line.label ?? '')).filter(Boolean);
      const before = parsed.lines.length;
      const extra = await openai.chat.completions.create({
        model: READ_MODEL,
        max_completion_tokens: 100000,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'devis', strict: true, schema: SCHEMA },
        },
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  `Catalogue de codes tâches disponibles:\n${catalogue}\n\n` +
                  (parsed.total_ht
                    ? `Le devis annonce un total de ${Math.round(parsed.total_ht)} et les lignes rendues n'en font que ${Math.round(sumOf(parsed.lines))} : il manque des lignes. `
                    : `Tu as compté ${counted} lignes dans ce devis et tu n'en as rendu que ${before}. `) +
                  `Voici les libellés déjà relevés, dans l'ordre :\n${have.join('\n')}\n\n` +
                  `Rends UNIQUEMENT les lignes du devis qui manquent dans cette liste, dans l'ordre du document. ` +
                  `Si rien ne manque, rends une liste vide.`,
              },
              ...fileIds.map((fid) => ({ type: 'file' as const, file: { file_id: fid } })),
              ...images.map((image) => ({
                type: 'image_url' as const,
                image_url: { url: `data:${image.mime};base64,${image.base64}`, detail: 'high' as const },
              })),
            ] as never,
          },
        ],
      });
      inputTokens += extra.usage?.prompt_tokens ?? 0;
      outputTokens += extra.usage?.completion_tokens ?? 0;
      const extraBody = extra.choices[0]?.message?.content;
      if (!extraBody || extra.choices[0]?.finish_reason === 'length') break;
      const recovered = (JSON.parse(extraBody) as Parsed).lines ?? [];
      // Appended rather than spliced into place: the order within the devis is
      // lost for the recovered lines, which is a smaller loss than losing them.
      parsed.lines.push(...recovered);
      // No progress means asking again will not help either.
      if (parsed.lines.length === before) break;
    }

    if (counted && parsed.lines.length < counted) {
      warnings.push(`${parsed.lines.length} ligne(s) relevée(s) sur ${counted} comptée(s)`);
    }

    // Replaces any earlier attempt rather than accumulating duplicates.
    await admin.from('quote_lines').delete().eq('quote_id', quote.id);

    const known = new Set((codes ?? []).map((c) => c.code));
    // A lettered child ("a- Pf : 14 kw") is meaningless alone; what names the
    // work is the heading above it. Carried so an unmatched line can be
    // recognised later as a candidate for the catalogue.
    let heading: string | null = null;
    const allowedUnits = new Set(UNITS);
    let droppedCodes = 0;

    const rows = parsed.lines.map((line, index) => {
      const label = String(line.label ?? '').slice(0, 500);
      if (line.kind === 'heading') heading = label;
      const isChild = /^\s*[a-z]\s*-/i.test(label);
      return {
        quote_id: quote.id,
        company_id: quote.company_id,
        position: index,
        lot: line.lot ?? null,
        label,
        candidate_label: isChild && heading ? heading : label,
        kind: line.kind ?? 'work',
        source_unit: line.source_unit ?? null,
        // Anything outside our five units is kept only as the printed text, so
        // a surprise unit shows up on the review screen instead of being lost.
        unit: allowedUnits.has(line.unit as never) ? line.unit : null,
        quantity: line.quantity ?? null,
        unit_price: line.unit_price ?? null,
        amount_ht: line.amount_ht ?? null,
        task_code: (() => {
          const code = line.task_code as string | null;
          if (!code) return null;
          if (known.has(code)) return code;
          // A code the catalogue does not have would fail the foreign key and
          // take the whole devis with it; the chef assigns it on review.
          droppedCodes++;
          return null;
        })(),
      };
    });

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from('quote_lines').insert(rows.slice(i, i + 500));
      if (error) throw error;
    }

    // Read back by position rather than trusting the order an insert returns:
    // position is ours, set from the index, so this pairing cannot drift.
    const { data: storedLines } = await admin
      .from('quote_lines')
      .select('id, position')
      .eq('quote_id', quote.id);
    const idByPosition = new Map<number, string>(
      (storedLines ?? []).map((row: { id: string; position: number }) => [row.position, row.id])
    );

    // The devis states its own total; ours is the sum of what was read. A gap is
    // not proof of an error — a devis has sub-totals, options and lines that are
    // headings — but a large one means the reading is not to be trusted, and the
    // chef should be told before he plans a chantier on it.
    const readTotal = rows
      .filter((row) => row.kind === 'work')
      .reduce((sum, row) => sum + (Number(row.amount_ht) || 0), 0);
    if (parsed.total_ht && readTotal > 0) {
      const ratio = readTotal / parsed.total_ht;
      if (ratio > 1.15 || ratio < 0.85) {
        warnings.push(
          `somme des lignes ${Math.round(readTotal).toLocaleString('fr-FR')} contre un total imprimé de ${Math.round(parsed.total_ht).toLocaleString('fr-FR')}`
        );
      }
    }

    await admin.from('quote_milestones').delete().eq('quote_id', quote.id);
    const milestones = (parsed.milestones ?? []).map((milestone, index) => ({
      quote_id: quote.id,
      company_id: quote.company_id,
      position: index,
      label: String(milestone.label ?? '').slice(0, 300),
      percent: milestone.percent ?? null,
      amount_ht: milestone.amount_ht ?? null,
      is_retention: milestone.is_retention === true,
    })).filter((milestone) => milestone.label.length > 0);
    if (milestones.length) {
      const { error: milestoneError } = await admin.from('quote_milestones').insert(milestones);
      if (milestoneError) console.error('[parse-quote] milestones', milestoneError.message);
    }

    // Unmatched wordings are counted so a family the catalogue lacks can be
    // offered to the chef once it has turned up in enough devis to be real.
    const { error: candidateError } = await admin.rpc('record_quote_candidates', { quote: quote.id });
    if (candidateError) console.error('[parse-quote] candidates', candidateError.message);

    await admin
      .from('site_quotes')
      .update({
        status: 'parsed',
        parsed_at: new Date().toISOString(),
        total_ht: parsed.total_ht,
        currency: parsed.currency || 'MAD',
        parse_error: null,
        parse_warning: warnings.length
          ? `Des lignes peuvent manquer. Vérifiez : ${warnings.join(' ; ')}.`
          : null,
        input_tokens: inputTokens || null,
        output_tokens: outputTokens || null,
        parse_model: model,
      })
      .eq('id', quote.id);

    // The operations go to a second invocation rather than running here.
    //
    // They used to run inline, after the status was set, so a devis survived
    // them being killed. It was not enough: a three-hundred-line devis that
    // needs two recovery reads leaves so little of the budget that the
    // operations pass got no further than starting, and came back with
    // nothing and no reason given. Two invocations means two budgets, and
    // reading a devis never has to compete with breaking it down.
    //
    // It runs as the caller, through the same handler and the same checks.
    const dispatched = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/parse-quote`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteId: quote.id, only: 'steps', background: true }),
    }).catch((failure) => ({ ok: false, status: 0, text: () => Promise.resolve(describe(failure)) }));
    if (!dispatched.ok) {
      const reason = await dispatched.text().catch(() => '');
      console.error(`[parse-quote] could not start the operations pass: ${dispatched.status} ${reason}`);
      await admin
        .from('site_quotes')
        .update({
          parse_warning: [...warnings, 'sous-tâches non lancées, utilisez le bouton sur la page du devis']
            .join(' ; ') || null,
        })
        .eq('id', quote.id);
    }
    console.log(
      `[parse-quote] ${quote.id}: ${rows.length} lines, ${milestones.length} milestones, total ${parsed.total_ht}` +
        `, ${inputTokens} in / ${outputTokens} out tokens` +
        (droppedCodes ? `, ${droppedCodes} unknown task codes dropped` : '')
    );
  } catch (failure) {
    const message = describe(failure);
    console.error('[parse-quote] failed', message);
    await admin
      .from('site_quotes')
      .update({ status: 'failed', parse_error: message.slice(0, 500) })
      .eq('id', quote.id);
  }
}

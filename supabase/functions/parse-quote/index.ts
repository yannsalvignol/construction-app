import OpenAI from 'npm:openai@4.104.0';
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1';
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
          number: {
            type: ['string', 'null'],
            description:
              "Le repère imprimé de la ligne, tel quel et sans rien d'autre: \"A\", \"1\", \"1.1\", \"1.1.1\", \"4.12\", \"3-\", \"a-\". La plupart des devis le portent dans une colonne N° à gauche; sur d'autres il ouvre le libellé. C'est lui qui dit à quel niveau la ligne se trouve, donc recopie-le exactement, sans le compléter ni le corriger. Null seulement si la ligne n'en porte aucun.",
          },
          lot: {
            type: ['string', 'null'],
            description:
              "La section de PLUS HAUT NIVEAU où la ligne est imprimée, en entier: numéro ET intitulé — \"A Courant fort\", \"LOT: CLIMATISATION - VENTILATION\". Jamais la seule lettre, jamais un titre de chapitre intermédiaire. Identique mot pour mot pour toutes les lignes de la section. Null si le devis n'a pas de sections.",
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
        required: ['number', 'lot', 'label', 'kind', 'source_unit', 'unit', 'quantity', 'unit_price', 'amount_ht', 'task_code'],
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
- Une ligne qui ne porte aucune quantité et qui chapeaute des sous-lignes est un "heading". Restitue-la comme ligne, à sa place dans le document.
- "lot" ne porte QUE la section de plus haut niveau — celle en laquelle le devis entier se divise: "LOT: CLIMATISATION - VENTILATION", "A Courant fort". Jamais un titre intermédiaire comme "1- UNITE EXTERIEURE DRV", même si la ligne est imprimée dessous: les niveaux intermédiaires se lisent à la position des headings, et un "lot" qui change à chaque chapitre ne divise plus rien.
- Un titre imprimé à l'identique en haut de CHAQUE page — "LOT N° 10 : COURANT FORT COURANT FAIBLE", "BORDEREAUX DE PRIX INITIAUX", le nom du projet — est le titre du document, PAS une section: il ne distingue rien, puisqu'il est partout. La section est ce qui change en descendant le devis. Quand un devis numérote ses sections par lettres (A, B, C...), ce sont elles les sections, et "lot" porte la lettre et son intitulé: "A Courant fort".
- Si la page que tu lis ne montre aucun titre de section, mets "lot" à null plutôt que de reprendre l'en-tête de page: une section manquante se retrouve, une fausse section ne se corrige pas.
- "lot" porte l'intitulé entier, pas seulement le repère: "A Courant fort", jamais "A". Toutes les lignes d'une même section portent exactement la même chaîne.
- Un devis a souvent une colonne de référence ou de code article ("Produit", "P_022920", "REF 1245"). Elle n'est pas le libellé: ne la colle jamais devant la désignation.
- Une remise, un rabais ou toute ligne négative est un "discount", jamais du travail.
- Un report, un sous-total, un total de lot ou un total général ("Total lot n°C", "Sous-total", "Report", "TOTAL HT") n'est PAS une ligne du devis: ne le restitue pas du tout. C'est la somme de lignes que tu as déjà rendues, et la rendre une fois de plus compterait le travail deux fois. Le total général va dans "total_ht", nulle part ailleurs.
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

/**
 * Pages of a scan read at once. Four: enough that ten pages are three rounds
 * rather than ten, few enough that a rate limit is not the next thing to go
 * wrong.
 */
const READ_CONCURRENCY = 4;

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

/**
 * Telling a devis that carries its own text from one that is a photograph of
 * a devis.
 *
 * Both arrive as a PDF and nothing in the extension says which. The
 * difference is worth finding: a born-digital devis hands over its figures
 * exactly, for nothing, and no model has to read 126 800 off a picture and
 * risk returning 126 000. A scan has no text to hand over and has to be read.
 *
 * Measured over the PDFs to hand, the two kinds do not overlap. Born-digital
 * runs 1 000 to 3 800 characters a page at about 8 bytes of file per
 * character; a scan gives nothing at all and weighs megabytes. The second
 * ratio is what catches the awkward middle case — a scan carrying an OCR
 * layer, which has text but pays hundreds of bytes a character for it, and
 * whose text is a guess rather than the document.
 */
const TEXT_CHARS_PER_PAGE = 300;
const TEXT_BYTES_PER_CHAR = 150;
/** Beyond this the probe is skipped: the CPU a parse costs is not worth
 *  spending on a file this size, which is a scan in all but name. */
const TEXT_PROBE_MAX_BYTES = 15_000_000;

/**
 * The devis's own text, when it has one worth trusting.
 *
 * Never throws: a probe that fails leaves the file to be read as a picture,
 * which is what happened to every devis before this existed.
 */
async function inspect(bytes: Uint8Array): Promise<{ pages: number; text: string | null }> {
  const layer = await textLayer(bytes);
  if (layer) return { pages: layer.pages, text: layer.text };
  // No usable text, but the page count is still worth having: it decides
  // whether the document is read whole or a page at a time.
  try {
    const pdf = await getDocumentProxy(bytes);
    return { pages: Math.max(1, pdf.numPages || 1), text: null };
  } catch { return { pages: 1, text: null }; }
}

async function textLayer(bytes: Uint8Array): Promise<{ text: string; pages: number } | null> {
  // A switch rather than a redeploy: if reading a devis ever goes wrong in a
  // way that looks like the probe, it can be taken out of the path in one
  // command and put back the same way.
  if (Deno.env.get('PARSE_TEXT_PROBE') === 'off') return null;
  if (bytes.byteLength > TEXT_PROBE_MAX_BYTES) return null;
  try {
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const body = String(text ?? '').trim();
    const pages = Math.max(1, totalPages || 1);
    if (body.length / pages < TEXT_CHARS_PER_PAGE) return null;
    if (bytes.byteLength / body.length > TEXT_BYTES_PER_CHAR) return null;
    return { text: body, pages };
  } catch (failure) {
    console.error(`[parse-quote] text probe failed, reading as a picture: ${describe(failure)}`);
    return null;
  }
}

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
  // Another reading, for the lines the last one missed. Its own invocation,
  // its own budget, started by the pass before it.
  if (only === 'recover') {
    const run = recover(admin, openaiKey, quote.id, authHeader).catch(async (failure) => {
      console.error(`[parse-quote] recovery failed: ${describe(failure)}`);
      // A failed recovery is not a failed devis: the lines from the first
      // reading are already stored and usable. Say so and move on.
      await admin
        .from('site_quotes')
        .update({ parse_warning: `Relecture interrompue : ${describe(failure).slice(0, 140)}` })
        .eq('id', quote.id);
      await handOn(admin, quote.id, authHeader, []);
    });
    // @ts-expect-error EdgeRuntime is provided by the Supabase runtime.
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(run);
    else await run;
    return json({ ok: true, status: 'recover' }, 202);
  }

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

/**
 * Whether the devis as stored still looks short of what the paper says.
 *
 * The printed total is the signal that does not come from the reading: a
 * model that stops short of a long list stops counting it too, and one devis
 * came back insisting it had found all 160 of the 160 lines it saw, where the
 * document holds 295. The total it cannot argue with — the lines summed to
 * two thirds of the figure printed at the foot of the page.
 */
async function stillShort(admin: ReturnType<typeof createClient>, quoteId: string) {
  const { data: quote } = await admin
    .from('site_quotes').select('total_ht, parse_passes').eq('id', quoteId).maybeSingle();
  if (!quote?.total_ht) return false;
  const { data: lines } = await admin
    .from('quote_lines').select('amount_ht, kind').eq('quote_id', quoteId).eq('kind', 'work');
  const sum = (lines ?? []).reduce((total, line) => total + (Number(line.amount_ht) || 0), 0);
  return sum > 0 && sum / Number(quote.total_ht) < 0.9;
}

/**
 * Starts whatever comes next, in an invocation of its own.
 *
 * Reading a ten-page scan is minutes of work and a reading that came back
 * short is read again; all of it used to happen in one invocation, which ran
 * past the time an invocation is allowed and was killed with nothing written.
 * One pass per invocation means each gets a whole budget, and the chef has a
 * usable devis from the first one.
 */
async function handOn(
  admin: ReturnType<typeof createClient>,
  quoteId: string,
  authHeader: string,
  warnings: string[]
) {
  const { data: quote } = await admin
    .from('site_quotes').select('parse_passes').eq('id', quoteId).maybeSingle();
  const passes = Number(quote?.parse_passes ?? 1);
  const again = passes <= MAX_RECOVERY_PASSES && (await stillShort(admin, quoteId));
  const next = again ? 'recover' : 'steps';

  const dispatched = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/parse-quote`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId, only: next, background: true }),
  }).catch((failure) => ({ ok: false, status: 0, text: () => Promise.resolve(describe(failure)) }));

  if (!dispatched.ok) {
    const reason = await dispatched.text().catch(() => '');
    console.error(`[parse-quote] could not start the ${next} pass: ${dispatched.status} ${reason}`);
    await admin
      .from('site_quotes')
      .update({
        parse_warning: [...warnings, `${next === 'recover' ? 'relecture' : 'sous-tâches'} non lancée, relancez depuis la page du devis`]
          .join(' ; ') || null,
      })
      .eq('id', quoteId);
    return;
  }
  console.log(`[parse-quote] ${quoteId}: handed on to the ${next} pass (${passes} reading(s) so far)`);
}

/**
 * Reads the devis again for the lines the last reading missed.
 *
 * Asking for what is missing rather than for the whole devis again: the first
 * answer's lines were not wrong, they were incomplete, and a second full pass
 * would be as likely to stop short as the first. The file is referenced by the
 * id OpenAI already holds, so nothing is uploaded twice.
 */
async function recover(
  admin: ReturnType<typeof createClient>,
  openaiKey: string,
  quoteId: string,
  authHeader: string
) {
  const startedAt = Date.now();
  const { data: quote } = await admin
    .from('site_quotes')
    .select('id, company_id, total_ht, parse_passes, parse_file_ids, input_tokens, output_tokens')
    .eq('id', quoteId)
    .single();

  const { data: stored } = await admin
    .from('quote_lines')
    .select('label, position')
    .eq('quote_id', quoteId)
    .order('position');
  const have = (stored ?? []).map((line) => String(line.label ?? '')).filter(Boolean);
  const nextPosition = ((stored ?? []).at(-1)?.position ?? -1) + 1;

  const { data: codes } = await admin
    .from('task_codes').select('code, unit, label_fr').eq('is_active', true);
  const catalogue = (codes ?? []).map((c) => `${c.code} (${c.unit}) ${c.label_fr ?? ''}`.trim()).join('\n');

  const { data: work } = await admin
    .from('quote_lines').select('amount_ht').eq('quote_id', quoteId).eq('kind', 'work');
  const sum = (work ?? []).reduce((total, line) => total + (Number(line.amount_ht) || 0), 0);

  const openai = new OpenAI({ apiKey: openaiKey });
  const extra = await openai.chat.completions.create({
    model: READ_MODEL,
    max_completion_tokens: 100000,
    response_format: { type: 'json_schema', json_schema: { name: 'devis', strict: true, schema: SCHEMA } },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `Catalogue de codes tâches disponibles:\n${catalogue}\n\n` +
              `Le devis annonce un total de ${Math.round(Number(quote.total_ht ?? 0))} et les lignes déjà relevées ` +
              `n'en font que ${Math.round(sum)} : il manque des lignes.\n\n` +
              `Voici les libellés déjà relevés, dans l'ordre :\n${have.join('\n').slice(0, 200_000)}\n\n` +
              `Rends UNIQUEMENT les lignes du devis qui manquent dans cette liste, dans l'ordre du document. ` +
              `Si rien ne manque, rends une liste vide.`,
          },
          ...((quote.parse_file_ids ?? []) as string[]).map((id) => ({
            type: 'file' as const, file: { file_id: id },
          })),
        ] as never,
      },
    ],
  });

  const body = extra.choices[0]?.message?.content;
  const found = body && extra.choices[0]?.finish_reason !== 'length'
    ? ((JSON.parse(body) as { lines?: Record<string, unknown>[] }).lines ?? [])
    : [];

  const known = new Set((codes ?? []).map((c) => c.code));
  const allowedUnits = new Set(UNITS);
  const rows = found.map((line, index) => {
    const label = String(line.label ?? '').slice(0, 500);
    const isChild = /^\s*[a-z]\s*-/i.test(label);
    return {
      quote_id: quoteId,
      company_id: quote.company_id,
      // Appended rather than spliced into place: where exactly a recovered
      // line sat is a guess, and a guess about order is worse than an order
      // that is plainly "found afterwards".
      position: nextPosition + index,
      lot: line.lot ?? null,
      marker: String(line.number ?? '').trim().replace(/[\s.:)\-]+$/, '') || null,
      label,
      candidate_label: label,
      kind: line.kind ?? 'work',
      source_unit: line.source_unit ?? null,
      unit: allowedUnits.has(line.unit as never) ? line.unit : null,
      quantity: line.quantity ?? null,
      unit_price: line.unit_price ?? null,
      amount_ht: line.amount_ht ?? null,
      task_code: known.has(line.task_code as string) ? (line.task_code as string) : null,
    };
  }).filter((row) => row.label.length > 0 && !have.includes(row.label));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('quote_lines').insert(rows.slice(i, i + 500));
    if (error) { console.error('[parse-quote] recover insert', error.message); break; }
  }

  await admin
    .from('site_quotes')
    .update({
      parse_passes: Number(quote.parse_passes ?? 1) + 1,
      input_tokens: Number(quote.input_tokens ?? 0) + (extra.usage?.prompt_tokens ?? 0),
      output_tokens: Number(quote.output_tokens ?? 0) + (extra.usage?.completion_tokens ?? 0),
    })
    .eq('id', quoteId);

  console.log(
    `[parse-quote] ${quoteId} recovery ${Number(quote.parse_passes ?? 1) + 1}:` +
      ` ${rows.length} line(s) found in ${Date.now() - startedAt}ms`
  );

  // No progress means asking again will not help either.
  if (!rows.length) {
    await admin.from('site_quotes').update({ parse_passes: 99 }).eq('id', quoteId);
  }
  const { data: after } = await admin
    .from('site_quotes').select('parse_warning').eq('id', quoteId).maybeSingle();
  await handOn(admin, quoteId, authHeader, after?.parse_warning ? [after.parse_warning] : []);
}

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
  const startedAt = Date.now();
  /** Each step says it has begun, so a reading that dies says where. */
  const stage = async (name: string) => {
    console.log(`[parse-quote] ${quote.id} ${name} at ${Date.now() - startedAt}ms`);
    await admin.from('site_quotes').update({ parse_stage: name }).eq('id', quote.id);
  };
  try {
    await stage('download');
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
    const texts: string[] = [];
    let pageCount = 0;

    for (const page of pages) {
      const { data: file, error: downloadError } = await admin.storage
        .from('site-quotes')
        .download(page.file_path);
      if (downloadError || !file) throw new Error(`Could not read the file: ${downloadError?.message}`);

      if (page.mime_type === 'application/pdf') {
        // A devis that carries its own text hands over its figures exactly and
        // for nothing. The page still goes up with it: the text layer gives
        // the characters, the picture gives the columns they sit in, and a
        // devis is a table before it is a list of words.
        await stage('upload');
        const probeStarted = Date.now();
        const seen = await inspect(new Uint8Array(await file.arrayBuffer()));
        if (seen.text) texts.push(seen.text);
        pageCount += seen.pages;
        console.log(
          `[parse-quote] ${quote.id} inspected: ${seen.pages} page(s), ` +
            `${seen.text ? `${seen.text.length} chars of text` : 'no usable text layer'}` +
            ` in ${Date.now() - probeStarted}ms`
        );

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

    await stage('read');

    const ask = async (instruction: string) => openai.chat.completions.create({
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
                (texts.length
                  ? `Ce devis porte sa propre couche de texte, reproduite ci-dessous. ` +
                    `Les chiffres y sont exacts: prends-y chaque quantité, chaque prix et chaque libellé, ` +
                    `au caractère près, sans jamais les relire sur l'image. L'image ne sert qu'à voir ` +
                    `quelle colonne est laquelle et où une ligne commence.\n\n` +
                    `--- texte du document ---\n${texts.join('\n\n--- page suivante ---\n\n').slice(0, 400_000)}\n--- fin ---\n\n`
                  : '') +
                instruction,
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

    /**
     * A scan is read a page at a time; a devis that carries its own text is
     * read whole.
     *
     * Not because a model cannot see ten pages at once — it can — but because
     * it will not write out three hundred lines in one answer. Asked for the
     * whole of this devis it counted 300 lines, returned 64, and said so: the
     * failure is in the writing, not the reading. One page is thirty lines,
     * which it writes without faltering, and ten short answers also fit in
     * the time one invocation is allowed where one long answer does not.
     *
     * The text path keeps the single request: the figures are given to it
     * exactly, so there is nothing to lose and a whole-document view to keep.
     */
    const byPage = !texts.length && pageCount > 1;
    let parsed: Parsed;
    let model: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;

    if (byPage) {
      const answers = await pooled(
        Array.from({ length: pageCount }, (_, i) => async () => {
          try {
            return await ask(
              `Ce document a ${pageCount} pages. Relève UNIQUEMENT les lignes imprimées sur la PAGE ${i + 1}, ` +
              `dans l'ordre, et rien des autres pages. ` +
              `printed_line_count est le nombre de lignes de cette page seule. ` +
              `total_ht et milestones: uniquement s'ils sont imprimés sur cette page, sinon null et liste vide.`
            );
          } catch (failure) {
            console.error(`[parse-quote] ${quote.id} page ${i + 1}: ${describe(failure)}`);
            return null;
          }
        }),
        READ_CONCURRENCY
      );

      parsed = { printed_line_count: 0, total_ht: null, currency: 'MAD', milestones: [], lines: [] };
      let lastLot: string | null = null;
      answers.forEach((response, index) => {
        if (!response) return;
        model ??= response.model ?? null;
        inputTokens += response.usage?.prompt_tokens ?? 0;
        outputTokens += response.usage?.completion_tokens ?? 0;
        const body = response.choices[0]?.message?.content;
        if (!body || response.choices[0]?.finish_reason === 'length') {
          console.error(`[parse-quote] ${quote.id} page ${index + 1} came back empty or truncated`);
          return;
        }
        let page: Parsed;
        try { page = JSON.parse(body) as Parsed; }
        catch (failure) {
          console.error(`[parse-quote] ${quote.id} page ${index + 1} unreadable: ${describe(failure)}`);
          return;
        }
        parsed.printed_line_count = (parsed.printed_line_count ?? 0) + (page.printed_line_count ?? 0);
        // The total is printed once, at the foot; the terms likewise.
        if (page.total_ht) parsed.total_ht = page.total_ht;
        if (page.currency) parsed.currency = page.currency;
        if (page.milestones?.length) parsed.milestones = page.milestones;
        for (const line of page.lines ?? []) {
          // A lot opened on one page runs onto the next, where its heading is
          // not reprinted. Carried forward, because a devis does not change
          // lot in silence.
          const lot = line.lot ? String(line.lot) : null;
          if (lot) lastLot = lot; else if (lastLot) line.lot = lastLot;
          parsed.lines.push(line);
        }
      });
      console.log(
        `[parse-quote] ${quote.id} read ${pageCount} pages separately:` +
          ` ${parsed.lines.length} lines in ${Date.now() - startedAt}ms`
      );
    } else {
      const response = await ask(
        `Relève toutes les lignes de ce devis, dans l'ordre du document, page après page.`
      );
      model = response.model ?? null;
      inputTokens = response.usage?.prompt_tokens ?? 0;
      outputTokens = response.usage?.completion_tokens ?? 0;
      if (response.choices[0]?.finish_reason === 'length') {
        throw new Error('Ce devis dépasse ce que le modèle peut rendre en une fois.');
      }
      const body = response.choices[0]?.message?.content;
      if (!body) throw new Error('The model returned no content');
      parsed = JSON.parse(body) as Parsed;
      parsed.lines ??= [];
    }

    await stage('store');
    const warnings: string[] = [];

    const counted = typeof parsed.printed_line_count === 'number' ? parsed.printed_line_count : 0;
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

    /**
     * A sub-total is not a line.
     *
     * Reading a page on its own, "Total lot n°C — 863 636" at the foot looks
     * like any other row, and two of them added seven hundred thousand
     * dirhams of work that does not exist. The prompt says so too, but a
     * figure that doubles part of a devis is worth refusing twice: a row that
     * names itself a total and carries neither quantity nor unit price is the
     * sum of rows already counted.
     */
    const isSubTotal = (label: string, line: Record<string, unknown>) =>
      /^\s*(sous[-\s]?totaux?|totaux?|report|s\/totaux?)\b/i.test(label)
      && line.quantity == null
      && line.unit_price == null;

    let dropped = 0;
    const rows = parsed.lines.filter((line) => {
      if (!isSubTotal(String(line.label ?? ''), line)) return true;
      dropped++;
      return false;
    }).map((line, index) => {
      const label = String(line.label ?? '').slice(0, 500);
      if (line.kind === 'heading') heading = label;
      const isChild = /^\s*[a-z]\s*-/i.test(label);
      return {
        quote_id: quote.id,
        company_id: quote.company_id,
        position: index,
        lot: line.lot ?? null,
        // Trimmed of the punctuation devis decorate it with ("3-", "4.12 :"),
        // so a prefix test means what it says.
        marker: String(line.number ?? '').trim().replace(/[\s.:)\-]+$/, '') || null,
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
        parse_source: texts.length ? 'text' : 'image',
        // Kept so a second reading does not send eleven megabytes again.
        parse_file_ids: fileIds.length ? fileIds : null,
        parse_passes: 1,
        parse_stage: null,
      })
      .eq('id', quote.id);

    // Whatever comes next gets an invocation of its own: another reading if
    // this one came back short, the operations otherwise.
    await handOn(admin, quote.id, authHeader, warnings);
    console.log(
      `[parse-quote] ${quote.id} read from ${texts.length ? 'its text layer' : 'the page images'}:` +
        ` ${rows.length} lines, ${milestones.length} milestones, total ${parsed.total_ht}` +
        `, ${inputTokens} in / ${outputTokens} out tokens` +
        (droppedCodes ? `, ${droppedCodes} unknown task codes dropped` : '') +
        (dropped ? `, ${dropped} sub-total row(s) dropped` : '')
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

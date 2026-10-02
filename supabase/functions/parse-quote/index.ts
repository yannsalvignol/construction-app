import OpenAI from 'npm:openai@4.104.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
// pdf.js packaged for server runtimes: a devis normally carries a text layer,
// and reading it is both cheaper and more accurate than looking at pictures
// of the pages.
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1';
// pdf-lib is pure JavaScript, so it runs here where a native PDF tool could not.
// eslint-disable-next-line import/no-unresolved -- resolved by Deno at deploy time.
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

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
            description: 'The LOT heading this line falls under, verbatim.',
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
- Une ligne numérotée qui ne porte aucune quantité et qui chapeaute des sous-lignes est un "heading".
- Une remise, un rabais ou toute ligne négative est un "discount", jamais du travail.
- Reporte les quantités et les prix tels quels. N'arrondis pas, ne recalcule pas, ne corrige pas une incohérence: elle appartient au document.
- task_code: uniquement si la correspondance est évidente. Dans le doute, null.
- Les en-têtes et pieds de page répétés (adresse, RC, ICE, pagination) ne sont pas des lignes.
- Les conditions de paiement (acompte, à la livraison, à la fin des travaux, retenue de garantie) vont dans "milestones", jamais dans les lignes, et gardent leur formulation d'origine.`;

const STEPS_SYSTEM = `Tu prépares le travail sur chantier (plomberie, CVC, électricité) à partir des lignes d'un devis déjà lu.

Pour chaque ligne qu'on te donne, liste les opérations successives qu'un ouvrier exécute pour la réaliser, et qu'il peut déclarer faites une par une.

- Une étape est une opération, pas une mesure: pas de quantité, pas de pourcentage, pas de "50% posé".
- Une étape doit être vérifiable sur place en regardant l'installation.
- Formule à l'infinitif, courte, sans numérotation: "Poser les plots anti-vibrations", "Raccorder puissance, commande et terre".
- Deux à cinq étapes quand la ligne en mérite. Tableau VIDE pour:
  - une fourniture seule, un matériel livré non posé, une location;
  - une ligne qui est déjà une seule opération ("Pose d'un WC", "Percement de dalle");
  - un forfait global qui couvre un lot entier sans décrire d'ouvrage;
  - une ligne dont le libellé ne dit pas assez pour savoir ce qu'on y fait.
- N'invente rien que le libellé n'implique pas. Dans le doute, tableau vide.
- Rends une entrée par ligne reçue, avec son index, et rien d'autre.

Exemples.
"Groupe moteur + alternateur 315 kVA insonorisé, posé en toiture" → ["Poser les plots anti-vibrations", "Mettre le groupe en place sur la dalle", "Raccorder puissance, commande et terre", "Essai de démarrage en charge"]
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
 * The model that reads the pages.
 *
 * The flagship tier, because this is the step where the money is: a devis read
 * wrong is a wrong price in a contract, and the previous model returned a unit
 * price of 58 885 that is printed on no page of the document. Roughly twice
 * gpt-4o per devis — a few tenths of a dirham against a figure a chef plans a
 * chantier on. Still a setting, so a cheaper tier can be measured against the
 * same devis without a deploy.
 */
const READ_MODEL = Deno.env.get('PARSE_QUOTE_MODEL') || 'gpt-5.6-sol';
/**
 * Turning wording that has already been read into a list of operations is the
 * easy half, and never touches a number, so it runs on the cheap tier.
 */
const STEPS_MODEL = Deno.env.get('PARSE_STEPS_MODEL') || 'gpt-5.6-luna';

/** Pages read at once. Wide enough to be quick, narrow enough not to trip a rate limit. */
const READ_CONCURRENCY = 4;

/** Lines per steps request. Text only, so this is about the answer's size. */
const STEPS_BATCH = 30;

/** Below this, a PDF's text layer is a stamp or a watermark, not a devis. */
const MIN_TEXT_LAYER = 200;
/** A scanned page costs a picture's worth of tokens; say no before the timeout does. */
const MAX_SCAN_PAGES = 40;
/** Raw bytes before base64, which adds a third again on the way out. */
const MAX_SCAN_BYTES = 20_000_000;
/** More than this is a method statement, not a line of a devis. */
const MAX_STEPS_PER_LINE = 6;

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

  const { quoteId } = await req.json().catch(() => ({}));
  if (!quoteId) return json({ error: 'Missing quoteId' }, 400);

  const { data: profile } = await admin
    .from('profiles')
    .select('company_id, role')
    .eq('id', caller.user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'chef') return json({ error: 'Only a chef can import a devis' }, 403);

  const { data: quote } = await admin
    .from('site_quotes')
    .select('id, company_id, file_path, mime_type, status')
    .eq('id', quoteId)
    .maybeSingle();
  if (!quote || quote.company_id !== profile.company_id) return json({ error: 'Quote not found' }, 404);
  if (quote.status === 'parsing') return json({ ok: true, status: 'parsing' }, 200);

  await admin.from('site_quotes').update({ status: 'parsing', parse_error: null }).eq('id', quote.id);

  // Answer now; the parse continues on its own. The client watches the status.
  const work = parse(admin, openaiKey, quote);
  // @ts-expect-error EdgeRuntime is provided by the Supabase runtime.
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work);
  else await work;

  return json({ ok: true, status: 'parsing' }, 202);
});

type Quote = { id: string; company_id: string; file_path: string; mime_type: string };

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

/**
 * A new PDF holding pages [first, last) of the original, base64 for the request.
 *
 * Copying the pages keeps their images as they are, so a slice costs the model
 * exactly what those pages would have cost in one go — the instalments are about
 * the size of the answer, not the size of the bill.
 */
async function singlePages(raw: Uint8Array) {
  // Scanners commonly set an owner password with no user password; the pages are
  // readable and refusing them over that would be pedantic.
  const source = await PDFDocument.load(raw, { ignoreEncryption: true });
  const out: string[] = [];
  // Parsed once: slicing ten pages must not re-read a ten-megabyte file ten times.
  for (let i = 0; i < source.getPageCount(); i++) {
    const single = await PDFDocument.create();
    const [page] = await single.copyPages(source, [i]);
    single.addPage(page);
    out.push(toBase64(new Uint8Array(await single.save())));
  }
  return out;
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

async function parse(
  admin: ReturnType<typeof createClient>,
  openaiKey: string,
  quote: Quote
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

    const images: { mime: string; base64: string }[] = [];
    const scans: {
      filename: string; raw: Uint8Array; base64: string; pages: number; bytes: number;
    }[] = [];
    let documentText = '';

    for (const page of pages) {
      const { data: file, error: downloadError } = await admin.storage
        .from('site-quotes')
        .download(page.file_path);
      if (downloadError || !file) throw new Error(`Could not read the file: ${downloadError?.message}`);
      const bytes = new Uint8Array(await file.arrayBuffer());

      if (page.mime_type === 'application/pdf') {
        const pdf = await getDocumentProxy(bytes);
        const { text } = await extractText(pdf, { mergePages: true });
        const layer = (text ?? '').trim();
        if (layer.length >= MIN_TEXT_LAYER) {
          documentText += `${layer}\n`;
        } else {
          // A scan: pages of pictures with no text layer, which is most of what
          // arrives by email from a client. unpdf cannot read it and rendering
          // the pages here is not possible in this runtime, so the PDF goes to
          // the model as a file and it reads the pages itself.
          scans.push({
            filename: page.file_path.split('/').pop() || 'devis.pdf',
            raw: bytes,
            base64: toBase64(bytes),
            pages: pdf.numPages ?? 1,
            bytes: bytes.length,
          });
        }
      } else {
        images.push({ mime: page.mime_type || 'image/jpeg', base64: toBase64(bytes) });
      }
    }

    documentText = documentText.trim();

    // Reading pictures of pages costs time and tokens in proportion to how many
    // there are, so the limits are stated rather than discovered as a timeout.
    const scanPages = scans.reduce((n, s) => n + s.pages, 0);
    const scanBytes = scans.reduce((n, s) => n + s.bytes, 0);
    if (scanPages > MAX_SCAN_PAGES) {
      throw new Error(
        `Ce devis scanné fait ${scanPages} pages ; la lecture est limitée à ${MAX_SCAN_PAGES}. Importez-le en plusieurs fois.`
      );
    }
    if (scanBytes > MAX_SCAN_BYTES) {
      throw new Error(
        `Ce devis scanné est trop lourd (${Math.round(scanBytes / 1e6)} Mo, maximum ${Math.round(MAX_SCAN_BYTES / 1e6)} Mo).`
      );
    }
    // Nothing readable at all: no text, no photographs, no scanned pages.
    if (!images.length && !scans.length && documentText.length < MIN_TEXT_LAYER) {
      throw new Error(
        'Ce fichier ne contient ni texte ni page lisible. Photographiez les pages du devis à la place.'
      );
    }

    // The catalogue travels with the request: the model can only suggest a
    // code it has been shown, which is what keeps suggestions mappable.
    const { data: codes } = await admin
      .from('task_codes')
      .select('code, unit, label_fr')
      .eq('is_active', true);
    const catalogue = (codes ?? []).map((c) => `${c.code} (${c.unit}) ${c.label_fr ?? ''}`.trim()).join('\n');

    const openai = new OpenAI({ apiKey: openaiKey });

    // A scanned devis of any length does not fit in one answer: every line
    // carries nine required fields, and gpt-4o cannot emit more than 16k tokens
    // whatever we ask for. So the pages are read a few at a time and the lines
    // are stitched back together in order. A devis short enough to fit is still
    // one request, exactly as before.
    const batches: { label: string; parts: Record<string, unknown>[] }[] = [];

    if (documentText || images.length) {
      batches.push({
        label: 'texte et photographies',
        parts: [
          {
            type: 'text',
            text:
              `Catalogue de codes tâches disponibles:\n${catalogue}\n\n` +
              (documentText ? `Texte du devis:\n\n${documentText}\n\n` : '') +
              (images.length
                ? `${images.length} page(s) photographiée(s) du devis suivent. Lis-les dans l'ordre.`
                : 'Extrais toutes les lignes de ce devis.'),
          },
          ...images.map((image) => ({
            type: 'image_url',
            image_url: { url: `data:${image.mime};base64,${image.base64}`, detail: 'high' },
          })),
        ],
      });
    }

    for (const scan of scans) {
      // One page per request. A single page's answer cannot outgrow the
      // ceiling, so length stops being a failure mode however long the devis.
      const pages = scan.pages === 1 ? [scan.base64] : await singlePages(scan.raw);
      pages.forEach((page, index) => {
        batches.push({
          label: `page ${index + 1}`,
          parts: [
            {
              type: 'text',
              text:
                `Catalogue de codes tâches disponibles:\n${catalogue}\n\n` +
                `Page ${index + 1} sur ${pages.length} d'un devis scanné. ` +
                `Relève toutes les lignes de CETTE page, dans l'ordre, et rien d'autre. ` +
                `Si une ligne appartient à un LOT dont le titre n'est pas imprimé sur cette page, laisse "lot" à null. ` +
                `Ne reporte le total HT et les conditions de paiement que s'ils sont imprimés sur cette page.`,
            },
            {
              type: 'file',
              file: { filename: scan.filename, file_data: `data:application/pdf;base64,${page}` },
            },
          ],
        });
      });
    }

    type Parsed = {
      /** What the page says it carries, which is not the same as what it returned. */
      printed_line_count?: number;
      total_ht: number | null;
      currency: string;
      milestones?: Record<string, unknown>[];
      lines: Record<string, unknown>[];
    };
    const parsed: Parsed = { total_ht: null, currency: '', milestones: [], lines: [] };
    let model: string | null = null;
    // Summed across the instalments: what the devis cost to read, not the last page.
    let inputTokens = 0;
    let outputTokens = 0;

    // Run a few at a time: the pages do not depend on one another, and ten
    // sequential requests would make a ten-page devis take ten times as long.
    // Capped rather than unbounded, because a wide fan-out of vision requests
    // is what trips a rate limit.
    const answers = await pooled(
      batches.map((batch) => async () => {
        const response = await openai.chat.completions.create({
          model: READ_MODEL,
          max_completion_tokens: 32000,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'devis', strict: true, schema: SCHEMA },
          },
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: batch.parts as never },
          ],
        });
        return { batch, response };
      }),
      READ_CONCURRENCY
    );

    // Pages whose answer came back short of their own count, read again below.
    const short: { batch: typeof batches[number]; got: number; printed: number }[] = [];

    // Merged in page order, in code. A model asked to merge would have to
    // re-emit every line to do it, which is the ceiling we just escaped, and
    // would be able to drop or reword lines on the way through.
    for (const { batch, response } of answers) {
      model = response.model ?? model;
      inputTokens += response.usage?.prompt_tokens ?? 0;
      outputTokens += response.usage?.completion_tokens ?? 0;
      if (response.choices[0]?.finish_reason === 'length') {
        throw new Error(
          `Trop de lignes à lire d'un coup (${batch.label}). Importez le devis en plusieurs fois.`
        );
      }
      const body = response.choices[0]?.message?.content;
      if (!body) throw new Error('The model returned no content');
      const part = JSON.parse(body) as Parsed;

      const got = (part.lines ?? []).length;
      parsed.lines.push(...(part.lines ?? []));
      // Omission is a known failure of structured extraction: a line is printed
      // and simply absent from the answer, with nothing in the response to say
      // so. Models also under-generate against an asked-for length rather than
      // refusing it. So the page is asked to count its lines separately, and a
      // page that returned fewer than it counted is read again.
      if (typeof part.printed_line_count === 'number' && got < part.printed_line_count) {
        short.push({ batch, got, printed: part.printed_line_count });
      }
      // The grand total is printed at the end, so a later page wins; a page of
      // sub-totals earlier in the devis must not overwrite it.
      if (typeof part.total_ht === 'number') parsed.total_ht = part.total_ht;
      if (!parsed.currency && part.currency) parsed.currency = part.currency;
      // Payment conditions are printed once. Keep the last page that states any
      // rather than concatenating the same schedule repeated per page.
      if (part.milestones?.length) parsed.milestones = part.milestones;
    }

    // Second pass over the short pages: the same page, told what already came
    // back, asked only for what it left out. Appending rather than replacing,
    // because the first answer's lines were not wrong — they were incomplete.
    const warnings: string[] = [];
    if (short.length) {
      const recovered = await pooled(
        short.map(({ batch, got, printed }) => async () => {
          const already = parsed.lines
            .map((line) => String(line.label ?? ''))
            .filter(Boolean);
          const response = await openai.chat.completions.create({
            model: READ_MODEL,
            max_completion_tokens: 32000,
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'devis', strict: true, schema: SCHEMA },
            },
            messages: [
              { role: 'system', content: SYSTEM },
              {
                role: 'user',
                content: [
                  ...batch.parts,
                  {
                    type: 'text',
                    text:
                      `Tu as compté ${printed} lignes sur cette page et tu n'en as rendu que ${got}. ` +
                      `Voici les libellés déjà relevés sur l'ensemble du devis :\n${already.join('\n')}\n\n` +
                      `Rends UNIQUEMENT les lignes de cette page qui manquent dans cette liste, dans l'ordre du document. ` +
                      `Si rien ne manque, rends une liste vide.`,
                  },
                ] as never,
              },
            ],
          });
          return { batch, got, printed, response };
        }),
        READ_CONCURRENCY
      );

      for (const { batch, got, printed, response } of recovered) {
        inputTokens += response.usage?.prompt_tokens ?? 0;
        outputTokens += response.usage?.completion_tokens ?? 0;
        const body = response.choices[0]?.message?.content;
        const extra = body && response.choices[0]?.finish_reason !== 'length'
          ? ((JSON.parse(body) as Parsed).lines ?? [])
          : [];
        // Appended at the end rather than spliced into position: the order
        // within a page is lost, which is a smaller loss than a missing line.
        parsed.lines.push(...extra);
        if (got + extra.length < printed) {
          warnings.push(`${batch.label}: ${got + extra.length} ligne(s) relevée(s) sur ${printed} comptée(s)`);
        }
      }
    }

    // A page that starts in the middle of a LOT cannot see its title, and was
    // told to say so rather than guess. The lot carries over here, which is
    // the one thing reading page by page genuinely loses.
    let currentLot: string | null = null;
    // Each page writes the lot title in its own hand — "LOT N° 10 : COURANT
    // FORT", "Lot N° 10 : Courant Fort" — and four spellings of one lot is four
    // lots on the chef's screen. The first spelling seen wins, matched on the
    // letters alone.
    const lotSpellings = new Map<string, string>();
    const fold = (value: string) =>
      value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '');
    for (const line of parsed.lines) {
      if (typeof line.lot === 'string' && line.lot.trim()) {
        const printed = line.lot.trim();
        const key = fold(printed);
        if (key) {
          if (!lotSpellings.has(key)) lotSpellings.set(key, printed);
          currentLot = lotSpellings.get(key)!;
        }
        line.lot = currentLot;
      } else if (currentLot) {
        line.lot = currentLot;
      }
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

    // The operations each line breaks down into, asked for separately.
    //
    // Not part of the extraction: a line already costs nine required fields,
    // and adding two to five operations to each was enough to overflow the
    // answer on four scanned pages. This pass sees only the wording that came
    // out — no pages, no images — so it is cheap, its answer is small, and it
    // can be rerun on a devis that was imported before operations existed.
    const steps: { quote_line_id: string; company_id: string; position: number; label: string }[] = [];
    const workLines = parsed.lines
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => line.kind === 'work' && idByPosition.has(index));

    for (let from = 0; from < workLines.length; from += STEPS_BATCH) {
      const batch = workLines.slice(from, from + STEPS_BATCH);
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
              content: batch
                .map(({ line, index }) => `${index}. ${String(line.label ?? '').slice(0, 300)}`)
                .join('\n'),
            },
          ],
        });
        inputTokens += response.usage?.prompt_tokens ?? 0;
        outputTokens += response.usage?.completion_tokens ?? 0;
        const body = response.choices[0]?.message?.content;
        if (response.choices[0]?.finish_reason === 'length' || !body) continue;
        const proposed = (JSON.parse(body) as {
          lines: { index: number; steps: string[] }[];
        }).lines ?? [];

        for (const entry of proposed) {
          const lineId = idByPosition.get(entry.index);
          if (!lineId) continue;
          const labels = (Array.isArray(entry.steps) ? entry.steps : [])
            .map((label) => String(label ?? '').trim().slice(0, 200))
            .filter((label) => label.length > 0)
            .slice(0, MAX_STEPS_PER_LINE);
          // A line broken into one operation has not been broken down.
          if (labels.length < 2) continue;
          labels.forEach((label, position) => {
            steps.push({ quote_line_id: lineId, company_id: quote.company_id, position, label });
          });
        }
      } catch (failure) {
        // A devis that parsed is worth keeping even if its operations did not.
        console.error('[parse-quote] steps batch', describe(failure));
      }
    }
    for (let i = 0; i < steps.length; i += 500) {
      const { error } = await admin.from('quote_line_steps').insert(steps.slice(i, i + 500));
      // A devis that parsed is worth keeping even if its operations did not.
      if (error) { console.error('[parse-quote] steps', error.message); break; }
    }

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

    console.log(
      `[parse-quote] ${quote.id}: ${rows.length} lines, ${steps.length} steps, ${milestones.length} milestones, total ${parsed.total_ht}` +
        `, ${batches.length} request(s), ${inputTokens} in / ${outputTokens} out tokens` +
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

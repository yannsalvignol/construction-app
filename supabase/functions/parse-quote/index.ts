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
          steps: {
            type: 'array',
            description:
              'Les opérations successives pour réaliser cette ligne, déclarables une par une. Tableau vide quand la ligne ne se décompose pas.',
            items: { type: 'string' },
          },
          task_code: {
            type: ['string', 'null'],
            description:
              'A code from the catalogue provided, when the line plainly matches one. Null when unsure — a wrong code is worse than none, because it makes a false progress figure.',
          },
        },
        required: ['lot', 'label', 'kind', 'source_unit', 'unit', 'quantity', 'unit_price', 'amount_ht', 'steps', 'task_code'],
        additionalProperties: false,
      },
    },
  },
  required: ['total_ht', 'currency', 'milestones', 'lines'],
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
- Les conditions de paiement (acompte, à la livraison, à la fin des travaux, retenue de garantie) vont dans "milestones", jamais dans les lignes, et gardent leur formulation d'origine.

"steps": les opérations successives qu'un ouvrier exécute pour réaliser la ligne, et qu'il peut déclarer faites une par une.
- Une étape est une opération, pas une mesure: pas de quantité, pas de pourcentage, pas de "50% posé".
- Une étape doit être vérifiable sur place en regardant l'installation.
- Formule à l'infinitif, courte, sans numérotation: "Poser les plots anti-vibrations", "Raccorder puissance, commande et terre".
- Deux à cinq étapes quand la ligne en mérite. JAMAIS d'étapes pour:
  - un "heading" ou un "discount";
  - une fourniture seule, un matériel livré non posé, une location;
  - une ligne qui est déjà une seule opération ("Pose d'un WC", "Percement de dalle");
  - un forfait global qui couvre un lot entier sans décrire d'ouvrage;
  - une ligne dont le libellé ne dit pas assez pour savoir ce qu'on y fait.
- N'invente rien que le libellé n'implique pas. Dans le doute, tableau vide.
- Exemple. "Groupe moteur + alternateur 315 kVA insonorisé, posé en toiture" →
  ["Poser les plots anti-vibrations", "Mettre le groupe en place sur la dalle", "Raccorder puissance, commande et terre", "Essai de démarrage en charge"].
  "Fourniture de 12 ml de gaine spirale Ø125" → [].`;

/** Below this, a PDF's text layer is a stamp or a watermark, not a devis. */
const MIN_TEXT_LAYER = 200;
/** A scanned page costs a picture's worth of tokens; say no before the timeout does. */
const MAX_SCAN_PAGES = 40;
/** Raw bytes before base64, which adds a third again on the way out. */
const MAX_SCAN_BYTES = 20_000_000;
/**
 * Pages per request. Each line of a devis costs nine required JSON fields, and
 * gpt-4o will not emit more than about 16k tokens however high max_tokens is
 * set, so a long scan has to be read in instalments. Four pages of a dense
 * devis fit with room to spare.
 */
const SCAN_CHUNK_PAGES = 4;
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
async function slicePdf(raw: Uint8Array, first: number, last: number) {
  // Scanners commonly set an owner password with no user password; the pages are
  // readable and refusing them over that would be pedantic.
  const source = await PDFDocument.load(raw, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const indices = [];
  for (let i = first; i < last && i < source.getPageCount(); i++) indices.push(i);
  const copied = await out.copyPages(source, indices);
  for (const page of copied) out.addPage(page);
  return toBase64(new Uint8Array(await out.save()));
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
      for (let first = 0; first < scan.pages; first += SCAN_CHUNK_PAGES) {
        const last = Math.min(first + SCAN_CHUNK_PAGES, scan.pages);
        const slice = scan.pages <= SCAN_CHUNK_PAGES
          ? scan.base64
          : await slicePdf(scan.raw, first, last);
        batches.push({
          label: `pages ${first + 1}-${last}`,
          parts: [
            {
              type: 'text',
              text:
                `Catalogue de codes tâches disponibles:\n${catalogue}\n\n` +
                `Extrait d'un devis scanné : pages ${first + 1} à ${last} sur ${scan.pages}. ` +
                `Relève toutes les lignes de ces pages, dans l'ordre, et rien d'autre. ` +
                `Ne reporte le total HT et les conditions de paiement que s'ils sont imprimés sur ces pages.`,
            },
            {
              type: 'file',
              file: { filename: scan.filename, file_data: `data:application/pdf;base64,${slice}` },
            },
          ],
        });
      }
    }

    type Parsed = {
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

    for (const batch of batches) {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        // The devis runs to a hundred lines; the default ceiling truncates it.
        max_tokens: 16000,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'devis', strict: true, schema: SCHEMA },
        },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: batch.parts as never },
        ],
      });
      model = response.model ?? model;
      inputTokens += response.usage?.prompt_tokens ?? 0;
      outputTokens += response.usage?.completion_tokens ?? 0;
      if (response.choices[0]?.finish_reason === 'length') {
        // Naming the pages turns "too long" into something the chef can act on.
        throw new Error(
          `Trop de lignes à lire d'un coup (${batch.label}). Importez le devis en plusieurs fois.`
        );
      }
      const body = response.choices[0]?.message?.content;
      if (!body) throw new Error('The model returned no content');
      const part = JSON.parse(body) as Parsed;

      parsed.lines.push(...(part.lines ?? []));
      // The grand total is printed at the end, so a later batch wins; a page of
      // sub-totals earlier in the devis must not overwrite it.
      if (typeof part.total_ht === 'number') parsed.total_ht = part.total_ht;
      if (!parsed.currency && part.currency) parsed.currency = part.currency;
      // Payment conditions are printed once. Keep the last page that states any
      // rather than concatenating the same schedule repeated per page.
      if (part.milestones?.length) parsed.milestones = part.milestones;
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

    // The operations a line breaks down into. The model is told to leave the
    // list empty wherever a line does not decompose; this trims what still
    // comes back wrong rather than trusting it.
    const steps = parsed.lines.flatMap((line, index) => {
      const lineId = idByPosition.get(index);
      if (!lineId || line.kind !== 'work') return [];
      const labels = (Array.isArray(line.steps) ? line.steps : [])
        .map((label: unknown) => String(label ?? '').trim().slice(0, 200))
        .filter((label: string) => label.length > 0)
        .slice(0, MAX_STEPS_PER_LINE);
      // A line broken into one operation has not been broken down.
      if (labels.length < 2) return [];
      return labels.map((label: string, position: number) => ({
        quote_line_id: lineId,
        company_id: quote.company_id,
        position,
        label,
      }));
    });
    for (let i = 0; i < steps.length; i += 500) {
      const { error } = await admin.from('quote_line_steps').insert(steps.slice(i, i + 500));
      // A devis that parsed is worth keeping even if its operations did not.
      if (error) { console.error('[parse-quote] steps', error.message); break; }
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

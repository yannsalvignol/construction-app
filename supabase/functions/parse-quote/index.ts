import OpenAI from 'npm:openai@4.104.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
// pdf.js packaged for server runtimes: a devis normally carries a text layer,
// and reading it is both cheaper and more accurate than looking at pictures
// of the pages.
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1';

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
- Les conditions de paiement (acompte, à la livraison, à la fin des travaux, retenue de garantie) vont dans "milestones", jamais dans les lignes, et gardent leur formulation d'origine.`;

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
        documentText += `${(text ?? '').trim()}\n`;
      } else {
        images.push({ mime: page.mime_type || 'image/jpeg', base64: toBase64(bytes) });
      }
    }

    documentText = documentText.trim();
    // A scan has pages but no text layer. Say so plainly rather than
    // returning an empty devis that looks like a parsing failure.
    if (!images.length && documentText.length < 200) {
      throw new Error(
        'Ce PDF ne contient pas de texte (document scanné). Photographiez les pages du devis à la place.'
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

    // Text and photographs can arrive together: a PDF for most of the devis
    // and a photograph of the annotated last page is a real case.
    const userContent = [
      {
        type: 'text' as const,
        text:
          `Catalogue de codes tâches disponibles:\n${catalogue}\n\n` +
          (documentText
            ? `Texte du devis:\n\n${documentText}\n\n`
            : '') +
          (images.length
            ? `${images.length} page(s) photographiée(s) du devis suivent. Lis-les dans l'ordre.`
            : 'Extrais toutes les lignes de ce devis.'),
      },
      ...images.map((image) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${image.mime};base64,${image.base64}`, detail: 'high' as const },
      })),
    ];

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
        { role: 'user', content: userContent },
      ],
    });

    const body = response.choices[0]?.message?.content;
    if (response.choices[0]?.finish_reason === 'length') {
      throw new Error('Le devis est trop long pour être lu en une fois.');
    }
    if (!body) throw new Error('The model returned no content');
    const parsed = JSON.parse(body) as {
      total_ht: number | null;
      currency: string;
      milestones?: Record<string, unknown>[];
      lines: Record<string, unknown>[];
    };

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
        input_tokens: response.usage?.prompt_tokens ?? null,
        output_tokens: response.usage?.completion_tokens ?? null,
        parse_model: response.model ?? null,
      })
      .eq('id', quote.id);

    console.log(
      `[parse-quote] ${quote.id}: ${rows.length} lines, ${milestones.length} milestones, total ${parsed.total_ht}` +
        `, ${response.usage?.prompt_tokens ?? '?'} in / ${response.usage?.completion_tokens ?? '?'} out tokens` +
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

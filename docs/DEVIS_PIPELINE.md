# Reading a devis

How a PDF becomes three hundred lines a crew can tick off, what each stage
costs, and why each one is shaped the way it is. Everything here lives in
`supabase/functions/parse-quote/index.ts` and the `quote_*` SQL functions.

Most of the design is scar tissue. Where a decision looks odd, the paragraph
under it is the thing that went wrong.

---

## The shape of it

```
chef uploads a PDF
        │
        ▼
┌───────────────────┐
│ 1. inspect        │  does the file carry its own text?
└───────────────────┘
        │
        ├── yes ──► one request, whole document, text given as exact
        │
        └── no  ──► one request per page, four at a time
        │
        ▼
┌───────────────────┐
│ 2. store          │  lines written, status → parsed, devis usable
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ 3. recover        │  only if the lines fall short of the printed total
└───────────────────┘   (its own invocation, up to twice)
        │
        ▼
┌───────────────────┐
│ 4. steps          │  each line broken into one to three operations
└───────────────────┘   (its own invocation, two rounds)
        │
        ▼
   quote_outline     the structure, read on demand by both screens
```

Stages 3 and 4 each run in a **separate invocation**, started by the one
before it over HTTP as the same caller.

> They used to run inline. A ten-page scan needing two recovery reads ran past
> the time one invocation is allowed, was killed mid-sentence, and — because
> nothing was written until every pass had finished — left the chef watching a
> spinner that would never stop. No lines, no error, nothing to retry from.
> One pass per invocation means each gets a whole budget, and the chef has a
> usable devis after the first.

`parse_stage` records which stage is running. It is how "it hangs" became
"it hangs in `read`, 9.8 seconds in", which ruled out the download, the upload
and the text probe in a single observation.

---

## 1. Text or photograph

A born-digital PDF hands over its figures exactly, for nothing. A scan has to
be looked at. Nothing in the file name says which, so `inspect()` measures:

| | characters/page | bytes/character |
|---|---|---|
| born-digital devis | 1 000 – 3 800 | 5 – 30 |
| a 10-page scan | 0 | — |
| a scan with an OCR layer | 1 123 | 178 |

```
text path  ⟺  ≥ 300 chars/page  AND  ≤ 150 bytes/char
```

Characters per page separates the clear cases. Bytes per character catches the
awkward one: a scan carrying an OCR layer *has* text, but pays hundreds of
bytes for each character of it, and that text is a guess rather than the
document.

**Cost of the probe:** 10 ms on an 11 MB scan, 162 ms on an 8-page text PDF.
Extracting text never decodes an image stream, which is why the expensive case
is the cheap one. Files over 15 MB skip it, any failure falls back to the
image path, and `PARSE_TEXT_PROBE=off` removes it without a redeploy.

> An earlier version of this function did parse PDFs locally — pdf.js for the
> text, pdf-lib to cut pages, a hand-rolled base64 loop over each one. Twenty
> megabytes of string work in a runtime that allows two seconds of CPU. It was
> killed three seconds in, having spent its whole budget before sending a
> single request. Waiting on OpenAI costs no CPU; encoding a file ourselves
> cost all of it. Hence the hard size guard and the switch.

On the text path the extracted text goes into the prompt as authoritative for
every figure, and the page goes with it for layout only: the text gives the
characters, the picture says which column they sit in.

---

## 2. Reading

**A text devis is read whole.** One request, the whole document. The figures
are given to it exactly, so there is nothing to gain by splitting and a
whole-document view to keep.

**A scan is read one page per request**, `READ_CONCURRENCY = 4` at a time.

> Not because a model cannot see ten pages — it can. Asked for the whole of an
> eleven-megabyte devis it counted 300 lines, returned 64, and said so: 5 315
> output tokens against the 22 000 of a good run. The failure is in the
> *writing*, not the reading. One page is thirty lines, which it writes
> without faltering, and ten short answers fit the budget where one long
> answer does not. Eighty-five seconds, against never finishing.

The file is uploaded to the Files API once and every page request refers to it
by id, so eleven megabytes never move twice.

Two things reading a page alone costs, both now handled:

- **A lot opened on one page runs onto the next**, where its heading is not
  reprinted. The last lot seen is carried forward at the merge — a devis does
  not change lot in silence.
- **`Total lot n°C — 863 636` at the foot of a page looks like a line** when
  you cannot see the lines it sums. Two of those added seven hundred thousand
  dirhams of work that does not exist. Refused twice now: the prompt says a
  report, sub-total or lot total is not a line, and the code drops any row that
  names itself a total and carries neither quantity nor unit price.

---

## 3. Recovery

After storing, the lines are compared against the **printed total**. Short by
more than 10% and the devis is read again, asking only for what is missing, up
to `MAX_RECOVERY_PASSES = 2`.

> The trigger used to be the model's own line count. A model that stops short
> of a long list stops counting it too: one run insisted it had found all 160
> of the 160 lines it saw, where the document holds 295 — perfectly consistent
> with itself and a third of the devis short. The printed total is the one
> figure that does not come from the reading. 13 718 771 printed against
> 8 732 268 summed is not something self-consistency can explain away.

The follow-up names the arithmetic rather than the count: *"the devis states
13 718 771 and your lines come to 8 732 268 — lines are missing"* is a sharper
instruction than *"you counted more than you gave me"*.

---

## 4. Operations

Each work line is broken into one to three operations a worker ticks off
individually — "Fixer le radiateur", "Raccorder les tubes". `STEPS_BATCH = 30`
lines per request, `STEPS_CONCURRENCY = 6` requests at once,
`MAX_STEPS_PER_LINE = 3`.

**Two rounds.** Whatever comes back bare is asked again ten at a time.

> The model answers for part of a batch and silently drops the rest — 109
> lines of 160, 141 of 295 — with nothing in the reply saying which. The
> omissions are what a long answer loses at the end, not a judgement that a
> line needs no operations, so a shorter answer is the fix rather than a
> sterner instruction.

**The prompt decomposes by default.** It once listed five situations calling
for an empty answer, among them *"a line that is already a single operation"*
and *"when in doubt, empty"*. On a devis where nearly every line reads "POSE
X" that empties most of it, which is exactly what it did: 54 answers, three
usable. It now returns nothing in two cases only — a supply with no
installation, and a label that does not say what is done.

Coverage after the change: 27 of 27 lines, 30 of 30, 89% on a 294-line scan.

**Matching answers to lines** is by position in the batch, with the echoed
index as a hint only.

> It used to trust the index. A model that renumbers its answer from zero lost
> every operation on the devis, and nothing raised an error — `idByPosition
> .get(entry.index)` simply missed on every entry.

---

## The structure

`quote_outline(quote)` returns each line with its **path** — the lot, then
every heading it sits under. One SQL function, read by the worker's task list,
the chantier counts, and the chef's review screen alike.

> It was two implementations, one in SQL and one in TypeScript. Two
> implementations of one rule is a divergence waiting for a devis odd enough to
> find it — and a part handed to an employee is only handed over correctly if
> both agree to the character.

Each line asks two questions, in order:

1. **By printed number.** The devis prints `A`, `1`, `1.1`, `1.1.1` in a column
   of its own; a line belongs to every heading whose number is a prefix of its
   own, cut at a dot so `1` opens `1.1` and never `12`. Nothing depends on
   position, so nothing is lost at a page break.
2. **By position**, when the first comes back empty. A heading opens a part and
   the next heading of the same or shallower rank closes it. Rank comes from
   the numbering: a dotted number is as deep as it has parts, anything else is
   a divider at the top of its lot.

> Choosing one rule per document was the mistake. Counting how many lines
> carried a number said a devis numbering its chapters `1-` and lettering
> their children `a-` was "numbered", so it took the prefix rule, found no
> parent for anything, and fell from twenty-seven parts to three. How many
> lines carry a marker says nothing about whether those markers *nest*.

Asking per line means a devis that does both — a numbered chapter with
lettered children under it — is read correctly either way.

A devis that divides itself into lots and prints a row outside them (a
commercial discount at the foot) gives that row an empty path, rather than
filing it under the last chapter it happened to follow.

---

## What the prompts are told, and why

Each of these is a line in `SYSTEM` that exists because of a specific devis.

| Rule | What it prevents |
|---|---|
| `lot` is the top-level section only | A chapter heading copied into `lot` made every chapter its own section, which is what broke the layering. |
| A title printed identically on every page is the document's, not a section's | `LOT N° 10 : COURANT FORT COURANT FAIBLE` sits atop all ten pages; read in isolation, pages filed 104 lines under it. |
| No section visible on this page → `null` | A missing section can be recovered; a false one cannot. |
| The reference column is not the designation | Labels came back as "Produit a- Pf : 60.3 kw". |
| A sub-total is not a line | 7% of a devis counted twice. |
| Copy figures as printed, never recompute | A devis's own inconsistency belongs to the devis. |
| Payment terms go in `milestones` | "ACOMPTE DE 40%" is not work. |

---

## Models and cost

Both stages run on the cheap tier — **on evidence, not on principle.**

> The flagship was the safe assumption: a devis read wrong is a wrong price in
> a contract. Measured against a ten-page scan whose page 1 had been
> transcribed by hand, both tiers returned all twenty-four printed unit prices
> and neither invented one. Same answer, a fifth of the price: 1.3 dirhams a
> devis against 4.5.
>
> Measure again before trusting this on a document unlike that one. The
> reading is where the money is, and the only reason to be on the cheap tier is
> that it was shown to read as well — not that it is cheap.

`PARSE_QUOTE_MODEL` and `PARSE_STEPS_MODEL` override the defaults without a
redeploy. `scripts/compare-quote-models.mjs` scores a model against prices
transcribed by hand from the paper: how many printed prices came back, and how
many came back that are printed nowhere. A model that invents 58 885 fails,
however fluent its labels.

---

## Where it stands

Measured end to end, on the two devis in the repository:

| | `chantier_1` | `chantier_2` |
|---|---|---|
| | born-digital, 8 pages, 97 KB | scan, 10 pages, 10.8 MB |
| read via | its text layer | 10 pages in parallel |
| time | 58 s | 84 s |
| work lines | 99 — the paper prints 99 | 294 |
| sum vs printed total | exact, after the −35 822 discount | 13 719 321 vs 13 718 771 |
| parts | 27 (3 lots, 24 chapters) | 33 (11 lettered sections) |
| sub-tasks | — | 565 over 89% of lines |

A gap of 550 dirhams in 13.7 million is the strongest evidence available short
of reading the paper — but it is not proof. Two errors can cancel. The warning
comparing the summed lines against the printed total is still shown to the
chef, and it stayed silent on that run.

---

## When a devis reads badly

1. **`parse_source`** — `text` or `image`. A born-digital devis read as an
   image means the probe rejected it; check characters per page and bytes per
   character against the thresholds above.
2. **`parse_stage`** — where a killed reading got to.
3. **`parse_warning`** — the devis says what it is unsure of: lines counted
   against lines returned, summed lines against the printed total, operations
   not generated and why.
4. **The steps report** — the "Générer les sous-tâches" button on the review
   screen returns lines sent, batches, answers, lines attached, rows written,
   and every failure, straight to the terminal running the app. When nothing
   attaches it carries the first answer verbatim, because a count of what did
   not work says nothing about why.

> That last one is there because the operations failed silently three times.
> A count told me *that* they failed; the raw answer told me the model was
> returning empty arrays, which was my own prompt's doing.

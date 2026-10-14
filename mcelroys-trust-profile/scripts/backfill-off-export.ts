// BACKFILL THE PRODUCT-LEVEL COLUMNS FROM THE OPEN FOOD FACTS EXPORT.
//
// Phase 1 step 3. Written 2026-10-13, after scripts/probe-off-labels.ts
// measured the export and reported what is actually in it.
//
// WHAT THIS WRITES, and the backlog item each one closes:
//
//   labelClaims            item 18   organic / non-GMO / gluten-free as the
//                                    LABEL claims them. 6.1% of export
//                                    records carry an organic tag; we hold
//                                    40 organic rows across 416,382 products.
//   additiveENumbers       item NEW  INS numbers (= EU E-numbers), on 56.1%
//                                    of records.
//   labelAllergens         item 22   the label's own "Contains:" line, on
//                                    55.1% of records.
//   labelAllergenTraces    item 22   the "may contain" line. Only 2.4% of
//                                    records, and we cannot derive it at all.
//   ingredientsTextRaw     item 40   the ingredient list verbatim, so our
//                                    transcription becomes auditable.
//   ingredientsTextLang    item 36   the Norwegian-Snickers bug: 4.4% of
//                                    records have ingredient text but no
//                                    English text.
//   imageWidth/Height      item 32   if the export carries sizes. See below.
//
// WHAT THIS DELIBERATELY DOES NOT WRITE, and why that is not a shortcut:
//
//   THE NESTED INGREDIENT TREE (item 39) and Ingredient.offTaxonomyId. The
//   export does ship the tree, which is the best news the probe found: 90.6%
//   of records carry a parsed `ingredients` array and 115,774 of those
//   already have nested children. But storing it means resolving ingredient
//   names against our 127,268-row Ingredient table and possibly creating
//   rows in it, and that table feeds every allergen and exclusion filter on
//   the site. It gets its own script and its own dry run read by a person.
//   Round 13's lesson is the reason: a dry run that prints the largest
//   changes is a good report and a bad audit, and the ingredient graph is
//   where that costs the most.
//
//   THE IMAGE RE-RUN (item 27, the 34,624 products still stamped "never
//   looked"). scripts/backfill-off-images.ts already does that job correctly.
//   A second implementation of the same matching and the same host allowlist
//   would disagree with the first eventually — that is item 20's lesson, and
//   this project has now paid it four times. This script REPORTS whether the
//   export carries image sizes so that work can be a small addition there,
//   and writes dimensions only for products it is already updating.
//
// THE THREE-STATE RULE IS THE WHOLE POINT OF THIS SCRIPT.
//
// Every column group here is a (value, source, checkedAt) triple, and this
// script sets checkedAt FOR EVERY PRODUCT IT MATCHES, including the ones
// where the answer is "the label claims nothing". An empty array with a
// checkedAt set means we read the export and there was nothing. An empty
// array with a null checkedAt means nobody has looked. Those are different
// statements and the site says different things about them.
//
// Item 27 is what collapsing them costs: 34,624 products are permanently
// stamped "never looked" for their photograph because a backfill ran before
// that distinction existed. This script is written so that cannot recur —
// see flushBatch(), where checkedAt is NOT conditional on finding anything.
//
// DRY RUN BY DEFAULT. Pass --live to write. Reads the export once.
//
//   npx tsx scripts/backfill-off-export.ts ./data/openfoodfacts-products.jsonl.gz
//   npx tsx scripts/backfill-off-export.ts ./data/openfoodfacts-products.jsonl.gz --live
//
// Flags:
//   --live            actually write
//   --limit N         stop after N matched products (for a quick look)
//   --batch N         rows per transaction, default 500
//   --recheck         also revisit products whose checkedAt is already set
//   --only a,b,c      only these groups: labels, additives, allergens, text
//
// Safe to interrupt. The log is written as it goes, and a partial run leaves
// the products it reached correctly stamped and the rest untouched.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { StringDecoder } from 'node:string_decoder'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { normalizeUpc } from '@/lib/upc'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const args = process.argv.slice(2)
const FILE = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a))
const DRY_RUN = !args.includes('--live')
const RECHECK = args.includes('--recheck')
function argValue(name: string): string | null {
  const i = args.indexOf(name)
  return i === -1 ? null : (args[i + 1] ?? null)
}
const LIMIT = argValue('--limit') ? Number(argValue('--limit')) : Infinity
const BATCH_SIZE = argValue('--batch') ? Number(argValue('--batch')) : 500
const PROGRESS_EVERY = 250_000
const SOURCE = 'open_food_facts'

// WHICH GROUPS TO RUN. All of them by default. This exists so a single group
// can be re-run after a wording or mapping change without a second 7 GB read
// of the other three — not so groups get run one at a time, which is the
// nine-separate-passes mistake this whole phase exists to avoid.
const ALL_GROUPS = ['labels', 'additives', 'allergens', 'text'] as const
type Group = (typeof ALL_GROUPS)[number]
const onlyArg = argValue('--only')
const GROUPS = new Set<Group>(
  onlyArg
    ? (onlyArg.split(',').map((s) => s.trim()) as Group[]).filter((g) =>
        (ALL_GROUPS as readonly string[]).includes(g)
      )
    : ALL_GROUPS
)
if (onlyArg && GROUPS.size === 0) {
  console.error(`--only did not name any known group. Known: ${ALL_GROUPS.join(', ')}`)
  process.exit(1)
}

// ---------------------------------------------------------------- logging --
// Same convention as every other script in scripts/: written as it goes, so
// an interrupted run still leaves a record of how far it got.
const LOG_FILE = path.join(
  './logs',
  `backfill-off-export-${DRY_RUN ? 'dryrun-' : ''}${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
)
fs.mkdirSync('./logs', { recursive: true })
function writeLine(line: string) {
  fs.appendFileSync(LOG_FILE, line + '\n')
}
function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  writeLine(line)
}

// ------------------------------------------------------------ tag filters --
// WHICH LABEL TAGS WE KEEP.
//
// The export has hundreds of distinct label tags, most of them country
// marketing schemes ("fr:entrepreneurs-engages", "en:made-in-germany") that
// say nothing a shopper here is asking. Keeping everything would mean
// storing noise and then filtering it at render time on every page view.
//
// So this is an allowlist, and it is deliberately narrow: the claims the app
// already has a question for, plus the ones it is about to. Anything not in
// here is counted in the log under "label tags seen and not kept", so the
// list can be widened on evidence rather than on guesswork.
const KEEP_LABEL = new Set([
  'en:organic', 'en:usda-organic', 'en:eu-organic', 'en:canada-organic',
  'fr:ab-agriculture-biologique',
  'en:no-gmos', 'en:non-gmo-project', 'en:non-gmo-project-verified',
  'en:no-gluten', 'en:certified-gluten-free',
  'en:vegan', 'en:vegetarian', 'en:kosher', 'en:halal',
  'en:fair-trade', 'en:fairtrade-international',
  'en:no-preservatives', 'en:no-artificial-flavors', 'en:no-colorings',
  'en:no-added-sugar', 'en:no-lactose',
])

// AN INS / E-NUMBER TAG AS OFF WRITES IT. The probe measured the shapes:
// 372,669 three-digit, 92,181 three-digit-plus-letter, 5,809 four-digit, and
// 2,359 that are not e-numbers at all. We keep only the ones that match,
// because a column called additiveENumbers holding "en:some-text" would be
// a lie the next reader has to discover.
const ENUMBER_TAG = /^en:e(\d{3,4})([a-z]{0,2})$/i

// THE NINE US MAJOR ALLERGENS, as the tags OFF uses. Sesame is in the list
// because the FASTER Act added it in 2021.
//
// NOT A FILTER ON WHAT WE STORE. We store every allergen tag the label
// carries, including celery and mustard, which are EU majors and not US
// ones — dropping them would make our record of a European product's label
// quietly wrong. This set is used only to count, in the log, how many
// products gain a US-major-allergen statement.
const US_MAJOR_ALLERGENS = new Set([
  'en:milk', 'en:eggs', 'en:fish', 'en:crustaceans', 'en:tree-nuts',
  'en:peanuts', 'en:soybeans', 'en:gluten', 'en:sesame-seeds',
])

// ------------------------------------------------------------- statistics --
let linesRead = 0
let parsed = 0
let matched = 0
let matchedByNormalising = 0
let skippedAlreadyChecked = 0
let batchesWritten = 0
let batchesFailed = 0

let gotLabels = 0
let gotAdditives = 0
let gotAllergens = 0
let usMajor = 0
let gotTraces = 0
let gotText = 0
let gotTextNoEnglish = 0
let gotImageSize = 0
let emptyLabels = 0
let emptyAdditives = 0
let emptyAllergens = 0

const droppedLabelTags = new Map<string, number>()
const keptLabelTags = new Map<string, number>()
const nonEnumberTags = new Map<string, number>()
const langSeen = new Map<string, number>()
const imageSizeShape = new Map<string, number>()
const samples: string[] = []
function bump(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) ?? 0) + 1)
}
function top(m: Map<string, number>, n = 25): [string, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

// --------------------------------------------------- the products we want --
// upc -> product id, for every product that still needs this pass.
const wanted = new Map<string, string>()

async function loadWanted() {
  // WHY THE WHOLE MAP IS HELD IN MEMORY. 416,382 rows of (upc, id) is about
  // 40 MB of strings, and the alternative is a database round trip per line
  // of a 4-million-line file. backfill-off-images.ts made the same trade for
  // the same reason.
  //
  // RECHECK DECIDES WHAT "STILL NEEDS THIS PASS" MEANS. Without it we skip
  // products that already have a checkedAt for every group being run, which
  // makes a re-run after an interrupted pass cheap. With it, everything is
  // revisited — needed after the KEEP_LABEL allowlist changes, because a
  // product whose only tags were dropped last time looks identical to one
  // whose label genuinely claims nothing.
  const where: Record<string, unknown> = { upc: { not: null } }
  if (!RECHECK) {
    const unchecked: Record<string, unknown>[] = []
    if (GROUPS.has('labels')) unchecked.push({ labelClaimsCheckedAt: null })
    if (GROUPS.has('additives')) unchecked.push({ additivesCheckedAt: null })
    if (GROUPS.has('allergens')) unchecked.push({ labelAllergensCheckedAt: null })
    if (GROUPS.has('text')) unchecked.push({ ingredientsTextRawCheckedAt: null })
    where.OR = unchecked
  }

  let cursor: string | null = null
  for (;;) {
    const page: { id: string; upc: string | null }[] = await prisma.product.findMany({
      where,
      select: { id: true, upc: true },
      orderBy: { id: 'asc' },
      take: 10_000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (page.length === 0) break
    for (const row of page) if (row.upc) wanted.set(row.upc, row.id)
    cursor = page[page.length - 1].id
  }
}

// ------------------------------------------------------------- extraction --
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

// THE INGREDIENT TEXT, AND WHICH LANGUAGE IT IS IN.
//
// The export has a text field per language plus an unsuffixed
// `ingredients_text`, and the unsuffixed one is NOT reliably English: it is
// whatever the record's own `lang` is. That is the whole Norwegian-Snickers
// bug (item 36) — our importer read the unsuffixed field and stored Norwegian
// ingredient names on US products, creating rows that join to nothing.
//
// So this prefers the explicitly English field, falls back to the unsuffixed
// one, and ALWAYS records which language it actually got. A row whose text is
// not English is not discarded: it is stored with its language, so a later
// pass can decide what to do with it instead of us guessing now. 4.4% of
// records are in that state.
function pickIngredientText(p: Record<string, unknown>): { text: string | null; lang: string | null } {
  const en = nonEmptyString(p.ingredients_text_en)
  if (en) return { text: en, lang: 'en' }
  const plain = nonEmptyString(p.ingredients_text)
  if (plain) {
    const lang = nonEmptyString(p.lang) ?? nonEmptyString(p.lc)
    return { text: plain, lang: lang ?? null }
  }
  return { text: null, lang: null }
}

// IMAGE DIMENSIONS, IF THE EXPORT HAS THEM.
//
// The probe did not measure this, which is why the code is defensive and why
// the log reports what it found. OFF's `images` object has a per-image
// `sizes` map keyed by width ("400", "full"), and the full entry carries `w`
// and `h`. If that shape is absent this returns null and the column stays
// null, which is the honest answer rather than a guessed aspect ratio.
function pickImageSize(p: Record<string, unknown>): { w: number; h: number } | null {
  const images = p.images
  if (!images || typeof images !== 'object') {
    bump(imageSizeShape, 'no images object')
    return null
  }
  const front = (images as Record<string, unknown>).front_en ?? (images as Record<string, unknown>).front
  if (!front || typeof front !== 'object') {
    bump(imageSizeShape, 'images object, no front entry')
    return null
  }
  const sizes = (front as Record<string, unknown>).sizes
  if (!sizes || typeof sizes !== 'object') {
    bump(imageSizeShape, 'front entry, no sizes')
    return null
  }
  const full = (sizes as Record<string, unknown>).full
  const cand = full && typeof full === 'object' ? (full as Record<string, unknown>) : null
  const w = cand && typeof cand.w === 'number' ? cand.w : null
  const h = cand && typeof cand.h === 'number' ? cand.h : null
  if (w && h) {
    bump(imageSizeShape, 'full sizes with w and h')
    return { w, h }
  }
  bump(imageSizeShape, 'sizes present, no usable w/h')
  return null
}

type Pending = {
  id: string
  code: string
  labelClaims: string[]
  additiveENumbers: string[]
  labelAllergens: string[]
  labelAllergenTraces: string[]
  ingredientsTextRaw: string | null
  ingredientsTextLang: string | null
  imageWidth: number | null
  imageHeight: number | null
}
let batch: Pending[] = []

// A cheap pre-filter so we do not JSON.parse 4 million lines to discard most
// of them. Same trick as backfill-off-images.ts.
const CODE_RE = /"code"\s*:\s*"(\d+)"/

function processLine(line: string): Pending | null {
  const m = CODE_RE.exec(line)
  if (!m) return null
  const code = m[1]

  // MATCHING A BARCODE TO ONE OF OURS, in the order backfill-off-images.ts
  // established. Product.upc is the OFF code put through normalizeUpc, which
  // expands an 8-digit UPC-E to 13 digits and strips a GTIN-14's leading
  // zero — transformations no amount of zero-padding reverses. The first
  // image pass used three hand-rolled variants instead of the project's own
  // normaliser and left 42,053 products unmatched, products that had come
  // from this very export. The cheap lookups run first only because
  // normalizeUpc runs a check-digit loop we would rather not pay 4 million
  // times.
  let id = wanted.get(code)
  if (!id) id = wanted.get(code.padStart(13, '0'))
  if (!id) id = wanted.get(code.replace(/^0+/, ''))
  if (!id) {
    const n = normalizeUpc(code)
    if (n.ok) {
      id = wanted.get(n.upc)
      if (id) matchedByNormalising++
    }
  }
  if (!id) return null

  let p: Record<string, unknown>
  try {
    p = JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
  parsed++
  matched++

  const out: Pending = {
    id,
    code,
    labelClaims: [],
    additiveENumbers: [],
    labelAllergens: [],
    labelAllergenTraces: [],
    ingredientsTextRaw: null,
    ingredientsTextLang: null,
    imageWidth: null,
    imageHeight: null,
  }

  if (GROUPS.has('labels')) {
    for (const t of strArray(p.labels_tags)) {
      if (KEEP_LABEL.has(t)) {
        out.labelClaims.push(t)
        bump(keptLabelTags, t)
      } else {
        bump(droppedLabelTags, t)
      }
    }
    if (out.labelClaims.length > 0) gotLabels++
    else emptyLabels++
  }

  if (GROUPS.has('additives')) {
    for (const t of strArray(p.additives_tags)) {
      if (ENUMBER_TAG.test(t)) out.additiveENumbers.push(t)
      else bump(nonEnumberTags, t)
    }
    if (out.additiveENumbers.length > 0) gotAdditives++
    else emptyAdditives++
  }

  if (GROUPS.has('allergens')) {
    out.labelAllergens = strArray(p.allergens_tags)
    out.labelAllergenTraces = strArray(p.traces_tags)
    if (out.labelAllergens.length > 0) {
      gotAllergens++
      if (out.labelAllergens.some((a) => US_MAJOR_ALLERGENS.has(a))) {
        // counted below in the report, via usMajor
        usMajor++
      }
    } else {
      emptyAllergens++
    }
    if (out.labelAllergenTraces.length > 0) gotTraces++
  }

  if (GROUPS.has('text')) {
    const t = pickIngredientText(p)
    out.ingredientsTextRaw = t.text
    out.ingredientsTextLang = t.lang
    if (t.text) {
      gotText++
      bump(langSeen, t.lang ?? '(none)')
      if (t.lang !== 'en') gotTextNoEnglish++
    }
  }

  // NOT INSIDE A GROUP. Dimensions were briefly folded into the `text` group
  // because both were added in the same pass, which is exactly the kind of
  // accidental coupling that makes --only text do something nobody expects.
  // Measuring the shape is also free and the log question it answers —
  // whether the export carries sizes at all — is worth answering on every run.
  const size = pickImageSize(p)
  if (size) {
    out.imageWidth = size.w
    out.imageHeight = size.h
    gotImageSize++
  }

  if (samples.length < 8) {
    samples.push(
      `    ${code}  labels=${JSON.stringify(out.labelClaims)} additives=${out.additiveENumbers.length} ` +
        `allergens=${JSON.stringify(out.labelAllergens)} lang=${out.ingredientsTextLang ?? '-'}`
    )
  }
  return out
}

// ------------------------------------------------------------------ write --
async function flushBatch() {
  if (batch.length === 0) return
  const rows = batch
  batch = []
  if (DRY_RUN) {
    batchesWritten++
    return
  }

  const now = new Date()
  try {
    await prisma.$transaction(
      rows.map((r) => {
        const data: Record<string, unknown> = {}

        // EVERY checkedAt BELOW IS UNCONDITIONAL, and that is the single most
        // important line in this file. It is NOT inside an `if (found)`.
        //
        // We read the export for this product. Whether or not the label
        // claimed anything, the answer "we looked" is now a fact, and the
        // site needs to be able to say it. Putting these inside a
        // found-something branch is exactly the bug that left 34,624
        // products stamped "never looked" for their photograph, and the one
        // this script was written to not repeat.
        if (GROUPS.has('labels')) {
          data.labelClaims = r.labelClaims
          data.labelClaimsSource = SOURCE
          data.labelClaimsCheckedAt = now
        }
        if (GROUPS.has('additives')) {
          data.additiveENumbers = r.additiveENumbers
          data.additivesSource = SOURCE
          data.additivesCheckedAt = now
        }
        if (GROUPS.has('allergens')) {
          data.labelAllergens = r.labelAllergens
          data.labelAllergenTraces = r.labelAllergenTraces
          data.labelAllergensSource = SOURCE
          data.labelAllergensCheckedAt = now
        }
        if (GROUPS.has('text')) {
          data.ingredientsTextRaw = r.ingredientsTextRaw
          data.ingredientsTextLang = r.ingredientsTextLang
          data.ingredientsTextRawSource = SOURCE
          data.ingredientsTextRawCheckedAt = now
        }

        // DIMENSIONS ARE THE ONE EXCEPTION TO "WRITE WHAT WE FOUND", and the
        // only field here not governed by a checkedAt of its own: they are
        // set only when we actually have numbers. Writing null over a
        // measured size, because this export entry happens to lack a sizes
        // block, would destroy information we already held — and unlike
        // the arrays above, "no dimensions" is not a claim anyone reads.
        // imageCheckedAt already governs whether the photo was looked for.
        if (r.imageWidth && r.imageHeight) {
          data.imageWidth = r.imageWidth
          data.imageHeight = r.imageHeight
        }
        return prisma.product.update({ where: { id: r.id }, data })
      })
    )
    batchesWritten++
  } catch (err) {
    batchesFailed++
    log(`  !! batch of ${rows.length} failed: ${(err as Error).message}`)
  }
}

// ------------------------------------------------------------------ input --
async function* readLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  // Pull-based so memory stays flat on a 7 GB gzip stream.
  const decoder = new StringDecoder('utf8')
  let carry = ''
  for await (const chunk of stream) {
    carry += decoder.write(chunk as Buffer)
    let nl = carry.indexOf('\n')
    while (nl !== -1) {
      yield carry.slice(0, nl)
      carry = carry.slice(nl + 1)
      nl = carry.indexOf('\n')
    }
  }
  carry += decoder.end()
  if (carry) yield carry
}

async function main() {
  if (!FILE) {
    console.error('Usage: npx tsx scripts/backfill-off-export.ts <export.jsonl.gz> [--live]')
    process.exit(1)
  }
  if (!fs.existsSync(FILE)) {
    console.error(`Not found: ${FILE}`)
    process.exit(1)
  }

  log(`Backfilling from ${FILE}`)
  log(DRY_RUN ? 'DRY RUN — nothing will be written. Pass --live to write.' : 'LIVE — writing to the database.')
  log(`Groups: ${[...GROUPS].join(', ')}${RECHECK ? '   (--recheck: revisiting already-checked products)' : ''}`)
  log('')

  log('Loading the products that still need this pass...')
  await loadWanted()
  log(`  ${wanted.size.toLocaleString()} products with a barcode to match against`)
  if (wanted.size === 0) {
    log('  Nothing to do. Every product already has a checkedAt for these groups.')
    log('  Pass --recheck to revisit them.')
    await prisma.$disconnect()
    return
  }
  log('')

  const started = Date.now()
  const input = fs.createReadStream(FILE).pipe(zlib.createGunzip())
  for await (const raw of readLines(input)) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    linesRead++
    if (line.trim()) {
      const pending = processLine(line)
      if (pending) {
        batch.push(pending)
        if (batch.length >= BATCH_SIZE) await flushBatch()
      }
    }
    if (linesRead % PROGRESS_EVERY === 0) {
      const mins = ((Date.now() - started) / 60000).toFixed(1)
      log(`  ${linesRead.toLocaleString()} lines, ${matched.toLocaleString()} matched (${mins} min)`)
    }
    if (matched >= LIMIT) {
      log(`  --limit ${LIMIT} reached, stopping early.`)
      break
    }
  }
  await flushBatch()

  const mins = ((Date.now() - started) / 60000).toFixed(1)
  log('')
  log(`===== RESULT (${mins} min) =====`)
  log(`  lines read:                 ${linesRead.toLocaleString()}`)
  log(`  records parsed:             ${parsed.toLocaleString()}`)
  log(`  matched to our products:    ${matched.toLocaleString()}`)
  log(`    ...only via normalizeUpc: ${matchedByNormalising.toLocaleString()}`)
  log(`  batches written:            ${batchesWritten.toLocaleString()}${DRY_RUN ? ' (dry run — counted, not sent)' : ''}`)
  if (batchesFailed > 0) log(`  !! batches FAILED:          ${batchesFailed.toLocaleString()}`)
  log('')
  log('  WHAT EACH GROUP GAINED (and what it correctly recorded as empty):')
  if (GROUPS.has('labels')) {
    log(`    label claims kept:        ${gotLabels.toLocaleString()} products`)
    log(`      ...label claims nothing: ${emptyLabels.toLocaleString()}  → stamped "we looked", not "nobody looked"`)
  }
  if (GROUPS.has('additives')) {
    log(`    additive e-numbers:       ${gotAdditives.toLocaleString()} products`)
    log(`      ...no additives listed: ${emptyAdditives.toLocaleString()}`)
  }
  if (GROUPS.has('allergens')) {
    log(`    "Contains:" statements:   ${gotAllergens.toLocaleString()} products`)
    log(`      ...naming a US major:   ${usMajor.toLocaleString()}`)
    log(`    "may contain" traces:     ${gotTraces.toLocaleString()} products`)
    log(`      ...no allergens listed: ${emptyAllergens.toLocaleString()}`)
  }
  if (GROUPS.has('text')) {
    log(`    raw ingredient text:      ${gotText.toLocaleString()} products`)
    log(`      ...NOT in English:      ${gotTextNoEnglish.toLocaleString()}  → item 36, now visible instead of silent`)
  }
  log(`    image dimensions:         ${gotImageSize.toLocaleString()} products`)

  {
    log('')
    log('  DOES THE EXPORT CARRY IMAGE SIZES? (the probe never measured this)')
    for (const [shape, n] of top(imageSizeShape, 8)) {
      log(`    ${String(n).padStart(9)}  ${shape}`)
    }
    log('    If "full sizes with w and h" is large, item 32 is a small addition')
    log('    to backfill-off-images.ts. If it is zero, the dimensions have to')
    log('    come from somewhere else and the columns stay null meanwhile.')
  }
  if (GROUPS.has('text')) {
    log('')
    log('  INGREDIENT TEXT LANGUAGE:')
    for (const [lang, n] of top(langSeen, 12)) log(`    ${String(n).padStart(9)}  ${lang}`)
  }

  if (GROUPS.has('labels')) {
    log('')
    log('  LABEL TAGS KEPT:')
    for (const [t, n] of top(keptLabelTags, 20)) log(`    ${String(n).padStart(9)}  ${t}`)
    log('')
    log('  LABEL TAGS SEEN AND NOT KEPT — widen KEEP_LABEL on evidence, not guesswork:')
    for (const [t, n] of top(droppedLabelTags, 25)) log(`    ${String(n).padStart(9)}  ${t}`)
  }

  if (GROUPS.has('additives') && nonEnumberTags.size > 0) {
    log('')
    log('  additives_tags THAT ARE NOT E-NUMBERS, and were therefore dropped:')
    for (const [t, n] of top(nonEnumberTags, 15)) log(`    ${String(n).padStart(9)}  ${t}`)
  }

  log('')
  log('  SAMPLES:')
  for (const s of samples) log(s)

  log('')
  if (DRY_RUN) {
    log('  DRY RUN. Nothing was written. Read the tag lists above before --live:')
    log('  the KEEP_LABEL allowlist is the one judgement call in this script,')
    log('  and a tag dropped here is a claim the site will never be able to make.')
  } else {
    log('  WHAT IS STILL NOT DONE, so the next session does not have to rediscover it:')
    log('    - the nested ingredient tree and Ingredient.offTaxonomyId (item 39,')
    log('      item 28) need their own script and their own dry run.')
    log('    - the image three-state re-run for the 34,624 products stamped')
    log('      "never looked" belongs in backfill-off-images.ts, not here.')
  }
  log('')
  log(`Log written to ${LOG_FILE}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  log(`FAILED: ${(e as Error).message}`)
  await prisma.$disconnect()
  process.exit(1)
})

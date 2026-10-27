// BACKFILL generic_name AND quantity from the Open Food Facts data export.
//
// WHY. Michael, on Vercel comments Tm_0VJusD8nD and WoEtf4NLax-m: product
// titles are often useless. Measured across the catalogue:
//
//   2,015  products whose name IS their company's name ("Celsius")
//   8,424  names of six characters or fewer ("Berry")
//   6,108  ALL CAPS
//  20,930  a single word
//
// These are crowdsourced OFF titles. We cannot fix them by writing better
// ones — that is inventing a name the record does not carry, which is the
// one thing this project does not do. What we can do is record two fields
// OFF already holds and let the display compose: "Celsius" plus the generic
// name "Energy drink" plus the quantity "12 fl oz".
//
// THIS SCRIPT ONLY STORES. It changes no display code and no product name.
// That is deliberate and it is the whole point of running it first: nobody
// knows yet how often OFF actually carries these fields FOR THE PRODUCTS
// THAT HAVE THE PROBLEM. The dry run answers that before anyone designs a
// display around it — the r27 lesson, which cost a wrong plan once already:
// a fill rate measured across the catalogue tells you nothing about a
// subset that was selected for being bad.
//
// So the report breaks the fill rate down BY NAME WEAKNESS, not just
// overall. If short-named products turn out to have no generic_name, this
// whole line of work is dead and the dry run is what says so.
//
// GET THE FILE (the same export the images backfill uses; ~13 GB):
//   https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz
//
// USAGE, in this order:
//   npx prisma generate
//       RUN THIS FIRST, once, after the migration that added the four
//       columns. The generated client only rebuilds on `npm install` or when
//       asked; until it does, every query here fails validation with
//       "Unknown argument genericNameCheckedAt".
//   npx tsc --noEmit
//       Catches the TS2448 class of bug that neither selftest nor dry run
//       can reach.
//   npx tsx scripts/backfill-off-names.ts --selftest
//       Field priority and the junk guards, against hand-written records.
//       No database, no file, one second.
//   npx tsx scripts/backfill-off-names.ts ./data/openfoodfacts-products.NEW.jsonl.gz
//       Dry run (default). Writes nothing. READ THE FILL-RATE TABLE.
//   npx tsx scripts/backfill-off-names.ts <file> --live --limit 2000
//       Trial.
//   npx tsx scripts/backfill-off-names.ts <file> --live
//       Full backfill.
//   Options:
//       --batch 500   products per database write (default 500)
//       --recheck     every product with a barcode, not just unchecked ones
//
// SAFE TO RE-RUN: by default it only loads products whose
// genericNameCheckedAt is null, so an interrupted run continues where it
// stopped.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { StringDecoder } from 'string_decoder'
import * as zlib from 'zlib'
import { normalizeUpc } from '@/lib/upc'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
// queryPlanCacheMaxSize: 0 — every batch embeds different values, so cached
// plans are never reused and the cache grows until the process dies. Same
// reason as backfill-off-images.ts and bulk-import-off.ts.
const clientOptions = {
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0]
const prisma = new PrismaClient(clientOptions)

// --- CONFIG ---
const args = process.argv.slice(2)
const FILE = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a))
const DRY_RUN = !args.includes('--live')
const RECHECK = args.includes('--recheck')
function argValue(name: string): string | null {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] ?? null : null
}
const LIMIT = argValue('--limit') ? Number(argValue('--limit')) : Infinity
const BATCH_SIZE = argValue('--batch') ? Number(argValue('--batch')) : 500
const SOURCE = 'open_food_facts'
const INGESTION_SOURCE = 'open_food_facts_names'
const PROGRESS_EVERY = 250_000

// A generic name longer than this is prose, not a name. The longest
// legitimate one in a spot check was "sweetened condensed skimmed milk with
// vegetable fat" at 52 characters; 120 leaves room and still excludes the
// records where somebody pasted an ingredient list into the field.
const MAX_GENERIC_LEN = 120

// --- LOGGING (written as it goes: a long run that dies must still leave a
// record of how far it got) ---
const LOG_FILE = path.join(
  './logs',
  `${DRY_RUN ? 'backfill-off-names-dryrun' : 'backfill-off-names'}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
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
function logError(...parts: unknown[]) {
  const line = parts
    .map((a) =>
      a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a)
    )
    .join(' ')
  console.error(line)
  writeLine('[ERROR] ' + line)
}

// Keeps a short string from retaining the whole multi-megabyte line it was
// sliced out of. Same helper, same reason, as the other export scripts.
function detach(s: string): string {
  return (' ' + s).slice(1)
}

// WHERE THE LOG IS, SAID BEFORE ANYTHING ELSE HAPPENS.
//
// Michael, 2026-10-27: "for scripts like this in the future please add a log
// function so i dont have to copy and paste". The log was always being
// written — this script just never said so, which made the terminal the only
// obvious place to read it from. backfill-off-images.ts prints its path at
// the end and that is where the habit came from; printing it at the START
// too matters more, because a run that dies halfway still leaves a file worth
// reading and the terminal scrollback may not survive.
//
// At module scope on purpose: this runs before main(), so it prints even if
// argument parsing or the database connection throws.
log(`Log file: ${path.resolve(LOG_FILE)}`)


// --- WHICH PRODUCTS, AND WHICH OF THEM HAVE THE PROBLEM ---
//
// The weakness flags are computed from Product.name alone, on purpose. The
// "name IS the company name" signal would need a join to Company, and
// single-word already covers most of that population — "Celsius" is both.
// Keeping this to one unjoined column keeps loadWanted at the shape that
// was measured at 2.6 s against the 30 s role statement_timeout.
const WEAK_SHORT = 1 // six characters or fewer
const WEAK_ONE_WORD = 2 // no whitespace
const WEAK_ALL_CAPS = 4 // no lowercase letter, and has a letter

function weaknessOf(name: string): number {
  const t = name.trim()
  let w = 0
  if (t.length <= 6) w |= WEAK_SHORT
  if (!/\s/.test(t)) w |= WEAK_ONE_WORD
  if (/[A-Za-z]/.test(t) && t === t.toUpperCase()) w |= WEAK_ALL_CAPS
  return w
}

type Target = { id: string; name: string; weak: number }
const wanted = new Map<string, Target>()

async function loadWanted() {
  let products: { id: string; upc: string | null; name: string }[]
  try {
    products = await prisma.product.findMany({
      where: RECHECK
        ? { upc: { not: null } }
        : { upc: { not: null }, genericNameCheckedAt: null },
      select: { id: true, upc: true, name: true },
    })
  } catch (e) {
    // The columns exist in the database and in schema.prisma, but the
    // generated client is a separate build step. If it predates the
    // migration, every query naming a new column fails validation — which
    // looks like a bug in this script and isn't.
    if (e instanceof Error && /Unknown argument .?generic/i.test(e.message)) {
      logError('The generated Prisma client does not know about the name columns yet.')
      logError('Run this first, then re-run this script:')
      logError('    npx prisma generate')
      throw new Error('Prisma client is out of date — run `npx prisma generate`')
    }
    throw e
  }
  for (const p of products) {
    if (!p.upc) continue
    wanted.set(detach(p.upc), {
      id: p.id,
      name: detach(p.name),
      weak: weaknessOf(p.name),
    })
  }
  log(
    `Looking for ${wanted.size.toLocaleString()} products` +
      (RECHECK ? ' (--recheck: every product with a barcode).' : ' whose names have never been checked.')
  )
}

// --- COUNTERS ---
let linesRead = 0
let matched = 0
let gotGeneric = 0
let gotQuantity = 0
let gotNeither = 0
let matchedByNormalising = 0
let batchesWritten = 0
let batchesFailed = 0
const fieldUsed = new Map<string, number>()
const rejectReason = new Map<string, number>()
let quantityNumericOnly = 0
const samples: string[] = []

// THE TABLE THE DRY RUN EXISTS FOR. For each class of weak name: how many
// we looked at, and how many gained a generic name or a quantity.
type Tally = { seen: number; generic: number; quantity: number; either: number }
function emptyTally(): Tally {
  return { seen: 0, generic: 0, quantity: 0, either: 0 }
}
const byClass = new Map<string, Tally>([
  ['all products', emptyTally()],
  ['name <= 6 chars', emptyTally()],
  ['single word', emptyTally()],
  ['ALL CAPS', emptyTally()],
  ['any weakness', emptyTally()],
  ['no weakness', emptyTally()],
])
function tally(label: string, g: boolean, q: boolean) {
  const t = byClass.get(label)
  if (!t) return
  t.seen++
  if (g) t.generic++
  if (q) t.quantity++
  if (g || q) t.either++
}

function bump(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) ?? 0) + 1)
}

// --- PICKING THE GENERIC NAME ---
//
// ENGLISH ONLY, DELIBERATELY. The images backfill falls back to any
// language, because a photograph is a photograph whatever the record's
// language. A NAME is not: putting "boisson énergisante" on an
// English-language page is worse than putting nothing, because it reads as
// our text rather than as a transcription. Phase 1 established only 81
// products are genuinely non-English, so the cost of this restriction is
// tiny and the count is reported either way.
type Found = { value: string; field: string }

function pickGeneric(p: Record<string, unknown>, productName: string): Found | null {
  const lang = typeof p.lang === 'string' ? p.lang : typeof p.lc === 'string' ? p.lc : null

  const candidates: [string, unknown][] = [
    ['generic_name_en', p.generic_name_en],
    // Bare generic_name only counts as English when the record says it is,
    // or says nothing at all. A record marked lang:"fr" with a bare
    // generic_name is French.
    ...(lang === null || lang === 'en' ? ([['generic_name', p.generic_name]] as [string, unknown][]) : []),
  ]

  for (const [field, raw] of candidates) {
    if (typeof raw !== 'string') continue
    const v = raw.trim()
    if (!v) continue
    const reason = rejectGeneric(v, productName)
    if (reason) {
      bump(rejectReason, reason)
      continue
    }
    return { value: v, field }
  }

  // Nothing English, but something in another language — a real finding,
  // distinct from "OFF has no generic name at all".
  if (lang !== null && lang !== 'en' && typeof p.generic_name === 'string' && p.generic_name.trim()) {
    bump(rejectReason, `non-English generic_name (lang=${lang})`)
  }
  return null
}

// THE JUNK GUARDS. OFF's generic_name is a free-text crowdsourced field and
// a good proportion of it adds nothing or actively misleads.
function rejectGeneric(v: string, productName: string): string | null {
  const a = norm(v)
  const b = norm(productName)
  if (!a) return 'empty after normalising'
  if (a === b) return 'identical to the product name'
  // Contained in the name already: name "Celsius Energy Drink", generic
  // "Energy Drink" — true, and it adds nothing a reader cannot see. Note the
  // direction: the REVERSE (generic contains name) is the useful case and
  // must not be caught here, which is the whole reason this is one-sided.
  if (b.includes(a)) return 'already inside the product name'
  if (v.length > MAX_GENERIC_LEN) return `longer than ${MAX_GENERIC_LEN} chars (prose, not a name)`
  // A generic name that is only digits, punctuation and units is a quantity
  // that was typed into the wrong field.
  if (!/[a-z]{3}/i.test(a)) return 'no word of three or more letters'
  return null
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// --- PICKING THE QUANTITY ---
//
// `quantity` is the net contents AS PRINTED, which is what we want: it is a
// transcription. OFF also holds product_quantity + product_quantity_unit,
// which is OFF's own normalisation — "355" + "g". Composing "355 g" from
// those would be our derivation of the package rather than the package's own
// words, so this counts that case and reports it instead of writing it. If
// the dry run shows it is far more common than `quantity`, that is a
// decision for Michael, not a default for this script to take.
function pickQuantity(p: Record<string, unknown>): Found | null {
  const raw = p.quantity
  if (typeof raw === 'string') {
    const v = raw.trim()
    // Keep it short: a few records have a sentence here.
    if (v && v.length <= 40 && /\d/.test(v)) return { value: v, field: 'quantity' }
    if (v) bump(rejectReason, v.length > 40 ? 'quantity longer than 40 chars' : 'quantity has no digit')
  }
  if (typeof p.product_quantity === 'string' || typeof p.product_quantity === 'number') {
    quantityNumericOnly++
  }
  return null
}

// Pulls the barcode out of the raw line WITHOUT parsing it. JSON.parse on
// every one of ~4.8 million lines is the most expensive thing this script
// could do, so the barcode is read with a regex and the line is parsed only
// when it turns out to be one of ours. Falls back to a full parse if the
// regex misses, so an unusual field order cannot silently drop records.
const CODE_RE = /"code"\s*:\s*"(\d+)"/

// --- ONE BATCH ---
type Pending = { id: string; generic: string | null; quantity: string | null }
let batch: Pending[] = []

function processLine(line: string) {
  linesRead++

  const quick = CODE_RE.exec(line)
  let p: Record<string, unknown> | null = null
  let code: string | null = quick ? quick[1] : null

  if (!code) {
    try {
      p = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    code = typeof p.code === 'string' ? p.code : null
    if (!code) return
  }

  // Our Product.upc is the OFF code put through normalizeUpc, which expands
  // 8-digit UPC-E to 13 and strips a GTIN-14's leading zero — things no
  // amount of zero-padding reverses. The cheap lookups go first because they
  // catch most rows and normalizeUpc runs a check-digit loop we would rather
  // not pay millions of times. Reusing the project's own normaliser is what
  // rescued 7,860 matches in the images pass.
  let key: string | undefined
  let t = wanted.get(code)
  if (t) key = code
  if (!t) {
    const padded = code.padStart(13, '0')
    t = wanted.get(padded)
    if (t) key = padded
  }
  if (!t) {
    const stripped = code.replace(/^0+/, '')
    t = wanted.get(stripped)
    if (t) key = stripped
  }
  if (!t) {
    const n = normalizeUpc(code)
    if (n.ok) {
      t = wanted.get(n.upc)
      if (t) {
        key = n.upc
        matchedByNormalising++
      }
    }
  }
  if (!t || !key) return

  if (!p) {
    try {
      p = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
  }
  if (!p) return

  matched++

  const g = pickGeneric(p, t.name)
  const q = pickQuantity(p)

  if (g) {
    gotGeneric++
    bump(fieldUsed, g.field)
  }
  if (q) gotQuantity++
  if (!g && !q) gotNeither++

  // The fill-rate table, by name weakness.
  tally('all products', !!g, !!q)
  if (t.weak & WEAK_SHORT) tally('name <= 6 chars', !!g, !!q)
  if (t.weak & WEAK_ONE_WORD) tally('single word', !!g, !!q)
  if (t.weak & WEAK_ALL_CAPS) tally('ALL CAPS', !!g, !!q)
  tally(t.weak === 0 ? 'no weakness' : 'any weakness', !!g, !!q)

  // Samples are drawn from the weak-named products specifically, because
  // those are the ones this work is for. A sample of healthy names would
  // look fine and prove nothing.
  if (samples.length < 20 && t.weak !== 0 && (g || q)) {
    samples.push(
      detach(
        `${code}  name="${t.name}"  generic="${g?.value ?? '-'}"  qty="${q?.value ?? '-'}"`
      )
    )
  }

  batch.push({
    id: t.id,
    generic: g ? detach(g.value) : null,
    quantity: q ? detach(q.value) : null,
  })

  // Found once; never look again. Deleting `key` rather than `code` matters:
  // when the match came from a padded or normalised form, deleting the raw
  // code removes nothing, leaving the entry in the map for the rest of the
  // run and inflating the "never found" total the report ends with.
  wanted.delete(key)
}

// Writes the pending batch in ONE statement. Prisma has no "update many rows
// to different values" call, and hundreds of thousands of individual updates
// would take hours. This is a single UPDATE ... FROM (VALUES ...).
async function flushBatch() {
  if (batch.length === 0) return
  const rows = batch
  batch = []
  if (DRY_RUN) {
    batchesWritten++
    return
  }

  // Every value is cast. In a VALUES list Postgres infers column types from
  // the first row, and a NULL it cannot type makes the whole statement fail
  // with "could not determine data type of parameter".
  const values = rows.map(
    (r) => Prisma.sql`(${r.id}::text, ${r.generic}::text, ${r.quantity}::text)`
  )

  try {
    // NOW() AT TIME ZONE 'UTC' because genericNameCheckedAt is `timestamp
    // without time zone`: a bare NOW() is timestamptz and would be converted
    // using the session's timezone rather than UTC.
    await prisma.$executeRaw`
      UPDATE "Product" AS p
         SET "genericName"          = v.generic_name,
             "quantity"             = v.quantity,
             "genericNameSource"    = CASE
                                        WHEN v.generic_name IS NULL AND v.quantity IS NULL
                                        THEN NULL ELSE ${SOURCE}::text
                                      END,
             "genericNameCheckedAt" = (NOW() AT TIME ZONE 'UTC')
        FROM (VALUES ${Prisma.join(values)}) AS v(id, generic_name, quantity)
       WHERE p.id = v.id
    `
    batchesWritten++
  } catch (e) {
    batchesFailed++
    logError(`Batch of ${rows.length} failed:`, e)
  }
}

async function* readLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  // Pulls from the stream rather than being pushed at: while a batch is
  // written the file waits, so memory stays flat.
  const decoder = new StringDecoder('utf8')
  let carry = ''
  for await (const chunk of stream) {
    carry += decoder.write(chunk as Buffer)
    let newline = carry.indexOf('\n')
    while (newline !== -1) {
      yield carry.slice(0, newline)
      carry = carry.slice(newline + 1)
      newline = carry.indexOf('\n')
    }
  }
  carry += decoder.end()
  if (carry) yield carry
}

function top(m: Map<string, number>, n: number): string {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `    ${v.toLocaleString().padStart(9)}  ${k}`)
    .join('\n')
}

function pct(a: number, b: number): string {
  return b === 0 ? '  n/a' : `${((a / b) * 100).toFixed(1).padStart(5)}%`
}

// --- SELF TEST ---
// Exercises the field priority and every junk guard against records shaped
// like the export's, without the database or the 13 GB file. A wrong field
// name or an inverted guard is then found in a second instead of twenty
// minutes into a pass.
function selfTest(): boolean {
  let failures = 0
  function check(label: string, got: unknown, want: unknown) {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) failures++
    log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}  (expected ${JSON.stringify(want)}, got ${JSON.stringify(got)})`)
  }

  log('\nGeneric name — field priority')
  check(
    'generic_name_en wins',
    pickGeneric({ generic_name_en: 'Energy drink', generic_name: 'Boisson' }, 'Celsius')?.value,
    'Energy drink'
  )
  check(
    'bare generic_name accepted when lang is en',
    pickGeneric({ generic_name: 'Energy drink', lang: 'en' }, 'Celsius')?.value,
    'Energy drink'
  )
  check(
    'bare generic_name accepted when lang is absent',
    pickGeneric({ generic_name: 'Energy drink' }, 'Celsius')?.value,
    'Energy drink'
  )
  check(
    'bare generic_name REJECTED when lang is fr',
    pickGeneric({ generic_name: 'Boisson energisante', lang: 'fr' }, 'Celsius'),
    null
  )
  check(
    'lc is read when lang is absent',
    pickGeneric({ generic_name: 'Boisson', lc: 'fr' }, 'Celsius'),
    null
  )

  log('\nGeneric name — junk guards')
  check('identical to name', rejectGeneric('Celsius', 'Celsius'), 'identical to the product name')
  check(
    'already inside the name',
    rejectGeneric('Energy Drink', 'Celsius Energy Drink'),
    'already inside the product name'
  )
  // THE REGRESSION WITNESS FOR THE ONE-SIDED GUARD. This is the useful
  // direction and an earlier draft caught it by comparing both ways, which
  // would have thrown away every case this work exists to fix.
  check(
    'name inside the generic is KEPT (the useful case)',
    rejectGeneric('Celsius Energy Drink', 'Celsius'),
    null
  )
  check('punctuation-only', rejectGeneric('12 fl oz', 'Berry'), 'no word of three or more letters')
  check(
    'prose',
    rejectGeneric('a'.repeat(MAX_GENERIC_LEN + 1), 'Berry'),
    `longer than ${MAX_GENERIC_LEN} chars (prose, not a name)`
  )
  check('normal case passes', rejectGeneric('Energy drink', 'Celsius'), null)
  check(
    'case and punctuation ignored when comparing',
    rejectGeneric('ENERGY-DRINK', 'Celsius energy drink'),
    'already inside the product name'
  )

  log('\nQuantity')
  check('printed quantity kept', pickQuantity({ quantity: '12 fl oz (355 ml)' })?.value, '12 fl oz (355 ml)')
  check('quantity with no digit rejected', pickQuantity({ quantity: 'family size' }), null)
  check('long quantity rejected', pickQuantity({ quantity: 'x'.repeat(41) }), null)
  check('numeric-only is not composed', pickQuantity({ product_quantity: '355', product_quantity_unit: 'g' }), null)

  log('\nName weakness flags')
  check('short name', weaknessOf('Berry') & WEAK_SHORT ? 'short' : 'no', 'short')
  check('single word', weaknessOf('Celsius') & WEAK_ONE_WORD ? 'one' : 'no', 'one')
  check('all caps', weaknessOf('ORGANIC MILK') & WEAK_ALL_CAPS ? 'caps' : 'no', 'caps')
  check('healthy name has no flags', weaknessOf('Organic Whole Milk, 1 gal'), 0)

  log(failures === 0 ? '\nAll self-tests passed.' : `\n${failures} self-test(s) FAILED.`)
  return failures === 0
}

async function main() {
  if (args.includes('--selftest')) {
    log('SELF TEST — no database, no export file')
    if (!selfTest()) process.exitCode = 1
    return
  }

  if (!FILE || !fs.existsSync(FILE)) {
    logError(`Export file not found: ${FILE ?? '(none given)'}`)
    logError('Pass the path to openfoodfacts-products.jsonl.gz under ./data/.')
    return
  }
  log(
    `${DRY_RUN ? 'DRY RUN' : 'LIVE RUN'} — ${FILE}, batch ${BATCH_SIZE}${LIMIT !== Infinity ? `, limit ${LIMIT}` : ''}${RECHECK ? ', --recheck' : ''}`
  )
  await loadWanted()
  if (wanted.size === 0) {
    log('Nothing to do. Every product with a barcode has been checked — pass --recheck to look again.')
    return
  }

  const started = Date.now()
  const input = fs.createReadStream(FILE).pipe(zlib.createGunzip())

  for await (const rawLine of readLines(input)) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.trim()) processLine(line)
    if (batch.length >= BATCH_SIZE) await flushBatch()
    if (linesRead % PROGRESS_EVERY === 0 && linesRead > 0) {
      const mins = ((Date.now() - started) / 60000).toFixed(1)
      const mb = Math.round(process.memoryUsage().rss / 1024 / 1024)
      log(
        `  ...${linesRead.toLocaleString()} lines read, ${matched.toLocaleString()} of ours found, ${gotGeneric.toLocaleString()} with a generic name, ${gotQuantity.toLocaleString()} with a quantity (${mins} min, ${mb} MB)`
      )
    }
    if (matched >= LIMIT) break
    if (wanted.size === 0) break
  }
  await flushBatch()
  input.destroy()

  const mins = ((Date.now() - started) / 60000).toFixed(1)
  log(`\n===== ${DRY_RUN ? 'DRY RUN — nothing was written' : 'BACKFILL COMPLETE'} (${mins} min) =====`)
  log(`Lines read: ${linesRead.toLocaleString()}`)
  log(`Our products found in the export: ${matched.toLocaleString()}`)
  log(`  gained a generic name: ${gotGeneric.toLocaleString()}`)
  log(`  gained a quantity: ${gotQuantity.toLocaleString()}`)
  log(`  neither: ${gotNeither.toLocaleString()}`)
  log(`Matched only after normalising the barcode: ${matchedByNormalising.toLocaleString()}`)
  log(`Never found in the export: ${wanted.size.toLocaleString()}`)
  log(`Batches ${DRY_RUN ? 'that would be written' : 'written'}: ${batchesWritten}, failed: ${batchesFailed}`)

  // THE TABLE THIS RUN EXISTS FOR.
  log('\nFILL RATE BY NAME WEAKNESS — this is the number that decides whether')
  log('a display change is worth building. A high rate overall means nothing')
  log('if the weak-named products are the ones OFF has nothing for.')
  log('')
  log('    class                 seen      generic     quantity       either')
  for (const [label, t] of byClass) {
    log(
      `    ${label.padEnd(18)} ${t.seen.toLocaleString().padStart(8)}   ` +
        `${t.generic.toLocaleString().padStart(7)} ${pct(t.generic, t.seen)}   ` +
        `${t.quantity.toLocaleString().padStart(7)} ${pct(t.quantity, t.seen)}   ` +
        `${t.either.toLocaleString().padStart(7)} ${pct(t.either, t.seen)}`
    )
  }

  log('\nWhich OFF field the generic name came from:')
  log(top(fieldUsed, 10) || '    (none — this export carries no generic_name this script accepts)')

  if (rejectReason.size > 0) {
    log('\nWhy candidate values were rejected (each one is a value NOT stored):')
    log(top(rejectReason, 12))
  }

  if (quantityNumericOnly > 0) {
    log(
      `\nProducts with OFF's numeric product_quantity but no printed \`quantity\`: ${quantityNumericOnly.toLocaleString()}`
    )
    log('    Not stored. Composing "355 g" from the numeric fields would be our')
    log('    derivation rather than the package\'s own words. If this number is')
    log('    large next to the quantity column above, that is a decision to take')
    log('    deliberately rather than a default to let this script choose.')
  }

  if (samples.length > 0) {
    log('\nSamples, drawn only from products whose names are weak:')
    for (const s of samples) log(`    ${s}`)
  }

  if (!DRY_RUN) {
    await prisma.ingestionLog.create({
      data: {
        source: INGESTION_SOURCE,
        recordsMatched: gotGeneric + gotQuantity,
        fileName: path.basename(FILE),
      },
    })
    log('\nLogged this run to IngestionLog.')
  } else {
    log('\nNothing was written. Read the fill-rate table before running --live.')
  log(`\nLog written to ${path.resolve(LOG_FILE)}`)
  }
}

main()

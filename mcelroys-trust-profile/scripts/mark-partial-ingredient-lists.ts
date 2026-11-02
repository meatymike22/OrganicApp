// MARK THE INGREDIENT LISTS OUR SOURCE CUT OFF.
//
//   npx tsx scripts/mark-partial-ingredient-lists.ts --selftest
//   npx tsx scripts/mark-partial-ingredient-lists.ts            (dry run)
//   npx tsx scripts/mark-partial-ingredient-lists.ts --live
//   npx tsx scripts/mark-partial-ingredient-lists.ts --revert --live
//
// WHAT THIS IS FIXING. 11,920 published products hold an ingredient list that
// Open Food Facts truncated at 255 characters. Every one of them was marked
// `disclosed`, and `disclosed` is the status the whole app reads as permission
// to make claims about what a product does NOT contain. So:
//
//   11,197 asserted `hasHydrogenatedIngredient = false`
//    3,038 printed "Nothing on the label is an additive we track"
//    1,685 showed no allergens
//
// all derived from a list that stops mid-sentence. And the truncation is
// biased against the worst thing to lose: an allergen statement is the LAST
// line of an ingredient list, so a fixed-length cut destroys "CONTAINS: MILK,
// SOY" preferentially.
//
// THE TRUNCATION IS UPSTREAM, NOT OURS. scripts/probe-ingredient-truncation.ts
// re-fetched 40 of these barcodes from the live OFF export: 39 of 40 are
// exactly 255 characters in OFF's own data, against a 40-barcode control
// group that matched our stored length exactly. Our import is faithful and
// there is nothing to re-fetch. The only honest move is to stop claiming the
// list is complete.
//
// WHY LENGTH ALONE IS THE PREDICATE. ~380 products land on each neighbouring
// length naturally; 255 holds 10,072 and 254 holds 1,848. So roughly 780 of
// the ~11,920 matches are complete lists that happen to end there -- about 6%
// false positives. THAT IS THE DELIBERATE DIRECTION. Telling a shopper "we
// cannot be sure this is the whole list" about a list that is in fact whole
// understates what we hold. Telling them "nothing on this label is an
// additive we track" off a list that stops mid-word is a false claim about
// food. Those costs are not symmetrical.
//
// A tighter rule -- length AND ends-mid-word -- would reach ~98% precision
// and miss every list cut at a space or a comma, which are just as truncated.
// Precision is the wrong thing to optimise when a miss is a false negative
// about an allergen.
//
// REVERSIBLE. This only ever moves 'disclosed' -> 'partial' (or back, with
// --revert). It writes no other column and touches no other status, so the
// blast radius is one string on 11,920 rows.

// MUST BE FIRST, before anything reads process.env. Leaving this out is what
// made the first two runs fail with ECONNREFUSED: an undefined
// connectionString does NOT make PrismaPg complain, it makes node-postgres
// quietly fall back to localhost:5432, so a missing .env presents as a
// database that refuses connections. Every other DB script here opens with
// this line.
import 'dotenv/config'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const SELFTEST = argv.includes('--selftest')
const LIVE = argv.includes('--live')
const REVERT = argv.includes('--revert')

// The two lengths OFF cuts at. 255 is the cut; 254 is the same cut with a
// trailing space trimmed afterwards.
const TRUNCATION_LENGTHS = [254, 255]

const LOG_DIR = path.resolve('logs')
fs.mkdirSync(LOG_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const LOG_FILE = path.join(
  LOG_DIR,
  `mark-partial-${SELFTEST ? 'selftest' : REVERT ? 'revert' : LIVE ? 'live' : 'dryrun'}-${stamp}.txt`
)
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
function log(line = '') {
  console.log(line)
  stream.write(line + '\n')
}
function logErr(line: string, e?: unknown) {
  // A Prisma error puts almost nothing useful in `message` -- the first run of
  // this script failed with an "Invalid invocation:" and then a BLANK line,
  // which told us nothing and cost a round trip. `code` and `meta` carry the
  // actual cause, so dump everything.
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : e === undefined ? '' : String(e)
  log(`${line}${msg ? ' ' + msg : ''}`)
  if (e && typeof e === 'object') {
    const any = e as Record<string, unknown>
    if (any.code !== undefined) log(`  code: ${String(any.code)}`)
    if (any.meta !== undefined) log(`  meta: ${JSON.stringify(any.meta)}`)
  }
  if (e instanceof Error && e.stack) log(e.stack)
}
console.log(`Log file: ${LOG_FILE}`)

// Ends mid-word: the last character is a letter with no terminator after it.
// DIAGNOSTIC ONLY -- it is printed so the log carries the evidence, and it is
// deliberately NOT part of the predicate, for the reason given above.
function endsMidWord(s: string): boolean {
  return /[A-Za-z]$/.test(s)
}

function selftest(): boolean {
  const cases: { text: string; len: number; truncated: boolean; mid: boolean }[] = [
    { text: 'a'.repeat(255), len: 255, truncated: true, mid: true },
    { text: 'a'.repeat(254), len: 254, truncated: true, mid: true },
    { text: 'a'.repeat(253), len: 253, truncated: false, mid: true },
    { text: 'a'.repeat(256), len: 256, truncated: false, mid: true },
    { text: 'a'.repeat(254) + '.', len: 255, truncated: true, mid: false },
    { text: 'Water, sugar, salt.', len: 19, truncated: false, mid: false },
  ]
  let pass = 0
  for (const c of cases) {
    const gotLen = c.text.length
    const gotTrunc = TRUNCATION_LENGTHS.includes(gotLen)
    const gotMid = endsMidWord(c.text)
    const okAll = gotLen === c.len && gotTrunc === c.truncated && gotMid === c.mid
    if (okAll) pass++
    else log(`  FAIL len=${gotLen}(want ${c.len}) trunc=${gotTrunc}(want ${c.truncated}) mid=${gotMid}(want ${c.mid})`)
  }
  log(`selftest: ${pass}/${cases.length} pass`)
  return pass === cases.length
}

async function main() {
  if (SELFTEST) {
    const ok = selftest()
    log(`\nLog written to ${LOG_FILE}`)
    process.exitCode = ok ? 0 : 1
    return
  }

  // FAIL LOUDLY, not at localhost. Says what is wrong instead of surfacing as
  // a connection error 30 lines later.
  if (!process.env.DATABASE_URL) {
    log('DATABASE_URL is not set. Is .env present in the project root?')
    process.exitCode = 1
    return
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

  // THE CUT LENGTHS AS SQL. `$queryRaw` tagged templates, not
  // `$queryRawUnsafe`: the first version of this script used Unsafe and died
  // on its very first parameterless query. Every raw query in this repo that
  // works -- classify-product-images.ts, backfill-off-export.ts -- is a
  // tagged template, so this now matches the house convention instead of
  // fighting it. Prisma.join still parameterises the values.
  const LENS = Prisma.join(TRUNCATION_LENGTHS.map((n) => Prisma.sql`${n}`))
  const TRUNCATED = Prisma.sql`"ingredientDisclosureStatus" = 'disclosed' AND length("ingredientsTextRaw") IN (${LENS})`

  try {
    if (REVERT) {
      // COUNT FIRST, WRITE SECOND. An earlier version of this branch ran the
      // UPDATE and then threw to "roll back" -- but nothing here opens a
      // transaction, so the dry run would have written. A dry run that
      // mutates is worse than no dry run, because it is trusted.
      const pending = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "Product" WHERE "ingredientDisclosureStatus" = 'partial'`
      const n = Number(pending[0].n)
      if (!LIVE) {
        log(`DRY RUN. Would revert ${n.toLocaleString()} rows 'partial' -> 'disclosed'. Nothing written.`)
        log(`\nLog written to ${LOG_FILE}`)
        return
      }
      const done = await prisma.$executeRaw`
        UPDATE "Product" SET "ingredientDisclosureStatus" = 'disclosed'
        WHERE "ingredientDisclosureStatus" = 'partial'`
      log(`reverted ${Number(done).toLocaleString()} rows to 'disclosed' (expected ${n.toLocaleString()})`)
      if (Number(done) !== n) {
        log('!! count drifted between read and write -- re-run the dry run before trusting this')
        process.exitCode = 1
      }
      log(`\nLog written to ${LOG_FILE}`)
      return
    }

    // ---- the landscape, before anything is written
    const totals = await prisma.$queryRaw<{ status: string; n: bigint }[]>`
      SELECT "ingredientDisclosureStatus" AS status, count(*) AS n
      FROM "Product" GROUP BY 1 ORDER BY 2 DESC`
    log('DISCLOSURE STATUS, BEFORE')
    for (const r of totals) log(`  ${r.status.padEnd(16)} ${Number(r.n).toLocaleString()}`)

    // ---- length histogram, which is the evidence for the predicate
    const hist = await prisma.$queryRaw<{ len: number; n: bigint }[]>`
      SELECT length("ingredientsTextRaw") AS len, count(*)::int AS n
      FROM "Product"
      WHERE "ingredientDisclosureStatus" = 'disclosed'
        AND "ingredientsTextRaw" IS NOT NULL
        AND length("ingredientsTextRaw") BETWEEN 248 AND 262
      GROUP BY 1 ORDER BY 1`
    log('\nLENGTH HISTOGRAM 248-262 (disclosed only)')
    for (const r of hist) {
      const mark = TRUNCATION_LENGTHS.includes(r.len) ? '  <-- CUT' : ''
      log(`  ${String(r.len).padStart(3)}  ${String(Number(r.n)).padStart(7)}${mark}`)
    }
    const neighbours = hist.filter((r) => !TRUNCATION_LENGTHS.includes(r.len))
    const baseline =
      neighbours.length > 0
        ? neighbours.reduce((a, r) => a + Number(r.n), 0) / neighbours.length
        : 0
    log(`  baseline at neighbouring lengths: ~${Math.round(baseline).toLocaleString()} products each`)

    // ---- the candidates
    const cand = await prisma.$queryRaw<{ n: bigint; midword: bigint; published: bigint }[]>`
      SELECT count(*) AS n,
             count(*) FILTER (WHERE "ingredientsTextRaw" ~ '[A-Za-z]$') AS midword,
             count(*) FILTER (WHERE "publicationStatus" = 'published') AS published
      FROM "Product" WHERE ${TRUNCATED}`
    const c = cand[0]
    const n = Number(c.n)
    log(`\nCANDIDATES: ${n.toLocaleString()}`)
    log(`  published:            ${Number(c.published).toLocaleString()}`)
    log(`  end mid-word:         ${Number(c.midword).toLocaleString()} (${((Number(c.midword) / n) * 100).toFixed(1)}%)`)
    const expectedNatural = Math.round(baseline * TRUNCATION_LENGTHS.length)
    log(`  expected naturally:   ~${expectedNatural.toLocaleString()} -> est. false positives ${((expectedNatural / n) * 100).toFixed(1)}%`)

    // ---- what we'd stop asserting
    const claims = await prisma.$queryRaw<{ nohydro: bigint; noflag: bigint; noallerg: bigint }[]>`
      SELECT count(*) FILTER (WHERE p."hasHydrogenatedIngredient" = false) AS nohydro,
             count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM "ProductIngredient" pi JOIN "Ingredient" i ON i.id = pi."ingredientId"
               WHERE pi."productId" = p.id AND i."flaggedForResearch" = true)) AS noflag,
             count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM "ProductIngredient" pi JOIN "Ingredient" i ON i.id = pi."ingredientId"
               WHERE pi."productId" = p.id AND array_length(i."allergens", 1) > 0)) AS noallerg
      FROM "Product" p WHERE ${TRUNCATED}`
    const cl = claims[0]
    log('\nFALSE CLAIMS THIS RETIRES')
    log(`  asserting no hydrogenated oil:  ${Number(cl.nohydro).toLocaleString()}`)
    log(`  asserting nothing flagged:      ${Number(cl.noflag).toLocaleString()}`)
    log(`  asserting no allergens:         ${Number(cl.noallerg).toLocaleString()}`)

    // ---- the camera queue, which is the other half of the decision
    const photos = await prisma.$queryRaw<{ kind: string; n: bigint }[]>`
      SELECT coalesce("imageKind", '(no photo)') AS kind, count(*) AS n
      FROM "Product" WHERE ${TRUNCATED}
      GROUP BY 1 ORDER BY 2 DESC`
    log('\nPHOTO STATE (drives the ingredient-label request queue)')
    for (const r of photos) log(`  ${r.kind.padEnd(18)} ${Number(r.n).toLocaleString()}`)

    // ---- eyeball sample
    // `upc`, not `barcode`. We SAY barcode everywhere in conversation and in
    // the UI copy, but the column has always been `upc` (nullable, unique).
    const sample = await prisma.$queryRaw<{ upc: string | null; name: string | null; tail: string }[]>`
      SELECT upc, name, right("ingredientsTextRaw", 55) AS tail
      FROM "Product" WHERE ${TRUNCATED}
      ORDER BY upc NULLS LAST LIMIT 15`
    log('\nSAMPLE (last 55 chars -- look for the cut)')
    for (const r of sample) {
      log(`  ${(r.upc ?? '(no upc)').padEnd(14)} ...${r.tail.replace(/\s+/g, ' ')}`)
    }

    // ---- write
    if (!LIVE) {
      log(`\nDRY RUN. Nothing written. Re-run with --live to mark ${n.toLocaleString()} products 'partial'.`)
      log(`\nLog written to ${LOG_FILE}`)
      return
    }

    const updated = await prisma.$executeRaw`
      UPDATE "Product" SET "ingredientDisclosureStatus" = 'partial'
      WHERE ${TRUNCATED}`
    log(`\nUPDATED ${Number(updated).toLocaleString()} rows -> 'partial'`)

    // ---- reconciliation. The classifier taught this: a count that is not
    // checked against an independent read is a count that is wrong later.
    const after = await prisma.$queryRaw<{ status: string; n: bigint }[]>`
      SELECT "ingredientDisclosureStatus" AS status, count(*) AS n
      FROM "Product" GROUP BY 1 ORDER BY 2 DESC`
    log('\nDISCLOSURE STATUS, AFTER')
    for (const r of after) log(`  ${r.status.padEnd(16)} ${Number(r.n).toLocaleString()}`)

    const leftover = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Product" WHERE ${TRUNCATED}`
    const stray = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Product"
      WHERE "ingredientDisclosureStatus" = 'partial'
        AND ("ingredientsTextRaw" IS NULL
             OR length("ingredientsTextRaw") NOT IN (${LENS}))`
    const beforeDisclosed = Number(totals.find((t) => t.status === 'disclosed')?.n ?? 0)
    const afterDisclosed = Number(after.find((t) => t.status === 'disclosed')?.n ?? 0)
    const afterPartial = Number(after.find((t) => t.status === 'partial')?.n ?? 0)

    log('\nRECONCILIATION (all four must hold)')
    const checks: [string, boolean, string][] = [
      ['no truncated row still disclosed', Number(leftover[0].n) === 0, `${Number(leftover[0].n)}`],
      ['no partial row outside the cut lengths', Number(stray[0].n) === 0, `${Number(stray[0].n)}`],
      ['updated count matches partial count', Number(updated) === afterPartial, `${Number(updated)} vs ${afterPartial}`],
      ['disclosed fell by exactly that much', beforeDisclosed - afterDisclosed === Number(updated), `${beforeDisclosed - afterDisclosed} vs ${Number(updated)}`],
    ]
    let allOk = true
    for (const [what, pass, detail] of checks) {
      log(`  ${pass ? 'ok  ' : 'FAIL'} ${what} (${detail})`)
      if (!pass) allOk = false
    }
    if (!allOk) {
      log('\n!! RECONCILIATION FAILED. Revert with: --revert --live')
      process.exitCode = 1
    }
    log(`\nLog written to ${LOG_FILE}`)
  } catch (e) {
    logErr('FAILED:', e)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()

// WRITE Ingredient.allergens AND Ingredient.allergensCheckedAt.
//
// Michael, 2026-10-08: "also add allergens to this filter list." The filter
// is in ingredientFilters.ts, the rules are in src/lib/allergens.ts, and
// this is what puts the answers on the 127,268 ingredient rows so the search
// can query them with an index instead of a substring scan.
//
// USAGE
//   npx tsx scripts/classify-allergens.ts              # dry run (default)
//   npx tsx scripts/classify-allergens.ts --live        # write
//   npx tsx scripts/classify-allergens.ts --selftest    # no DB
//
// READ THE DRY RUN. It is not a formality here. An allergen filter that
// misses something can hurt somebody, so the run prints, in this order:
//
//   1. every allergen REMOVED from an ingredient that had one, because a
//      rule that stops matching is the dangerous direction;
//   2. the 60 largest additions per allergen, by product count, which is
//      where a keyword that matches more than it should will show up;
//   3. the totals, so the magnitudes can be sanity-checked against what a
//      grocery catalogue should look like. Soy and wheat should be the big
//      ones; fish and shellfish should be small.
//
// WHY IT RE-CLASSIFIES EVERY ROW, EVERY TIME. Not for speed — because
// allergensCheckedAt is load-bearing. A null in that column means nobody has
// looked, and ingredientFilters.ts refuses to pass any product carrying an
// ingredient with a null there. So this script's job is as much to stamp the
// date as to write the array, and an ingredient whose answer has not changed
// still needs the stamp. Run it after any ingredient import.
//
// WHAT IT WILL NOT DO
//   - It touches `allergens` and `allergensCheckedAt` and nothing else.
//     Category, flaggedForResearch, studies and product links are not its
//     business; see reclassify-ingredients.ts for those.
//   - It does not read the label's "Contains" statement, because we do not
//     store one. See the header of src/lib/allergens.ts.

import fs from 'node:fs'
import path from 'node:path'
// DATABASE CONNECTION — the house pattern for every script in this folder.
//
// Prisma 7 needs an explicit Postgres driver adapter; a bare
// `new PrismaClient()` throws "PrismaClient was instantiated without any
// options. A driver adapter is required to connect to your database."
//
// And `import 'dotenv/config'` is NOT optional. A standalone tsx script does
// not load .env by itself, so without it `process.env.DATABASE_URL` is
// undefined and the adapter is built with no connection string. This is also
// why no script here imports `src/lib/prisma` — that module builds the same
// adapter but never loads .env, because Next.js has already done it by the
// time the app uses it. Correct for the app, useless from the command line.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { ALLERGENS, classifyAllergens, type Allergen } from '@/lib/allergens'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
// queryPlanCacheMaxSize: 0 and the transaction timeouts match
// reclassify-ingredients.ts: every batch embeds different values, so cached
// plans are never reused and the cache just grows, and a 500-row transaction
// needs longer than Prisma's 5 s default to commit.
const clientOptions = {
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0]
const prisma = new PrismaClient(clientOptions)

const args = process.argv.slice(2)
const LIVE = args.includes('--live')
const SELFTEST = args.includes('--selftest')
const BATCH = 500

const LOG_FILE = path.join(
  './logs',
  `classify-allergens${LIVE ? '' : '-dryrun'}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
)
fs.mkdirSync('./logs', { recursive: true })

function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

type Row = {
  id: string
  name: string
  products: number
  from: string[]
  to: Allergen[]
  stampWasNull: boolean
}

// The selftest in src/lib/allergens.ts is the real one — it holds about 150
// cases. This is the smaller guard that the module is wired up correctly
// from here, so that `--selftest` on this script fails loudly if the import
// path or the rule file breaks, without duplicating the case list.
function selfTest(): boolean {
  const cases: { name: string; want: Allergen[] }[] = [
    { name: 'soy lecithin', want: ['soy'] },
    { name: 'wheat flour', want: ['wheat'] },
    { name: 'enriched flour', want: ['wheat'] },
    { name: 'nonfat dry milk', want: ['milk'] },
    { name: 'cocoa butter', want: [] },
    { name: 'peanut butter', want: ['peanut'] },
    { name: 'almond', want: ['tree nut'] },
    { name: 'nutmeg', want: [] },
    { name: 'annatto', want: [] },
    { name: 'orange peel', want: [] },
    { name: 'pasteurized goat milk', want: ['milk'] },
    { name: 'enriched egg noodle', want: ['egg', 'wheat'] },
    { name: 'sesame oil', want: ['sesame'] },
    { name: 'worcestershire sauce', want: ['fish'] },
    { name: 'shrimp', want: ['shellfish'] },
    { name: 'water', want: [] },
  ]
  let bad = 0
  for (const c of cases) {
    const got = classifyAllergens(c.name)
    const ok = got.join(',') === c.want.join(',')
    if (!ok) bad++
    log(`${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(28)} [${got.join(', ')}]`)
  }
  log(
    bad === 0
      ? `\nAll ${cases.length} cases pass. The full rule selftest is: npx tsx src/lib/allergens.ts --selftest`
      : `\n${bad} FAILURES`
  )
  return bad === 0
}

async function main() {
  if (SELFTEST) {
    process.exitCode = selfTest() ? 0 : 1
    log(`\nLog written to ${LOG_FILE}`)
    return
  }

  log(`${LIVE ? 'LIVE RUN' : 'DRY RUN'} — classifying ingredient allergens\n`)

  // Product counts come along so the dry run reads by impact rather than
  // alphabetically. A keyword that wrongly claims an ingredient on 30,000
  // labels should be the first thing on the page.
  const ingredients = await prisma.ingredient.findMany({
    select: {
      id: true,
      name: true,
      allergens: true,
      allergensCheckedAt: true,
      _count: { select: { products: true } },
    },
  })
  log(`Ingredients read: ${ingredients.length.toLocaleString()}`)

  const rows: Row[] = []
  let unchanged = 0
  for (const i of ingredients) {
    const to = classifyAllergens(i.name)
    const same =
      to.join(',') === [...i.allergens].sort().join(',') ||
      to.join(',') === i.allergens.join(',')
    // An unchanged answer still needs the date stamped, so it is a write
    // either way; `rows` only separates them for the report.
    if (same && i.allergensCheckedAt !== null) {
      unchanged++
      continue
    }
    rows.push({
      id: i.id,
      name: i.name,
      products: i._count.products,
      from: i.allergens,
      to,
      stampWasNull: i.allergensCheckedAt === null,
    })
  }

  rows.sort((a, b) => b.products - a.products)
  log(`Already correct and already stamped: ${unchanged.toLocaleString()}`)
  log(`To write: ${rows.length.toLocaleString()}`)

  // --- 1. REMOVALS FIRST. A rule that stopped matching is the error that
  //        matters, because it turns a product that should be withheld from
  //        a filtered list into one that passes it.
  const removals = rows.filter((r) => r.from.some((a) => !r.to.includes(a as Allergen)))
  log(`\n===== ALLERGENS REMOVED (review these first — ${removals.length}) =====`)
  if (removals.length === 0) log('  none')
  for (const r of removals.slice(0, 80)) {
    const gone = r.from.filter((a) => !r.to.includes(a as Allergen))
    log(`  ${String(r.products).padStart(7)}  ${r.name.padEnd(44)} lost [${gone.join(', ')}]`)
  }

  // --- 2. ADDITIONS, grouped by allergen so each keyword list can be read
  //        against what it actually caught.
  log(`\n===== ADDITIONS BY ALLERGEN =====`)
  for (const allergen of ALLERGENS) {
    const added = rows.filter(
      (r) => r.to.includes(allergen) && !r.from.includes(allergen)
    )
    const products = added.reduce((n, r) => n + r.products, 0)
    log(
      `\n--- ${allergen}: ${added.length.toLocaleString()} ingredients, ${products.toLocaleString()} label appearances`
    )
    for (const r of added.slice(0, 60)) {
      const also = r.to.filter((a) => a !== allergen)
      log(
        `  ${String(r.products).padStart(7)}  ${r.name}${also.length > 0 ? `   (also ${also.join(', ')})` : ''}`
      )
    }
    if (added.length > 60) log(`  ... and ${(added.length - 60).toLocaleString()} more`)
  }

  // --- 3. The shape of the result, for a sanity check against what a US
  //        grocery catalogue should look like.
  log(`\n===== TOTALS AFTER THIS RUN =====`)
  const finalCounts = new Map<Allergen, { names: number; products: number }>()
  for (const i of ingredients) {
    const to = classifyAllergens(i.name)
    for (const a of to) {
      const cur = finalCounts.get(a) ?? { names: 0, products: 0 }
      cur.names++
      cur.products += i._count.products
      finalCounts.set(a, cur)
    }
  }
  for (const a of ALLERGENS) {
    const v = finalCounts.get(a) ?? { names: 0, products: 0 }
    log(
      `  ${a.padEnd(11)} ${String(v.names).padStart(7)} ingredient names  ${String(v.products).padStart(9)} label appearances`
    )
  }

  if (!LIVE) {
    log(`\nDRY RUN — nothing written. Read the removals and the additions above, then`)
    log(`re-run with --live. Until this has run live, every allergen filter returns`)
    log(`nothing: ingredientFilters.ts refuses to pass a product carrying an`)
    log(`ingredient whose allergensCheckedAt is still null, which is all of them.`)
    log(`Log written to ${LOG_FILE}`)
    return
  }

  const stampedAt = new Date()
  let written = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH)
    await prisma.$transaction(
      slice.map((r) =>
        prisma.ingredient.update({
          where: { id: r.id },
          data: { allergens: r.to, allergensCheckedAt: stampedAt },
        })
      )
    )
    written += slice.length
    log(`  ...${written.toLocaleString()} of ${rows.length.toLocaleString()} updated`)
  }

  const stillNull = await prisma.ingredient.count({ where: { allergensCheckedAt: null } })
  log(`\nUpdated: ${written.toLocaleString()} ingredients`)
  log(`Ingredients still unstamped: ${stillNull.toLocaleString()}`)
  if (stillNull > 0) {
    log(
      `  — any product carrying one of those cannot pass an allergen filter. That is`
    )
    log(`    the intended behaviour, but if this number is not zero the run was partial.`)
  }
  log(`Log written to ${LOG_FILE}`)
}

main()
  .catch((e) => {
    log(`[ERROR] ${e instanceof Error ? e.stack : String(e)}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

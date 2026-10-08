// RE-APPLY THE CLASSIFICATION RULES TO INGREDIENTS ALREADY IN THE DATABASE.
//
// WHY THIS EXISTS. classifyIngredient() runs at ingest. Editing
// ingredientClassification.ts therefore changes nothing about the 127,268
// ingredients already stored — which is how the catalogue ended up with soy
// lecithin on 30,962 products and no category at all.
//
// Michael, 2026-10-07, on a Keto ice cream bar: "yuka has this as an additive
// and sources to go with the risk, but we dont. fix that." The ingredient was
// steviol glycoside. The rules now cover it; this script is what makes that
// true of the rows.
//
// USAGE
//   npx tsx scripts/reclassify-ingredients.ts              # dry run (default)
//   npx tsx scripts/reclassify-ingredients.ts --live        # write
//   npx tsx scripts/reclassify-ingredients.ts --selftest    # no DB
//
// READ THE DRY RUN BEFORE --live. It prints every category change ordered by
// how many products it affects, which is the only practical way to catch a
// keyword that matches more than it should. A substring rule is one typo away
// from reclassifying a whole food: 'sorbic acid' nearly caught 'ascorbic
// acid' (vitamin C, 16,317 products) and only escaped on the letter order.
//
// WHAT IT WILL NOT DO
//   - It never clears a category that a rule still produces.
//   - It never invents a category a rule does not produce.
//   - It touches only `category` and `flaggedForResearch`. Studies, authority
//     assessments and product links are not its business.
//
// A NOTE ON flaggedForResearch. Adding a category sets the flag too, so this
// run increases the number of flagged ingredients substantially. That is
// correct — the flag means "an additive or processing ingredient worth
// researching", not "we found something" — and the product and ingredient
// pages were reworded in rounds 9-11 to say exactly that. Running this
// BEFORE those fixes would have put an amber warning on thousands of
// products we hold no research about.

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
import { classifyIngredient } from '@/lib/ingredientClassification'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
// queryPlanCacheMaxSize: 0 and the transaction timeouts match
// backfill-off-images.ts: every batch embeds different values, so cached
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
  `reclassify-ingredients${LIVE ? '' : '-dryrun'}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
)
fs.mkdirSync('./logs', { recursive: true })

function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

type Change = {
  id: string
  name: string
  products: number
  from: string | null
  to: string | null
  flagFrom: boolean
  flagTo: boolean
}

function selfTest(): boolean {
  const cases: { name: string; category: string | null }[] = [
    // The additions that prompted this script.
    { name: 'soy lecithin', category: 'emulsifier' },
    { name: 'sunflower lecithin', category: 'emulsifier' },
    { name: 'xanthan gum', category: 'emulsifier' },
    { name: 'guar gum', category: 'emulsifier' },
    { name: 'locust bean gum', category: 'emulsifier' },
    { name: 'steviol glycoside', category: 'sugar substitute' },
    { name: 'stevia leaf extract', category: 'sugar substitute' },
    { name: 'monk fruit extract', category: 'sugar substitute' },
    { name: 'erythritol', category: 'sugar substitute' },
    { name: 'allulose', category: 'sugar substitute' },
    { name: 'caramel color', category: 'artificial dye' },
    { name: 'propyl gallate', category: 'preservative' },
    { name: 'sorbic acid', category: 'preservative' },
    { name: 'vegetable oil', category: 'seed oil' },
    { name: 'spices', category: 'undisclosed flavoring' },

    // THE FALSE POSITIVES THESE RULES MUST NOT PRODUCE. Each of these is a
    // real ingredient in the catalogue with a product count in the
    // thousands, and each is one letter away from a rule above.
    { name: 'ascorbic acid', category: null },   // vitamin C, 16,317 products
    { name: 'allspice', category: null },        // one named spice
    { name: 'palm oil', category: null },        // fruit oil, not a seed oil
    { name: 'olive oil', category: null },
    { name: 'coconut oil', category: null },
    { name: 'cocoa butter', category: null },
    { name: 'sea salt', category: null },
    { name: 'water', category: null },
    { name: 'sugar', category: null },
    { name: 'cane sugar', category: null },
    { name: 'honey', category: null },
    { name: 'milk', category: null },
  ]

  let pass = 0
  for (const c of cases) {
    const got = classifyIngredient(c.name)
    const ok = got.category === c.category && got.flaggedForResearch === (c.category !== null)
    if (ok) pass++
    log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(22)} -> ${String(got.category)}${
        ok ? '' : `   (expected ${String(c.category)})`
      }`
    )
  }
  log(`\n${pass}/${cases.length} passed.`)
  return pass === cases.length
}

async function main() {
  if (SELFTEST) {
    process.exitCode = selfTest() ? 0 : 1
    log(`\nLog written to ${LOG_FILE}`)
    return
  }

  log(`${LIVE ? 'LIVE RUN' : 'DRY RUN'} — re-applying classification rules\n`)

  // Product counts come along so the dry run can be read by impact rather
  // than alphabetically. A rule that changes 30,000 products deserves more
  // scrutiny than one that changes three.
  const ingredients = await prisma.ingredient.findMany({
    select: {
      id: true,
      name: true,
      category: true,
      flaggedForResearch: true,
      _count: { select: { products: true } },
    },
  })
  log(`Ingredients read: ${ingredients.length.toLocaleString()}`)

  const changes: Change[] = []
  for (const i of ingredients) {
    const next = classifyIngredient(i.name)
    if (next.category === i.category && next.flaggedForResearch === i.flaggedForResearch) continue
    changes.push({
      id: i.id,
      name: i.name,
      products: i._count.products,
      from: i.category,
      to: next.category,
      flagFrom: i.flaggedForResearch,
      flagTo: next.flaggedForResearch,
    })
  }

  changes.sort((a, b) => b.products - a.products)

  // --- summary, by what the change actually is ---
  const byTransition = new Map<string, { names: number; products: number }>()
  for (const c of changes) {
    const key = `${c.from ?? '(none)'} -> ${c.to ?? '(none)'}`
    const cur = byTransition.get(key) ?? { names: 0, products: 0 }
    cur.names++
    cur.products += c.products
    byTransition.set(key, cur)
  }

  log(`\n===== CHANGES: ${changes.length.toLocaleString()} ingredients =====`)
  log(`\nBy transition (product counts are label appearances, so they overlap):`)
  for (const [key, v] of [...byTransition.entries()].sort((a, b) => b[1].products - a[1].products)) {
    log(`  ${String(v.products).padStart(9)} products  ${String(v.names).padStart(6)} names   ${key}`)
  }

  // CATEGORIES BEING REMOVED get their own section, because a rule that
  // stops matching is far more likely to be a mistake than one that starts.
  const removals = changes.filter((c) => c.from !== null && c.to === null)
  log(`\nCategories REMOVED (review these first — ${removals.length}):`)
  if (removals.length === 0) log('  none')
  for (const c of removals.slice(0, 40)) {
    log(`  ${String(c.products).padStart(7)}  ${c.name}  (was ${c.from})`)
  }

  log(`\nThe 150 largest changes:`)
  for (const c of changes.slice(0, 150)) {
    log(
      `  ${String(c.products).padStart(7)}  ${c.name.padEnd(46)} ${String(c.from ?? '-')} -> ${String(c.to ?? '-')}${
        c.flagFrom !== c.flagTo ? `  [flag ${c.flagFrom} -> ${c.flagTo}]` : ''
      }`
    )
  }

  if (!LIVE) {
    log(`\nDRY RUN — nothing written. Read the list above, then re-run with --live.`)
    log(`Log written to ${LOG_FILE}`)
    return
  }

  let written = 0
  for (let i = 0; i < changes.length; i += BATCH) {
    const slice = changes.slice(i, i + BATCH)
    await prisma.$transaction(
      slice.map((c) =>
        prisma.ingredient.update({
          where: { id: c.id },
          data: { category: c.to, flaggedForResearch: c.flagTo },
        })
      )
    )
    written += slice.length
    log(`  ...${written.toLocaleString()} of ${changes.length.toLocaleString()} updated`)
  }

  log(`\nUpdated: ${written.toLocaleString()} ingredients`)
  log(`Log written to ${LOG_FILE}`)
}

main()
  .catch((e) => {
    log(`[ERROR] ${e instanceof Error ? e.stack : String(e)}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

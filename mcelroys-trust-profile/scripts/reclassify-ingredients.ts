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
// Changes from one category to a DIFFERENT one are held back by default.
// See the downgrade report below for why.
const ALLOW_RECAT = args.includes('--allow-recategorize')
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
  hydFrom: boolean | null
  hydTo: boolean
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

    // THE ORDERING INVARIANT, PINNED.
    //
    // CORRECTED 2026-10-16. The first version of these cases asserted what
    // the DATABASE currently holds, not what the rules are designed to
    // produce -- and the database is stale, which is the entire reason this
    // script exists. Three of them failed and all three failures were the
    // test being wrong. Writing a test from the data it is meant to audit
    // proves only that nothing has changed.
    //
    // WHAT IS ACTUALLY DESIGNED: the oil palm yields palm oil from the fruit
    // flesh and palm kernel oil from the seed inside it. Palm kernel oil IS a
    // seed oil; palm oil is not. The seed-oil rule is first and 'palm kernel
    // oil' is one of its keywords, so a name whose SOURCE is identifiable
    // keeps its source and never reaches the hydrogenated rule at the bottom.
    //
    // The cost of breaking this ordering is on the first two lines: they are
    // `seed oil`, and "No seed oils" promises in its own description to catch
    // "hydrogenated versions of them". Move the hydrogenated rule up and
    // 2,486 + 1,212 product links leave a filter that still claims them.
    { name: 'partially hydrogenated soybean oil', category: 'seed oil' },     // 2,486 links
    { name: 'hydrogenated vegetable oil', category: 'seed oil' },             // 1,212 links
    { name: 'hydrogenated palm kernel oil', category: 'seed oil' },           // 1,055 links
    { name: 'partially hydrogenated palm kernel oil', category: 'seed oil' }, //   769 links
    { name: 'hydrogenated palm kernel oil with soy lecithin', category: 'seed oil' },

    // And the hydrogenated rule must still fire for a fat whose source is
    // NOT a seed. Palm oil is pressed from the fruit; coconut from the flesh.
    { name: 'hydrogenated palm oil', category: 'hydrogenated fat' },          //   507 links
    { name: 'hydrogenated coconut oil', category: 'hydrogenated fat' },       //   490 links

    // THE EXCLUSIONS, added 2026-10-16 after the dry run. Each of these would
    // have been filed as a hydrogenated fat by substring match alone.
    { name: 'non-hydrogenated palm oil', category: null },     // 61 links, and the label says NOT
    { name: 'non hydrogenated palm oil', category: null },     // 26 links, unhyphenated spelling
    { name: 'nonhydrogenated palm oil', category: null },      //  3 links, closed spelling
    { name: 'hydrogenated starch hydrolysate', category: null },  // 80 links, a sugar alcohol
    { name: 'peg-40 hydrogenated castor oil', category: null },   //  9 links, a surfactant
    // ...but a plain hydrogenated castor oil is a real hydrogenated fat and
    // must survive the 'peg-' exclusion.
    { name: 'hydrogenated castor oil', category: 'hydrogenated fat' },

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
      isHydrogenated: true,
      _count: { select: { products: true } },
    },
  })
  log(`Ingredients read: ${ingredients.length.toLocaleString()}`)

  let changes: Change[] = []
  for (const i of ingredients) {
    const next = classifyIngredient(i.name)
    if (
      next.category === i.category &&
      next.flaggedForResearch === i.flaggedForResearch &&
      next.isHydrogenated === i.isHydrogenated
    ) {
      continue
    }
    changes.push({
      id: i.id,
      name: i.name,
      products: i._count.products,
      from: i.category,
      to: next.category,
      flagFrom: i.flaggedForResearch,
      flagTo: next.flaggedForResearch,
      hydFrom: i.isHydrogenated,
      hydTo: next.isHydrogenated,
    })
  }

  changes.sort((a, b) => b.products - a.products)

  // SPLIT THE REPORT BY WHICH FACT CHANGED.
  //
  // isHydrogenated starts NULL on every row, so the first run after the
  // migration sees all 127,268 ingredients as changed. Folding those into the
  // category report would bury the handful of real category changes under a
  // six-figure pile of `(none) -> (none)`, which is how a dry run stops being
  // readable and therefore stops being read.
  const catChanges = changes.filter((c) => c.from !== c.to || c.flagFrom !== c.flagTo)
  const hydChanges = changes.filter((c) => c.hydFrom !== c.hydTo)

  // --- summary, by what the change actually is ---
  const byTransition = new Map<string, { names: number; products: number }>()
  for (const c of catChanges) {
    const key = `${c.from ?? '(none)'} -> ${c.to ?? '(none)'}`
    const cur = byTransition.get(key) ?? { names: 0, products: 0 }
    cur.names++
    cur.products += c.products
    byTransition.set(key, cur)
  }

  log(`\n===== CATEGORY CHANGES: ${catChanges.length.toLocaleString()} ingredients =====`)
  log(`      (rows written in total, including process-attribute-only: ${changes.length.toLocaleString()})`)
  log(`\nBy transition (product counts are label appearances, so they overlap):`)
  for (const [key, v] of [...byTransition.entries()].sort((a, b) => b[1].products - a[1].products)) {
    log(`  ${String(v.products).padStart(9)} products  ${String(v.names).padStart(6)} names   ${key}`)
  }

  // CATEGORIES BEING REMOVED get their own section, because a rule that
  // stops matching is far more likely to be a mistake than one that starts.
  const removals = catChanges.filter((c) => c.from !== null && c.to === null)
  log(`\nCategories REMOVED (review these first — ${removals.length}):`)
  if (removals.length === 0) log('  none')
  for (const c of removals.slice(0, 40)) {
    log(`  ${String(c.products).padStart(7)}  ${c.name}  (was ${c.from})`)
  }

  // RECATEGORISATIONS, which this report used to miss entirely.
  //
  // The removals check above only catches category -> null. On 2026-10-16 it
  // printed "0" while eleven names moved from a SPECIFIC category to a
  // broader one and lost a true fact on the way: `palm kernel oil with tbhq`
  // went preservative -> seed oil, taking 63 products out of the reach of
  // "No preservatives" even though TBHQ is named in the ingredient itself.
  //
  // That is the same failure the removals check exists to prevent, wearing a
  // different shape, and a dry run that reports "0 removed" while silently
  // doing it is worse than one that reports nothing.
  //
  // These are HELD BACK unless --allow-recategorize. A compound name carries
  // two facts and one column can only hold one, so overwriting the narrower
  // fact with the broader one is a loss every time. The real fix is the
  // two-axis column logged against item 34.
  const recats = catChanges.filter((c) => c.from !== null && c.to !== null && c.from !== c.to)
  log(`\nRECATEGORISED — a specific category replaced by another (${recats.length}):`)
  if (recats.length === 0) log('  none')
  for (const c of recats.slice(0, 40)) {
    log(`  ${String(c.products).padStart(7)}  ${c.name.padEnd(46)} ${c.from} -> ${c.to}`)
  }
  if (recats.length > 0) {
    log(
      ALLOW_RECAT
        ? '  --allow-recategorize is set: these WILL be written.'
        : '  Held back. Re-run with --allow-recategorize to apply them.'
    )
  }
  if (!ALLOW_RECAT) {
    // NEUTRALISE THE CATEGORY CHANGE, DO NOT DROP THE ROW.
    //
    // The first version of this filtered held rows out of `changes` entirely,
    // which also withheld their isHydrogenated value and left 11 rows NULL
    // after a live run -- 5 of them genuinely hydrogenated, on 12 product
    // links the new filter then could not catch.
    //
    // That is the exact mistake this column exists to prevent, made by the
    // guard protecting it: category and hydrogenation are INDEPENDENT facts,
    // so a dispute about one must not suppress the other. Holding back the
    // category means writing the category we already had, not writing
    // nothing.
    const held = new Set(recats.map((c) => c.id))
    changes = changes.map((c) =>
      held.has(c.id) ? { ...c, to: c.from, flagTo: c.flagFrom } : c
    )
  }

  // THE PROCESS ATTRIBUTE, reported separately from the category because it
  // is a separate fact. A row can change this and nothing else -- a
  // hydrogenated seed oil keeps `seed oil` and gains isHydrogenated -- and
  // that change is invisible in the transition table above.
  const hydTrue = hydChanges.filter((c) => c.hydTo)
  log(
    `\nisHydrogenated: ${hydChanges.length.toLocaleString()} rows get a value ` +
    `(${hydTrue.length} true, ${(hydChanges.length - hydTrue.length).toLocaleString()} false)`
  )
  log(`  The TRUE ones are the filter's whole subject, ${hydTrue.reduce((n, c) => n + c.products, 0).toLocaleString()} product links:`)
  for (const c of hydTrue.slice(0, 15)) {
    log(`  ${String(c.products).padStart(7)}  ${c.name.padEnd(46)} category ${String(c.to ?? '-')}`)
  }
  if (hydTrue.length > 15) log(`  ...and ${hydTrue.length - 15} more marked hydrogenated`)

  log(`\nThe 150 largest changes:`)
  for (const c of catChanges.slice(0, 150)) {
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
          data: { category: c.to, flaggedForResearch: c.flagTo, isHydrogenated: c.hydTo },
        })
      )
    )
    written += slice.length
    log(`  ...${written.toLocaleString()} of ${changes.length.toLocaleString()} updated`)
  }

  log(`\nUpdated: ${written.toLocaleString()} ingredients`)

  // POST-RUN GUARD. isHydrogenated is a three-state column and NULL means
  // "nobody looked" -- but this script looks at every row, so after a live
  // run there should be none left. Any that remain mean something was
  // withheld, which is how the hold-back bug above went unnoticed until it
  // was queried by hand.
  const unchecked = await prisma.ingredient.count({ where: { isHydrogenated: null } })
  if (unchecked > 0) {
    log(`\n[WARN] ${unchecked.toLocaleString()} ingredients still have isHydrogenated = NULL.`)
    log(`       This script evaluates every row, so NULL means a write was withheld.`)
    process.exitCode = 1
  } else {
    log(`isHydrogenated: no rows left unchecked.`)
  }
  log(`Log written to ${LOG_FILE}`)
}

main()
  .catch((e) => {
    log(`[ERROR] ${e instanceof Error ? e.stack : String(e)}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

// KEEP Ingredient.productCount IN STEP WITH ProductIngredient.
//
// The column is denormalised: how many products list each ingredient.
// relatedProducts.ts uses it to seed its candidate set from a product's
// RAREST ingredients, which is what makes the related shelf find other
// gravies instead of an arbitrary slice of the "Sauce" category. Counting
// that rarity at query time measured 2,267 ms, so it is a column.
//
// USAGE
//   npx tsx scripts/sync-ingredient-product-count.ts            # dry run
//   npx tsx scripts/sync-ingredient-product-count.ts --live     # write
//
// RUN IT AFTER ANY IMPORT that adds or removes ProductIngredient rows. The
// migration that added the column seeded it, so it was correct on day one.
//
// STALENESS IS SAFE, and that is the reason this script can be a chore
// rather than a trigger: productCount only decides which products are
// CONSIDERED for the related shelf. It never decides what is said about any
// of them, and nothing user-facing prints it. A stale count makes the shelf
// slightly worse; it cannot make it wrong. Compare sync-source-rank.ts, which
// has the same property for the same reason.
//
// This is deliberately NOT a database trigger. A trigger on a 3.55-million-row
// join table would fire on every row of a bulk import — the import that
// brought in 159,495 products would have fired it millions of times — and the
// thing it maintains does not need to be correct between imports.

import fs from 'node:fs'
import path from 'node:path'
// DATABASE CONNECTION — the house pattern for every script in this folder.
// Prisma 7 needs an explicit driver adapter, and `import 'dotenv/config'` is
// not optional: a standalone tsx script does not load .env by itself, which
// is why no script here imports src/lib/prisma.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const clientOptions = {
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0]
const prisma = new PrismaClient(clientOptions)

const LIVE = process.argv.slice(2).includes('--live')

const LOG_FILE = path.join(
  './logs',
  `sync-ingredient-product-count${LIVE ? '' : '-dryrun'}-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.txt`
)
fs.mkdirSync('./logs', { recursive: true })

function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

async function main() {
  log(`${LIVE ? 'LIVE RUN' : 'DRY RUN'} — syncing Ingredient.productCount\n`)

  // One grouped read of the join table rather than 127,268 counts. The same
  // shape the migration used.
  const [stored, actual] = await Promise.all([
    prisma.ingredient.findMany({ select: { id: true, name: true, productCount: true } }),
    prisma.productIngredient.groupBy({ by: ['ingredientId'], _count: { _all: true } }),
  ])

  const counted = new Map(actual.map((r) => [r.ingredientId, r._count._all]))
  log(`Ingredients: ${stored.length.toLocaleString()}`)
  log(`Ingredients with at least one product: ${counted.size.toLocaleString()}`)

  const drift = stored
    .map((i) => ({ id: i.id, name: i.name, from: i.productCount, to: counted.get(i.id) ?? 0 }))
    .filter((d) => d.from !== d.to)

  drift.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))

  log(`\nOut of date: ${drift.length.toLocaleString()}`)
  if (drift.length > 0) {
    log(`\nThe 40 largest corrections:`)
    for (const d of drift.slice(0, 40)) {
      const sign = d.to > d.from ? '+' : ''
      log(`  ${String(d.from).padStart(8)} -> ${String(d.to).padStart(8)}  (${sign}${d.to - d.from})  ${d.name}`)
    }
  }

  if (!LIVE) {
    log(`\nDRY RUN — nothing written. Re-run with --live.`)
    log(`Log written to ${LOG_FILE}`)
    return
  }

  if (drift.length === 0) {
    log(`\nNothing to write.`)
    log(`Log written to ${LOG_FILE}`)
    return
  }

  // One UPDATE ... FROM rather than 127,268 statements: the whole table is
  // recomputed from the join table in a single pass, which is both faster and
  // impossible to leave half-applied.
  const written = await prisma.$executeRaw`
    UPDATE "Ingredient" i
    SET "productCount" = COALESCE(c.n, 0)
    FROM (
      SELECT i2.id, (SELECT count(*)::int FROM "ProductIngredient" pi WHERE pi."ingredientId" = i2.id) AS n
      FROM "Ingredient" i2
    ) c
    WHERE c.id = i.id AND i."productCount" <> COALESCE(c.n, 0)
  `
  log(`\nRows updated: ${written.toLocaleString()}`)
  log(`Log written to ${LOG_FILE}`)
}

main()
  .catch((e) => {
    log(`[ERROR] ${e instanceof Error ? e.stack : String(e)}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

// APPLY AI-estimated categories to products that have none.
//
// categorize-products.ts fills categories from USDA (manufacturer data),
// Open Food Facts and product-name keywords. About 30,000 products were left
// with no category because their names have no product word ("Goldbears",
// "Dunkel", "Lemon & Bergamot"). An AI review (2026-10-01) read each one's
// name, brand, the brand's other categories and its first ingredients, and
// picked a category with a confidence: SURE or LIKELY (applied) or NONE
// (left uncategorized, not in the file).
//
// These are written with categorySource "ai_estimate", which the app shows
// as an estimate (src/lib/categoryDisplay.ts), never as fact.
//
// WHAT IT NEVER DOES
//   - Never changes a product that already has a category (if anything set
//     one since the review, that wins).
//   - Never writes a category that isn't valid for the product's type.
//
// INPUT: a TSV with a header row: productId, category, confidence, name.
//
// USAGE
//   npx tsx scripts/apply-ai-categories.ts --file logs/ai-categories-2026-10-01.tsv          dry run
//   npx tsx scripts/apply-ai-categories.ts --file logs/ai-categories-2026-10-01.tsv --live   apply
//
// UNDO: every change is recorded in review_backup.category_assignments (same
// table as categorize-products.ts) under the run label printed at the end:
//   UPDATE "Product" p SET category = b.old_category, "categorySource" = b.old_source
//   FROM review_backup.category_assignments b
//   WHERE b.run_label = '<label>' AND p.id = b.product_id
//     AND p.category IS NOT DISTINCT FROM b.new_category;
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { isValidCategoryForType } from '@/lib/productTypes'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
// Same client options as categorize-products.ts: each batch is one
// transaction, and Prisma's default 5-second limit is too short for it.
const prisma = new PrismaClient({
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0])

const args = process.argv.slice(2)
const LIVE = args.includes('--live')
const FILE = args.includes('--file') ? args[args.indexOf('--file') + 1] : null
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const RUN_LABEL = `ai-categories-${STAMP.slice(0, 16)}`
const SOURCE = 'ai_estimate'
const WRITE_BATCH = 1000

fs.mkdirSync('./logs', { recursive: true })
const LOG_FILE = path.join('./logs', `apply-ai-categories-${LIVE ? '' : 'dryrun-'}${STAMP}.txt`)
function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

async function main() {
  if (!FILE) throw new Error('Pass --file <tsv>')
  log(`apply-ai-categories — ${LIVE ? 'LIVE' : 'DRY RUN (nothing is written)'} — ${FILE}`)

  const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).filter(Boolean)
  const header = lines.shift()!.split('\t')
  if (header[0] !== 'productId' || header[1] !== 'category') throw new Error(`Unexpected header: ${header.join(', ')}`)
  const wanted = new Map<string, { category: string; confidence: string }>()
  for (const l of lines) {
    const [productId, category, confidence] = l.split('\t')
    if (productId && category) wanted.set(productId, { category, confidence: confidence ?? '' })
  }
  log(`Decisions in file: ${wanted.size.toLocaleString()}`)

  // Current state of those products
  const ids = [...wanted.keys()]
  const current: { id: string; category: string | null; categorySource: string | null; productType: string | null }[] = []
  for (let i = 0; i < ids.length; i += 5000) {
    current.push(
      ...(await prisma.$queryRawUnsafe<typeof current>(
        `SELECT id, category, "categorySource", "productType" FROM "Product" WHERE id = ANY($1::text[])`,
        ids.slice(i, i + 5000)
      ))
    )
  }

  const stats: Record<string, number> = {}
  const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1)
  const decisions: { id: string; category: string; detail: string; oldCategory: string | null; oldSource: string | null }[] = []
  const byCategory: Record<string, number> = {}
  const found = new Set(current.map((c) => c.id))
  for (const id of ids) if (!found.has(id)) bump('skipped: product no longer exists')
  for (const p of current) {
    const w = wanted.get(p.id)!
    if (p.category) { bump('skipped: already has a category'); continue }
    if (!isValidCategoryForType(p.productType ?? 'food_beverage', w.category)) { bump(`skipped: "${w.category}" not valid for ${p.productType}`); continue }
    decisions.push({ id: p.id, category: w.category, detail: `AI review 2026-10-01 (${w.confidence})`, oldCategory: p.category, oldSource: p.categorySource })
    bump(`to apply (${w.confidence})`)
    byCategory[w.category] = (byCategory[w.category] ?? 0) + 1
  }
  for (const k of Object.keys(stats).sort()) log(`  ${k}: ${stats[k].toLocaleString()}`)
  log('\nBy category:')
  for (const [c, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(6)}  ${c}`)

  if (!LIVE) {
    log(`\nDRY RUN — nothing was written. Apply with:\n  npx tsx scripts/apply-ai-categories.ts --file ${FILE} --live`)
    return
  }

  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS review_backup`)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS review_backup.category_assignments (
      run_label text NOT NULL,
      product_id text NOT NULL,
      old_category text,
      old_source text,
      new_category text NOT NULL,
      new_source text NOT NULL,
      detail text,
      assigned_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_label, product_id)
    )`)

  let applied = 0
  for (let i = 0; i < decisions.length; i += WRITE_BATCH) {
    const batch = decisions.slice(i, i + WRITE_BATCH)
    const bIds = batch.map((d) => d.id)
    const [, count] = await prisma.$transaction(
      [
      prisma.$executeRaw`
        INSERT INTO review_backup.category_assignments (run_label, product_id, old_category, old_source, new_category, new_source, detail)
        SELECT ${RUN_LABEL}::text, * FROM unnest(
          ${bIds}::text[], ${batch.map((d) => d.oldCategory)}::text[], ${batch.map((d) => d.oldSource)}::text[],
          ${batch.map((d) => d.category)}::text[], ${batch.map(() => SOURCE)}::text[], ${batch.map((d) => d.detail)}::text[])
        ON CONFLICT DO NOTHING`,
      // Only products still without a category
      prisma.$executeRaw`
        UPDATE "Product" p SET category = b.new_category, "categorySource" = b.new_source
        FROM review_backup.category_assignments b
        WHERE b.run_label = ${RUN_LABEL} AND b.product_id = p.id
          AND p.id = ANY(${bIds}::text[])
          AND p.category IS NULL`,
      ],
      { maxWait: 30_000, timeout: 120_000 }
    )
    applied += count
    log(`  ...${Math.min(i + WRITE_BATCH, decisions.length).toLocaleString()} / ${decisions.length.toLocaleString()} processed, ${applied.toLocaleString()} updated`)
  }
  log(`\nDone. ${applied.toLocaleString()} products updated.\nRun label for undo: ${RUN_LABEL}`)
}

main()
  .catch((e) => {
    log('FAILED:', e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

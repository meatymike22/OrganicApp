// One-off follow-up to the 2026-09-28 run of repair-ingredients.ts.
//
// That run split names like "partially hydrogenated soybean and cottonseed
// oil" into two ingredients but dropped the shared words from the second
// half — the products ended up linked to plain "cottonseed oil" instead of
// "partially hydrogenated cottonseed oil". Same for "hydrolyzed soy and corn
// protein" (→ "corn protein"), "fruit and vegetable juice concentrate"
// (→ "fruit concentrate") and "natural and artificial vanilla flavor"
// (→ plain "natural flavor"). The parser is fixed; this moves the links
// that the first run put in the wrong place.
//
// HOW: it reads the plan file the live run wrote (old name → what it was
// split into), re-parses each old name with the fixed rules, and where the
// result differs — SAME number of parts, different names — it moves every
// affected product's link from the wrong ingredient to the right one.
// A link to the wrong ingredient is only removed if that product didn't
// have it for another reason (listed separately on the label, or produced
// by another of its ingredients). The before-repair copies in the
// review_backup schema are used to check that.
//
// SECOND PASS (--second-pass): the first follow-up (2026-09-28, 23:33 UTC)
// itself made a few wrong corrections — "fully hydrogenated salt", "colby
// jack cheese", "guar bean gum". With --second-pass, the starting point for
// each name is what THAT run produced (recomputed with the snapshot of the
// parser it used, scripts/_previous/), and it's corrected to the current
// rules the same way.
//
// Usage:
//   npx tsx scripts/repair-ingredients-followup.ts logs/repair-ingredients-plan-2026-09-28T19-07-31-574Z.tsv
//   ...same with --live to apply
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { parseIngredientsText } from '@/lib/ingredientParsing'
import { classifyIngredient } from '@/lib/ingredientClassification'
import { parseIngredientsText as parsePrevious } from './_previous/ingredientParsing-2026-09-28-followup'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const clientOptions = {
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0]
const prisma = new PrismaClient(clientOptions)

// Supabase cancels any statement that runs longer than its default limit.
// The big reads below scan all ~3.5 million product links, which can exceed
// that when the database is busy (right after a large write, disk throughput
// is throttled until its burst allowance refills). SET LOCAL raises the
// limit for that one statement only, and works through Supabase's pooler
// because it's inside a transaction.
async function slowQuery<T>(query: Prisma.PrismaPromise<T>): Promise<T> {
  const [, result] = await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '20min'`),
    query,
  ])
  return result as T
}

const DRY_RUN = !process.argv.includes('--live')
const PLAN = process.argv.slice(2).find((a) => !a.startsWith('--'))
const SECOND_PASS = process.argv.includes('--second-pass')
const MIN_USES_TO_BE_KNOWN = 3

fs.mkdirSync('./logs', { recursive: true })
const LOG_FILE = path.join('./logs', `repair-ingredients-followup${DRY_RUN ? '-dryrun' : ''}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)
function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

async function main() {
  if (!PLAN || !fs.existsSync(PLAN)) throw new Error('Pass the plan .tsv written by the live repair run.')
  log(DRY_RUN ? 'DRY RUN — nothing will be written. Re-run with --live to apply.' : 'LIVE RUN')

  // Known = established, clean names in the CURRENT database (as in the repair).
  const current = await slowQuery(prisma.$queryRaw<{ id: string; name: string; uses: number }[]>`
    SELECT i.id, i.name, COALESCE(pi.n, 0)::int AS uses
    FROM "Ingredient" i
    LEFT JOIN (SELECT "ingredientId", count(*) n FROM "ProductIngredient" GROUP BY 1) pi ON pi."ingredientId" = i.id`)
  const idByName = new Map(current.map((c) => [c.name, c.id]))
  const known = new Set<string>()
  for (const c of current) {
    if (c.uses < MIN_USES_TO_BE_KNOWN) continue
    const r = parseIngredientsText(c.name)
    if (r.length === 1 && r[0].name === c.name) known.add(c.name)
  }
  const reparse = (n: string) => [...new Set(parseIngredientsText(n, { isKnownIngredient: (x) => known.has(x) }).map((p) => p.name))]
  const reparsePrevious = (n: string) => [...new Set(parsePrevious(n, { isKnownIngredient: (x) => known.has(x) }).map((p) => p.name))]

  // Plan rows whose result changes with the fixed rules.
  const lines = fs.readFileSync(PLAN, 'utf8').replace(/\r/g, '').trim().split('\n').slice(1)
  type Fix = { oldName: string; applied: string[]; fixed: string[] }
  const fixes: Fix[] = []
  const finalPartsOf = new Map<string, string[]>() // every planned old name → its parts under the FIXED rules
  for (const line of lines) {
    const [kind, , oldName, parts] = line.split('\t')
    let applied = (parts ?? '').split(' | ').filter(Boolean)
    if (SECOND_PASS && (kind === 'split' || kind === 'rename')) {
      // What the first follow-up turned this name into (same rule it used)
      const prev = reparsePrevious(oldName)
      if (prev.length === applied.length) applied = prev
    }
    const fixed = reparse(oldName)
    finalPartsOf.set(oldName, kind === 'remove' ? [] : fixed.length === applied.length ? fixed : applied)
    if (kind !== 'split' && kind !== 'rename') continue
    // Only same-shape corrections (right number of parts, better names).
    // A different NUMBER of parts means the known-ingredient list shifted
    // since the run — not something to undo.
    if (fixed.length !== applied.length) continue
    if ([...fixed].sort().join('|') === [...applied].sort().join('|')) continue
    fixes.push({ oldName, applied, fixed })
  }
  log(`${fixes.length.toLocaleString()} repaired names need their links corrected.`)
  const FIX_FILE = LOG_FILE.replace(/\.txt$/, '-changes.tsv')
  fs.writeFileSync(FIX_FILE, ['old_name\tcurrently_linked_to\tcorrected_to', ...fixes.map((f) => `${f.oldName}\t${f.applied.join(' | ')}\t${f.fixed.join(' | ')}`)].join('\n'))
  log(`Full list written to ${FIX_FILE}`)
  for (const f of fixes.slice(0, 60)) log(`  "${f.oldName}": ${f.applied.join(' + ')}  ⇒  ${f.fixed.join(' + ')}`)
  if (fixes.length > 60) log(`  ...and ${fixes.length - 60} more`)

  // Products that had each old name before the repair (from the backup).
  const oldNames = fixes.map((f) => f.oldName)
  const oldLinks: { productId: string; oldName: string; listPosition: number | null; isOrganicSourced: boolean; isTrace: boolean; concentrationNote: string | null }[] = []
  for (let i = 0; i < oldNames.length; i += 500) {
    const chunk = oldNames.slice(i, i + 500)
    oldLinks.push(...(await slowQuery(prisma.$queryRaw<typeof oldLinks>`
      SELECT pi."productId", i.name AS "oldName", pi."listPosition", pi."isOrganicSourced", pi."isTrace", pi."concentrationNote"
      FROM review_backup.product_ingredients_before_repair pi
      JOIN review_backup.ingredients_before_repair i ON i.id = pi."ingredientId"
      WHERE i.name = ANY(${chunk}::text[])`)))
  }
  const productIds = [...new Set(oldLinks.map((l) => l.productId))]
  log(`${oldLinks.length.toLocaleString()} product links on ${productIds.length.toLocaleString()} products are affected.`)

  // Everything each affected product listed before the repair, mapped to
  // what it SHOULD link to now — to know which links have another reason.
  const justified = new Map<string, Set<string>>()
  for (let i = 0; i < productIds.length; i += 1000) {
    const chunk = productIds.slice(i, i + 1000)
    const rows = await slowQuery(prisma.$queryRaw<{ productId: string; name: string }[]>`
      SELECT pi."productId", i.name
      FROM review_backup.product_ingredients_before_repair pi
      JOIN review_backup.ingredients_before_repair i ON i.id = pi."ingredientId"
      WHERE pi."productId" = ANY(${chunk}::text[])`)
    for (const r of rows) {
      const set = justified.get(r.productId) ?? new Set<string>()
      for (const n of finalPartsOf.get(r.name) ?? [r.name]) set.add(n)
      justified.set(r.productId, set)
    }
  }

  const fixByOld = new Map(fixes.map((f) => [f.oldName, f]))
  const toAdd = new Map<string, { productId: string; name: string; listPosition: number | null; isOrganicSourced: boolean; isTrace: boolean; concentrationNote: string | null }>()
  const toRemove = new Set<string>() // "productId|name"
  for (const l of oldLinks) {
    const f = fixByOld.get(l.oldName)!
    for (const name of f.fixed) {
      const key = `${l.productId}|${name}`
      if (!toAdd.has(key)) toAdd.set(key, { productId: l.productId, name, listPosition: l.listPosition, isOrganicSourced: l.isOrganicSourced, isTrace: l.isTrace, concentrationNote: l.concentrationNote })
    }
    for (const name of f.applied) {
      if (f.fixed.includes(name)) continue
      if (justified.get(l.productId)?.has(name)) continue
      toRemove.add(`${l.productId}|${name}`)
    }
  }
  const newNames = [...new Set([...toAdd.values()].map((a) => a.name))].filter((n) => !idByName.has(n))
  log(`Plan: ${toAdd.size.toLocaleString()} links to write, ${toRemove.size.toLocaleString()} wrong links to remove, ${newNames.length.toLocaleString()} new ingredient rows.`)
  if (DRY_RUN) return

  // Create missing ingredient rows, then resolve ids.
  for (let i = 0; i < newNames.length; i += 1000) {
    await prisma.ingredient.createMany({
      data: newNames.slice(i, i + 1000).map((name) => ({ name, ...classifyIngredient(name) })),
      skipDuplicates: true,
    })
  }
  const allNames = [...new Set([...[...toAdd.values()].map((a) => a.name), ...[...toRemove].map((k) => k.split('|')[1])])]
  for (let i = 0; i < allNames.length; i += 1000) {
    const found = await prisma.ingredient.findMany({ where: { name: { in: allNames.slice(i, i + 1000) } }, select: { id: true, name: true } })
    for (const f of found) idByName.set(f.name, f.id)
  }

  const adds = [...toAdd.values()]
  for (let i = 0; i < adds.length; i += 2000) {
    const L = adds.slice(i, i + 2000)
    await prisma.$executeRaw`
      INSERT INTO "ProductIngredient" ("productId", "ingredientId", "listPosition", "isOrganicSourced", "isTrace", "concentrationNote")
      SELECT * FROM unnest(
        ${L.map((l) => l.productId)}::text[], ${L.map((l) => idByName.get(l.name)!)}::text[],
        ${L.map((l) => l.listPosition)}::int[], ${L.map((l) => l.isOrganicSourced)}::bool[],
        ${L.map((l) => l.isTrace)}::bool[], ${L.map((l) => l.concentrationNote)}::text[])
      ON CONFLICT ("productId", "ingredientId") DO UPDATE SET
        "listPosition" = LEAST("ProductIngredient"."listPosition", EXCLUDED."listPosition"),
        "isOrganicSourced" = "ProductIngredient"."isOrganicSourced" OR EXCLUDED."isOrganicSourced",
        "isTrace" = "ProductIngredient"."isTrace" AND EXCLUDED."isTrace",
        "concentrationNote" = COALESCE("ProductIngredient"."concentrationNote", EXCLUDED."concentrationNote")`
  }
  const removes = [...toRemove].map((k) => k.split('|')).filter(([, n]) => idByName.has(n))
  for (let i = 0; i < removes.length; i += 2000) {
    const R = removes.slice(i, i + 2000)
    await prisma.$executeRaw`
      DELETE FROM "ProductIngredient" pi
      USING unnest(${R.map((r) => r[0])}::text[], ${R.map((r) => idByName.get(r[1])!)}::text[]) AS x(pid, iid)
      WHERE pi."productId" = x.pid AND pi."ingredientId" = x.iid`
  }
  log(`Done. ${adds.length.toLocaleString()} links written, ${removes.length.toLocaleString()} wrong links removed.`)
}

main()
  .catch((e) => {
    console.error(e)
    fs.appendFileSync(LOG_FILE, `[ERROR] ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

// Repairs EXISTING Ingredient rows using the current parsing and
// normalization rules (src/lib/ingredientParsing.ts, ingredientNormalization.ts).
//
// WHY: the 2026-09-28 data review found ingredient names that earlier
// versions of the parser let through, e.g.
//   "riboflavin {vitamin b2}", "salt)"      curly braces / stray brackets
//   "sodium benzoate and potassium sorbate"  two ingredients stored as one
//   "canola and/or sunflower oil"            either-or declarations
//   "less than 2% silicon dioxide"           concentration text in the name
//   "cocoa buttera€¡"                        garbled footnote marks
//   "allergen information", "keep refrigerated"   not ingredients at all
// New imports already get the fixed rules. This script re-runs every STORED
// name through them and moves each product's link to the right row(s).
//
// For each Ingredient row, the name is re-parsed:
//   - comes back unchanged          → left alone (the vast majority)
//   - comes back as ONE other name  → links (and any research) move to that
//                                     row, which is created if needed
//   - comes back as SEVERAL names   → each product is linked to every part
//                                     ("sodium benzoate" AND "potassium sorbate")
//   - comes back as NOTHING         → not an ingredient; links removed
// then the old row is deleted.
//
// SAFETY
//   - Rows with research attached (IngredientStudy / regulatory records) are
//     only ever MOVED onto a single new row. If such a row would be split or
//     removed, it is left untouched and listed for a human.
//   - "A and B" is only split when BOTH halves are established ingredients
//     (used by 3+ products) and the whole isn't a known single item
//     ("mono and diglycerides", "half and half" — see NEVER_SPLIT).
//   - When a product already links to the target row, the two links merge:
//     earliest label position, organic if either was, trace only if both were.
//   - Nothing is marked as reviewed.
//
// Usage:
//   npx tsx scripts/repair-ingredients.ts          (dry run — writes the plan)
//   npx tsx scripts/repair-ingredients.ts --live   (applies it)
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { parseIngredientsText, type ParsedIngredient } from '@/lib/ingredientParsing'
import { classifyIngredient } from '@/lib/ingredientClassification'
import { normalizeIngredientName } from '@/lib/ingredientNormalization'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
// Same client options as bulk-import-off.ts (see the notes there): no query
// plan cache (memory), and a 2-minute transaction limit for batch writes.
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
const BATCH_SIZE = 300
// A half of "A and B" must be used by at least this many products to count
// as an established ingredient.
const MIN_USES_TO_BE_KNOWN = 3

// --- LOGGING (written as it goes, like bulk-import-off.ts) ---
fs.mkdirSync('./logs', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const LOG_FILE = path.join('./logs', `repair-ingredients${DRY_RUN ? '-dryrun' : ''}-${stamp}.txt`)
const PLAN_FILE = path.join('./logs', `repair-ingredients-plan-${stamp}.tsv`)
function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

type Row = { id: string; name: string; flagged: boolean; uses: number; research: number }
type Change = { row: Row; parts: ParsedIngredient[]; kind: 'rename' | 'split' | 'remove' }

async function main() {
  log(DRY_RUN ? 'DRY RUN — nothing will be written. Re-run with --live to apply.' : 'LIVE RUN')

  // One query for every row with its usage and research counts.
  const rows = await slowQuery(prisma.$queryRaw<Row[]>`
    SELECT i.id, i.name, i."flaggedForResearch" AS flagged,
           COALESCE(pi.n, 0)::int AS uses,
           (COALESCE(s.n, 0) + COALESCE(r.n, 0))::int AS research
    FROM "Ingredient" i
    LEFT JOIN (SELECT "ingredientId", count(*) n FROM "ProductIngredient" GROUP BY 1) pi ON pi."ingredientId" = i.id
    LEFT JOIN (SELECT "ingredientId", count(*) n FROM "IngredientStudy" GROUP BY 1) s ON s."ingredientId" = i.id
    LEFT JOIN (SELECT "ingredientId", count(*) n FROM "IngredientRegulatoryStatus" GROUP BY 1) r ON r."ingredientId" = i.id`)
  log(`Checking ${rows.length.toLocaleString()} ingredient rows...`)

  const unchanged = (r: Row, parts: ParsedIngredient[]) => parts.length === 1 && parts[0].name === r.name

  // Pass 1, without "A and B" splitting: which names are already clean?
  // Only clean, established names may serve as the halves of a split.
  const known = new Set<string>()
  for (const r of rows) {
    if (r.uses >= MIN_USES_TO_BE_KNOWN && unchanged(r, parseIngredientsText(r.name))) known.add(r.name)
  }

  // Pass 2, the real plan.
  const changes: Change[] = []
  const heldForHuman: { row: Row; parts: string[] }[] = []
  for (const r of rows) {
    const parts = parseIngredientsText(r.name, { isKnownIngredient: (n) => known.has(n) })
    if (unchanged(r, parts)) continue
    // The parser drops anything over 60 characters as likely OCR noise. For
    // a name that's ALREADY stored and is a valid name on its own ("mono and
    // diglycerides with bht and citric acid as preservative"), deleting it
    // would lose real information — leave it for a human instead.
    if (parts.length === 0 && normalizeIngredientName(r.name) !== null) continue
    const kind = parts.length === 0 ? 'remove' : parts.length === 1 ? 'rename' : 'split'
    if (r.research > 0 && kind !== 'rename') {
      heldForHuman.push({ row: r, parts: parts.map((p) => p.name) })
      continue
    }
    changes.push({ row: r, parts, kind })
  }

  // A target must not itself be a row being changed (would mean the rules
  // disagree with themselves). Guard anyway: such changes are held back.
  const changing = new Set(changes.map((c) => c.row.name))
  const safe = changes.filter((c) => {
    if (c.parts.some((p) => changing.has(p.name))) {
      heldForHuman.push({ row: c.row, parts: c.parts.map((p) => p.name) })
      return false
    }
    return true
  })

  // --- Plan summary + full plan file ---
  const byKind = (k: Change['kind']) => safe.filter((c) => c.kind === k)
  const links = (cs: Change[]) => cs.reduce((a, c) => a + c.row.uses, 0)
  const existingNames = new Set(rows.map((r) => r.name))
  const newNames = new Set<string>()
  for (const c of safe) for (const p of c.parts) if (!existingNames.has(p.name)) newNames.add(p.name)

  log(`\nPLAN`)
  log(`  Renamed or merged into another row: ${byKind('rename').length.toLocaleString()} rows (${links(byKind('rename')).toLocaleString()} product links)`)
  log(`  Split into several ingredients:     ${byKind('split').length.toLocaleString()} rows (${links(byKind('split')).toLocaleString()} product links)`)
  log(`  Removed as not an ingredient:       ${byKind('remove').length.toLocaleString()} rows (${links(byKind('remove')).toLocaleString()} product links)`)
  log(`  New ingredient rows to create:      ${newNames.size.toLocaleString()}`)
  log(`  Held for a human (research attached or conflicting): ${heldForHuman.length}`)
  for (const h of heldForHuman) log(`    HOLD "${h.row.name}" → ${h.parts.length ? h.parts.map((p) => `"${p}"`).join(' + ') : '(nothing)'}`)

  const sample = (k: Change['kind'], n: number) =>
    [...byKind(k)].sort((a, b) => b.row.uses - a.row.uses).slice(0, n)
      .forEach((c) => log(`    "${c.row.name}" (${c.row.uses}) → ${c.parts.length ? c.parts.map((p) => `"${p.name}"${p.isTrace ? ' [trace]' : ''}`).join(' + ') : '(removed)'}`))
  log(`\n  Most-used renames:`); sample('rename', 40)
  log(`\n  Most-used splits:`); sample('split', 40)
  log(`\n  Most-used removals:`); sample('remove', 40)

  fs.writeFileSync(
    PLAN_FILE,
    ['kind\tproduct_links\told_name\tnew_names', ...safe.map((c) => `${c.kind}\t${c.row.uses}\t${c.row.name}\t${c.parts.map((p) => p.name).join(' | ')}`)].join('\n')
  )
  log(`\nFull plan written to ${PLAN_FILE}`)

  if (DRY_RUN) return

  // --- 1. Create every target row that doesn't exist yet ---
  const toCreate = [...newNames].map((name) => {
    const c = classifyIngredient(name)
    return { name, category: c.category, flaggedForResearch: c.flaggedForResearch }
  })
  for (let i = 0; i < toCreate.length; i += 1000) {
    await prisma.ingredient.createMany({ data: toCreate.slice(i, i + 1000), skipDuplicates: true })
  }
  const allTargets = [...new Set(safe.flatMap((c) => c.parts.map((p) => p.name)))]
  const idByName = new Map<string, string>()
  for (let i = 0; i < allTargets.length; i += 1000) {
    const found = await prisma.ingredient.findMany({ where: { name: { in: allTargets.slice(i, i + 1000) } }, select: { id: true, name: true } })
    for (const f of found) idByName.set(f.name, f.id)
  }
  log(`\nCreated ${toCreate.length.toLocaleString()} new ingredient rows.`)

  // --- 2. Move links, batch by batch ---
  let done = 0
  let linksWritten = 0
  for (let i = 0; i < safe.length; i += BATCH_SIZE) {
    const batch = safe.slice(i, i + BATCH_SIZE)
    const oldIds = batch.map((c) => c.row.id)
    const changeById = new Map(batch.map((c) => [c.row.id, c]))
    const oldLinks = await prisma.productIngredient.findMany({ where: { ingredientId: { in: oldIds } } })

    // New links, merged in memory first: one INSERT can't touch the same
    // (product, ingredient) pair twice.
    type L = { productId: string; ingredientId: string; listPosition: number | null; isOrganicSourced: boolean; isTrace: boolean; concentrationNote: string | null }
    const merged = new Map<string, L>()
    for (const link of oldLinks) {
      const change = changeById.get(link.ingredientId)!
      for (const part of change.parts) {
        const ingredientId = idByName.get(part.name)
        if (!ingredientId) continue
        const next: L = {
          productId: link.productId,
          ingredientId,
          listPosition: link.listPosition,
          isOrganicSourced: link.isOrganicSourced || part.isOrganicSourced,
          isTrace: link.isTrace || part.isTrace,
          concentrationNote: link.concentrationNote ?? part.concentrationNote,
        }
        const key = `${next.productId}|${ingredientId}`
        const prev = merged.get(key)
        merged.set(key, prev ? {
          ...prev,
          listPosition: prev.listPosition === null ? next.listPosition : next.listPosition === null ? prev.listPosition : Math.min(prev.listPosition, next.listPosition),
          isOrganicSourced: prev.isOrganicSourced || next.isOrganicSourced,
          isTrace: prev.isTrace && next.isTrace,
          concentrationNote: prev.concentrationNote ?? next.concentrationNote,
        } : next)
      }
    }
    const L = [...merged.values()]

    // Research moves only for single-target rows (others were held back).
    const researchMoves = batch
      .filter((c) => c.row.research > 0 && c.parts.length === 1)
      .map((c) => ({ from: c.row.id, to: idByName.get(c.parts[0].name)!, flagged: c.row.flagged }))

    await prisma.$transaction([
      prisma.$executeRaw`
        INSERT INTO "ProductIngredient" ("productId", "ingredientId", "listPosition", "isOrganicSourced", "isTrace", "concentrationNote")
        SELECT * FROM unnest(
          ${L.map((l) => l.productId)}::text[], ${L.map((l) => l.ingredientId)}::text[],
          ${L.map((l) => l.listPosition)}::int[], ${L.map((l) => l.isOrganicSourced)}::bool[],
          ${L.map((l) => l.isTrace)}::bool[], ${L.map((l) => l.concentrationNote)}::text[])
        ON CONFLICT ("productId", "ingredientId") DO UPDATE SET
          "listPosition" = LEAST("ProductIngredient"."listPosition", EXCLUDED."listPosition"),
          "isOrganicSourced" = "ProductIngredient"."isOrganicSourced" OR EXCLUDED."isOrganicSourced",
          "isTrace" = "ProductIngredient"."isTrace" AND EXCLUDED."isTrace",
          "concentrationNote" = COALESCE("ProductIngredient"."concentrationNote", EXCLUDED."concentrationNote")`,
      ...researchMoves.flatMap((m) => [
        prisma.ingredientStudy.updateMany({ where: { ingredientId: m.from }, data: { ingredientId: m.to } }),
        prisma.ingredientRegulatoryStatus.updateMany({ where: { ingredientId: m.from }, data: { ingredientId: m.to } }),
        ...(m.flagged ? [prisma.ingredient.update({ where: { id: m.to }, data: { flaggedForResearch: true } })] : []),
      ]),
      prisma.productIngredient.deleteMany({ where: { ingredientId: { in: oldIds } } }),
      prisma.ingredient.deleteMany({ where: { id: { in: oldIds } } }),
    ])

    done += batch.length
    linksWritten += L.length
    if ((i / BATCH_SIZE) % 10 === 0 || done === safe.length) {
      log(`  ...${done.toLocaleString()} / ${safe.length.toLocaleString()} rows repaired (${linksWritten.toLocaleString()} links written)`)
    }
  }

  log(`\nDone. ${done.toLocaleString()} rows repaired, ${linksWritten.toLocaleString()} product links written.`)
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

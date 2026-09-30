// One-off (and safe-to-repeat) cleanup: brings EXISTING Ingredient rows in
// line with the canonical spellings from src/lib/ingredientNormalization.ts.
//
// New ingestion runs already store normalized names. This handles rows that
// were created before normalization existed, e.g.:
//   "carrots" + "carrot"          → merged into one "carrot" row
//   "cayenne*"                    → merged into "cayenne"
//   "natural flavors"             → merged into "natural flavor"
//   "copper sulphate"             → renamed "copper sulfate"
//   "vitamins:", "extract"        → not ingredients; row and links removed
//
// MERGING means: every product link, study and regulatory-status record on
// the duplicate row is moved onto the surviving row, then the duplicate is
// deleted — so no research or product data is lost, it just ends up in one
// place. Each group is merged in its own transaction.
//
// NOT handled here: non-English rows ("zucker", "betterave"). Those are fixed
// by re-running ingest-openfoodfacts.ts / ingest-openbeautyfacts.ts, which now
// only parse English lists and clear the old foreign-language links. Then
// run the orphaned-Ingredient cleanup from the maintenance list.
//
// Usage:
//   npx tsx scripts/normalize-ingredients.ts          (dry run — prints the plan)
//   npx tsx scripts/normalize-ingredients.ts --live   (applies it)
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { normalizeIngredient } from '@/lib/ingredientNormalization'
import * as fs from 'fs'
import * as path from 'path'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const DRY_RUN = !process.argv.includes('--live')

// --- LOGGING (same pattern as the other scripts) ---
const logLines: string[] = []
function log(...args: unknown[]) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  logLines.push(line)
}
function writeLogFile(prefix: string) {
  const dir = './logs'
  fs.mkdirSync(dir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(dir, `${prefix}-${timestamp}.txt`)
  fs.writeFileSync(filePath, logLines.join('\n'))
  console.log(`\nFull output saved to ${filePath}`)
}

// The earlier (smaller) of two label positions, treating null as "unknown".
function earlierPosition(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.min(a, b)
}

async function main() {
  const ingredients = await prisma.ingredient.findMany({
    include: {
      _count: { select: { products: true, studies: true, regulatoryStatuses: true } },
    },
  })
  log(`Checking ${ingredients.length} ingredient rows...\n`)

  type Row = (typeof ingredients)[number]
  // canonical name -> the rows that should end up as that one row
  const groups = new Map<string, { rows: Row[]; organic: Set<string> }>()
  const junk: Row[] = []

  for (const row of ingredients) {
    const norm = normalizeIngredient(row.name)
    if (!norm) {
      junk.push(row)
      continue
    }
    const g = groups.get(norm.name) ?? { rows: [], organic: new Set<string>() }
    g.rows.push(row)
    // e.g. "pure organic maple syrup" → "maple syrup": the links moving off
    // that row should keep the fact that the product used organic syrup.
    if (norm.organic) g.organic.add(row.id)
    groups.set(norm.name, g)
  }

  let renamed = 0
  let merged = 0
  let removed = 0
  let skippedJunk = 0

  // ---- Not-an-ingredient rows ----
  for (const row of junk) {
    // Never delete a row that has research attached — a human put that there.
    if (row._count.studies > 0 || row._count.regulatoryStatuses > 0) {
      skippedJunk++
      log(`KEEP (has research): "${row.name}" isn't a valid ingredient name but has studies/regulatory records — fix by hand.`)
      continue
    }
    removed++
    log(`REMOVE: "${row.name}" — not an ingredient (${row._count.products} product link(s) dropped).`)
    if (!DRY_RUN) {
      await prisma.$transaction([
        prisma.productIngredient.deleteMany({ where: { ingredientId: row.id } }),
        prisma.ingredient.delete({ where: { id: row.id } }),
      ])
    }
  }

  // ---- Rename / merge ----
  for (const [canonical, { rows, organic }] of groups) {
    // Already correct and alone in its group — nothing to do.
    if (rows.length === 1 && rows[0].name === canonical) continue

    // The survivor: the row already spelled correctly if there is one,
    // otherwise the one with the most attached research, then most links.
    const keeper =
      rows.find((r) => r.name === canonical) ??
      [...rows].sort(
        (a, b) =>
          b._count.studies + b._count.regulatoryStatuses - (a._count.studies + a._count.regulatoryStatuses) ||
          b._count.products - a._count.products
      )[0]
    const losers = rows.filter((r) => r.id !== keeper.id)

    if (keeper.name !== canonical) {
      renamed++
      log(`RENAME: "${keeper.name}" -> "${canonical}"`)
    }
    for (const l of losers) {
      merged++
      log(`MERGE:  "${l.name}" -> "${canonical}" (${l._count.products} link(s), ${l._count.studies} study(ies), ${l._count.regulatoryStatuses} regulatory record(s) moved)`)
    }
    if (DRY_RUN) continue

    await prisma.$transaction(async (tx) => {
      // Links already on a row like "pure organic maple syrup" keep the
      // organic fact once the row becomes plain "maple syrup". Done FIRST, so
      // it only touches the keeper's own links, not ones merged in below.
      if (organic.has(keeper.id)) {
        await tx.productIngredient.updateMany({ where: { ingredientId: keeper.id }, data: { isOrganicSourced: true } })
      }

      for (const loser of losers) {
        // Product links. The table's key is (productId, ingredientId), so if a
        // product is linked to BOTH spellings ("carrot" and "carrots" on one
        // label) there can only be one link afterwards — keep the earlier
        // list position (the label's own ordering) and any organic flag.
        const links = await tx.productIngredient.findMany({ where: { ingredientId: loser.id } })
        for (const link of links) {
          const existing = await tx.productIngredient.findUnique({
            where: { productId_ingredientId: { productId: link.productId, ingredientId: keeper.id } },
          })
          const isOrganic = link.isOrganicSourced || organic.has(loser.id)
          await tx.productIngredient.delete({
            where: { productId_ingredientId: { productId: link.productId, ingredientId: loser.id } },
          })
          if (existing) {
            await tx.productIngredient.update({
              where: { productId_ingredientId: { productId: link.productId, ingredientId: keeper.id } },
              data: {
                isOrganicSourced: existing.isOrganicSourced || isOrganic,
                listPosition: earlierPosition(existing.listPosition, link.listPosition),
                isTrace: existing.isTrace && link.isTrace,
              },
            })
          } else {
            await tx.productIngredient.create({
              data: { ...link, ingredientId: keeper.id, isOrganicSourced: isOrganic },
            })
          }
        }

        // Research and regulatory records move to the surviving row.
        await tx.ingredientStudy.updateMany({ where: { ingredientId: loser.id }, data: { ingredientId: keeper.id } })
        await tx.ingredientRegulatoryStatus.updateMany({ where: { ingredientId: loser.id }, data: { ingredientId: keeper.id } })

        // Keep the stronger classification: if either spelling was flagged
        // for research, the merged row is.
        await tx.ingredient.update({
          where: { id: keeper.id },
          data: {
            flaggedForResearch: keeper.flaggedForResearch || loser.flaggedForResearch,
            category: keeper.category ?? loser.category,
          },
        })
        await tx.ingredient.delete({ where: { id: loser.id } })
      }

      // Rename last, after the correctly-spelled duplicates are gone, so the
      // unique constraint on Ingredient.name can't collide.
      if (keeper.name !== canonical) {
        await tx.ingredient.update({ where: { id: keeper.id }, data: { name: canonical } })
      }
    })
  }

  log(`\nDone. ${renamed} renamed, ${merged} merged into another row, ${removed} removed as non-ingredients, ${skippedJunk} left for manual review.`)
  if (DRY_RUN) log('DRY RUN — nothing was written. Re-run with --live to apply.')
}

main()
  .catch((e) => {
    console.error(e)
    logLines.push(`[ERROR] ${e instanceof Error ? e.message : String(e)}`)
  })
  .finally(async () => {
    writeLogFile('normalize-ingredients')
    await prisma.$disconnect()
  })

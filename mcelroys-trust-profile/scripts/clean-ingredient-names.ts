// APPLY THE INGREDIENT-NAME RULES TO THE ROWS.
//
// Michael, on /ingredients, 2026-10-08: "a lot of these ingredients have
// characters in them that shouldnt be there at all. numbers, sepcial
// characters, etc. This seriously needs to be cleaned up."
//
// The rules and the reasoning are in src/lib/ingredientNames.ts. This script
// is only the part that touches the database, and it is the one script in
// this folder that DELETES rows, so read the dry run properly.
//
// USAGE
//   npx tsx src/lib/ingredientNames.ts --selftest       # the rules, no DB
//   npx tsx scripts/clean-ingredient-names.ts           # DRY RUN (default)
//   npx tsx scripts/clean-ingredient-names.ts --live    # write
//
// WHAT IT DOES, in three passes:
//
//   RENAME   a name that is a real ingredient written badly. If an ingredient
//            with the clean name already exists, the two are MERGED: every
//            product link moves across and the junk row is deleted. 361 of
//            the 566 underscore names have a clean twin already in the table.
//
//   MERGE    is the delicate one. ProductIngredient's primary key is
//            (productId, ingredientId), so when a product links to BOTH the
//            junk ingredient and its clean twin, the junk link cannot simply
//            be re-pointed — that would collide. Those rows are folded into
//            the surviving one instead: isOrganicSourced and isTrace are
//            OR-ed, concentrationNote is kept if the survivor had none, and
//            listPosition keeps the LOWER of the two, because position is
//            descending order of weight and the earlier position is the
//            stronger claim.
//
//   DROP     a name that is not an ingredient: list punctuation, packaging
//            boilerplate, a date, a lot number. The ingredient and its
//            product links go. This asserts nothing true today — "each of
//            the following" is on 2,626 product pages as though it were a
//            substance — so removing it removes no fact.
//
// SAFE TO RE-RUN. Every pass is idempotent: a cleaned name cleans to itself.
//
// VERIFIED BEFORE THIS WAS WRITTEN: not one affected name carries an
// IngredientStudy, an IngredientAuthorityAssessment or an
// IngredientRegulatoryStatus — zero across all classes. So nothing here can
// destroy a research record, which is the only content in this table that
// could not be rebuilt by re-importing.
//
// RUN scripts/sync-ingredient-product-count.ts AFTERWARDS. Merging changes
// how many products carry an ingredient, and Ingredient.productCount feeds
// the related-products shelf.

import fs from 'node:fs'
import path from 'node:path'
// DATABASE CONNECTION — the house pattern for every script in this folder.
// Prisma 7 needs an explicit driver adapter, and `import 'dotenv/config'` is
// not optional: a standalone tsx script does not load .env by itself, which
// is why no script here imports src/lib/prisma.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { cleanIngredientName } from '@/lib/ingredientNames'

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
  `clean-ingredient-names${LIVE ? '' : '-dryrun'}-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.txt`
)
fs.mkdirSync('./logs', { recursive: true })

function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

type Plan = {
  id: string
  name: string
  links: number
  action: 'rename' | 'merge' | 'drop'
  to?: string
  targetId?: string
  why: string
}

async function main() {
  log(`${LIVE ? 'LIVE RUN' : 'DRY RUN'} — cleaning ingredient names\n`)

  const ingredients = await prisma.ingredient.findMany({
    select: { id: true, name: true, _count: { select: { products: true } } },
  })
  log(`Ingredients read: ${ingredients.length.toLocaleString()}`)

  // Typed explicitly: this map decides whether a rename is a merge, and an
  // inferred `{} | undefined` here would make targetId untyped downstream.
  const byName = new Map<string, string>()
  for (const i of ingredients) byName.set(i.name, i.id)
  const plans: Plan[] = []

  for (const i of ingredients) {
    const verdict = cleanIngredientName(i.name)
    if (verdict.action === 'keep') continue

    if (verdict.action === 'drop') {
      plans.push({
        id: i.id,
        name: i.name,
        links: i._count.products,
        action: 'drop',
        why: verdict.why,
      })
      continue
    }

    const targetId = byName.get(verdict.to)
    // A rename onto a name that is itself junk would just move the problem.
    // Ingredient.name is unique, so renaming onto an existing name must be a
    // merge or it throws.
    plans.push({
      id: i.id,
      name: i.name,
      links: i._count.products,
      action: targetId && targetId !== i.id ? 'merge' : 'rename',
      to: verdict.to,
      targetId: targetId && targetId !== i.id ? targetId : undefined,
      why: verdict.why,
    })
  }

  plans.sort((a, b) => b.links - a.links)

  // ---- the report, worst-reach first within each action
  for (const action of ['drop', 'merge', 'rename'] as const) {
    const these = plans.filter((p) => p.action === action)
    const links = these.reduce((n, p) => n + p.links, 0)
    log(
      `\n===== ${action.toUpperCase()}: ${these.length.toLocaleString()} names, ${links.toLocaleString()} product links =====`
    )
    if (these.length === 0) {
      log('  none')
      continue
    }
    const byWhy = new Map<string, { names: number; links: number }>()
    for (const p of these) {
      const cur = byWhy.get(p.why) ?? { names: 0, links: 0 }
      cur.names++
      cur.links += p.links
      byWhy.set(p.why, cur)
    }
    for (const [why, v] of [...byWhy.entries()].sort((a, b) => b[1].links - a[1].links)) {
      log(`  ${String(v.links).padStart(7)} links  ${String(v.names).padStart(5)} names   ${why}`)
    }
    log('')
    for (const p of these.slice(0, 60)) {
      const arrow = p.to ? ` -> ${JSON.stringify(p.to)}` : ''
      log(`  ${String(p.links).padStart(6)}  ${JSON.stringify(p.name)}${arrow}`)
    }
    if (these.length > 60) log(`  ... and ${(these.length - 60).toLocaleString()} more`)
  }

  if (!LIVE) {
    log(`\nDRY RUN — nothing written.`)
    log(`Read the DROP list first: it is the only one that removes rows.`)
    log(`Then re-run with --live, and afterwards:`)
    log(`  npx tsx scripts/sync-ingredient-product-count.ts --live`)
    log(`Log written to ${LOG_FILE}`)
    return
  }

  let renamed = 0
  let merged = 0
  let dropped = 0
  let foldedLinks = 0

  // ---- 1. DROP. Links first, then the ingredient: the foreign key requires
  //         that order, and doing it in one transaction per ingredient means
  //         a failure cannot leave an ingredient with half its links gone.
  for (const p of plans.filter((x) => x.action === 'drop')) {
    await prisma.$transaction([
      prisma.productIngredient.deleteMany({ where: { ingredientId: p.id } }),
      prisma.ingredient.delete({ where: { id: p.id } }),
    ])
    dropped++
    if (dropped % 100 === 0) log(`  ...dropped ${dropped}`)
  }
  log(`Dropped: ${dropped.toLocaleString()}`)

  // ---- 2. MERGE into an existing clean twin.
  for (const p of plans.filter((x) => x.action === 'merge')) {
    const targetId = p.targetId!
    const [mineLinks, theirLinks] = await Promise.all([
      prisma.productIngredient.findMany({ where: { ingredientId: p.id } }),
      prisma.productIngredient.findMany({
        where: { ingredientId: targetId },
        select: { productId: true },
      }),
    ])
    const theirs = new Set(theirLinks.map((r) => r.productId))

    for (const link of mineLinks) {
      if (!theirs.has(link.productId)) {
        // No collision: the row just changes which ingredient it points at,
        // keeping its listPosition, isTrace and concentrationNote.
        await prisma.productIngredient.update({
          where: { productId_ingredientId: { productId: link.productId, ingredientId: p.id } },
          data: { ingredientId: targetId },
        })
        continue
      }
      // Collision. Fold this row's facts into the surviving one, then delete
      // it. Nothing on the junk row is silently preferred over the survivor:
      // the booleans are OR-ed, the note fills a gap, and the position keeps
      // whichever is earlier, because position is descending order of weight.
      const survivor = await prisma.productIngredient.findUnique({
        where: { productId_ingredientId: { productId: link.productId, ingredientId: targetId } },
      })
      if (survivor) {
        await prisma.productIngredient.update({
          where: { productId_ingredientId: { productId: link.productId, ingredientId: targetId } },
          data: {
            isOrganicSourced: survivor.isOrganicSourced || link.isOrganicSourced,
            isTrace: survivor.isTrace || link.isTrace,
            concentrationNote: survivor.concentrationNote ?? link.concentrationNote,
            listPosition:
              survivor.listPosition === null
                ? link.listPosition
                : link.listPosition === null
                  ? survivor.listPosition
                  : Math.min(survivor.listPosition, link.listPosition),
          },
        })
      }
      await prisma.productIngredient.delete({
        where: { productId_ingredientId: { productId: link.productId, ingredientId: p.id } },
      })
      foldedLinks++
    }

    await prisma.ingredient.delete({ where: { id: p.id } })
    merged++
    if (merged % 50 === 0) log(`  ...merged ${merged}`)
  }
  log(`Merged: ${merged.toLocaleString()} (${foldedLinks.toLocaleString()} duplicate links folded)`)

  // ---- 3. RENAME, where no clean twin exists.
  for (const p of plans.filter((x) => x.action === 'rename')) {
    await prisma.ingredient.update({ where: { id: p.id }, data: { name: p.to! } })
    renamed++
    if (renamed % 100 === 0) log(`  ...renamed ${renamed}`)
  }
  log(`Renamed: ${renamed.toLocaleString()}`)

  log(`\nNow re-run: npx tsx scripts/sync-ingredient-product-count.ts --live`)
  log(`Log written to ${LOG_FILE}`)
}

main()
  .catch((e) => {
    log(`[ERROR] ${e instanceof Error ? e.stack : String(e)}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

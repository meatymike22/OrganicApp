// The ONE way ingestion scripts get an Ingredient row for a name.
//
// Previously each script (Open Food Facts, Open Beauty Facts, USDA FoodData
// Central) had its own copy of "findUnique, and create if missing". Two
// problems with that at bulk-import scale:
//   1. Copies drift — one script classifies or normalizes differently.
//   2. Race condition — if two imports run at once, both can see "missing"
//      and both try to create "sea salt"; the second crashes on the unique
//      constraint and its whole product transaction rolls back.
// upsert() fixes (2): Prisma runs it as a single INSERT ... ON CONFLICT in
// Postgres, so concurrent callers all end up on the same row.
import type { Prisma, Ingredient, PrismaClient } from '@prisma/client'
import type { ParsedIngredient } from './ingredientParsing'
import { classifyIngredient } from './ingredientClassification'
import { normalizeIngredientName } from './ingredientNormalization'

// Accepts either the main Prisma client or a transaction client (`tx`
// inside prisma.$transaction), so callers can keep their transactions.
type Db = Pick<Prisma.TransactionClient, 'ingredient'>

// Returns null when the name isn't an ingredient at all (normalization
// rejected it) — callers should simply skip it.
export async function findOrCreateIngredient(db: Db, rawName: string): Promise<Ingredient | null> {
  // Names from parseIngredientsText() are already normalized; doing it again
  // here is cheap and protects against a caller passing raw label text.
  const name = normalizeIngredientName(rawName)
  if (!name) return null

  const classification = classifyIngredient(name)
  return db.ingredient.upsert({
    where: { name },
    // Classification is applied only when the row is first created. An
    // existing row keeps whatever category/flag it has — including any a
    // human corrected by hand, which a re-run must never overwrite.
    create: {
      name,
      category: classification.category,
      flaggedForResearch: classification.flaggedForResearch,
    },
    update: {},
  })
}

// Replaces a product's ingredient links with a freshly parsed list.
//
// WHY THIS SHAPE: the first bulk-ish run crashed on a 42-ingredient infant
// formula with "transaction expired (5000 ms)". The old code did two
// database round trips per ingredient INSIDE one interactive transaction, and
// from a home connection to Supabase that's ~60 ms each — 42 ingredients blew
// through Prisma's 5-second limit. So the work is split:
//   1. Find-or-create every Ingredient row first, OUTSIDE any transaction.
//      Safe: upserts are idempotent, and a row created for a product whose
//      write then fails is just an orphan, removed by the maintenance cleanup.
//   2. Swap the links in ONE short batch transaction: delete old links,
//      insert all new ones in a single createMany, optionally update the
//      product. Three statements, sent together — no per-ingredient trips —
//      and still all-or-nothing, so a product is never left with no links.
//
// Returns how many links were written.
export async function replaceProductIngredients(
  prisma: PrismaClient,
  productId: string,
  parsed: ParsedIngredient[],
  productUpdate?: Prisma.ProductUpdateInput
): Promise<number> {
  // Step 1 — resolve ingredient IDs (outside the transaction)
  const byIngredient = new Map<string, Prisma.ProductIngredientCreateManyInput>()
  for (const p of parsed) {
    const ingredient = await findOrCreateIngredient(prisma, p.name)
    if (!ingredient) continue

    // Two parsed names can land on the same row (e.g. an alias), but a product
    // can only link to an ingredient once — keep the earliest label position
    // and any organic marking.
    const existing = byIngredient.get(ingredient.id)
    if (existing) {
      existing.isOrganicSourced = existing.isOrganicSourced || p.isOrganicSourced
      continue
    }
    byIngredient.set(ingredient.id, {
      productId,
      ingredientId: ingredient.id,
      isOrganicSourced: p.isOrganicSourced,
      // Position matters: FDA requires descending order by weight, so this is
      // real concentration context for interpreting any IngredientStudy.
      listPosition: p.listPosition,
      isTrace: p.isTrace,
      concentrationNote: p.concentrationNote,
    })
  }
  const rows = [...byIngredient.values()]

  // Step 2 — swap the links atomically in one short batch
  await prisma.$transaction([
    prisma.productIngredient.deleteMany({ where: { productId } }),
    prisma.productIngredient.createMany({ data: rows }),
    ...(productUpdate ? [prisma.product.update({ where: { id: productId }, data: productUpdate })] : []),
  ])
  return rows.length
}

import { prisma } from '@/lib/prisma'
import { VETTED_COMPANIES } from '@/lib/vetting'
// The three image columns ProductThumb needs, as ONE type rather than three
// restated fields. The first draft of this file invented an
// `imageAttribution` column that does not exist — Product has imageUrl,
// imageSource and imageSourceUrl. Importing the component's own type means a
// fourth image column later cannot be missed here.
import type { ProductImageFields } from '@/components/ProductThumb'

// RELATED PRODUCTS — "what else is on this shelf, made of roughly this".
//
// Michael, 2026-10-07, replacing the certificates section: "include a section
// for 'related products', where the user can find similar products (same type
// of product, similar ingredients (but not too similar, etc)". Asked how to
// define similar, he said: "same category, different brand but with maybe 50%
// shared ingredients, for example".
//
// So: same category, a different company, and a measured ingredient overlap.
//
// WHAT THIS IS NOT, and the reason it is worded carefully. It is not a
// recommendation and it is not a ranking of products. I raised this with him
// before building it: ordering a "related" shelf by "fewer flagged
// ingredients" would be a trust score reintroduced through the side door,
// which this site does not do. So the ordering is BY SIMILARITY ONLY — how
// much of the two ingredient lists coincide — and the page says so. A product
// at the top of this list is the most similar one we found, not the best one.
//
// ---------------------------------------------------------------- the measure
//
// Overlap is the Jaccard index: shared ingredients divided by the number of
// DISTINCT ingredients across both products.
//
// Using "share of their list" instead produces a specific and bad result,
// which is why this is worth a paragraph. Measured against M&M's Peanut
// Butter (32 ingredients) on 2026-10-07, "Chocolate Jelly Rings" has 15
// ingredients of which 11 are also in the M&M's — 73% of ITS list. By that
// measure it looks like a close match. By Jaccard it is 11 / 36 = 31%,
// which is the honest number: it is a shorter, simpler product that happens
// to be a near-subset, not a similar one. The genuine match in that same run
// was a competitor's peanut chocolate candy at 26 shared of 35 distinct = 74%.
//
// Jaccard is symmetric, which also means A is related to B exactly as much as
// B is related to A — so the shelf cannot disagree with itself depending on
// which page you are standing on.
//
// ---------------------------------------------------------------- the cost
//
// Measured on the live database, 2026-10-07, for a product in "Chocolate"
// (12,143 products):
//
//   candidate pull, LIMIT 150, vetted companies only ....... 67 ms
//   ingredient rows for those candidates ................... ~200 ms
//
// NOTE FOR ANYONE EDITING THE CANDIDATE QUERY: it must not have an ORDER BY.
// HOW CANDIDATES ARE CHOSEN, and this is the whole mechanism.
//
// Michael, 2026-10-08, on Campbell's "Au jus": "there are no other 'gravy'
// products? i find that hard to believe."
//
// He was right, and the cause was not the overlap threshold. The shelf used
// to take the first 150 products in the category in arbitrary physical index
// order — ordering them switched the planner off Product_category_idx and
// cost 3,264 ms instead of 67 ms, so arbitrary it was. "Sauce" holds 21,234
// products. Looking at 150 of them at random and asking which are similar is
// a lottery, and for Au jus it came up empty: measured across the whole
// category, 4 products clear 35% overlap and 30 clear 25%, and the chance of
// any of those 34 landing in a random 150 is about one in four.
//
// SO CANDIDATES ARE NOW SEEDED FROM THE PRODUCT'S RAREST INGREDIENTS. Au jus
// lists 13 things; the two rarest are "hydrolyzed yeast protein" (38
// products) and "hydrolyzed wheat gluten" (130). Every product carrying one
// of those is a few hundred rows, fetched straight off
// ProductIngredient_ingredientId_idx, and they are exactly the products that
// share what is DISTINCTIVE about this one rather than the products that
// happen to share salt and water. What that returns for Au jus: Orrington
// Farms Brown Gravy Mix at 44%, two Mushroom Gravies at 37%, Heinz Beef
// Gravy and three more at 26%. Gravies.
//
// This is what the previous version of this comment said to do, and it needed
// Ingredient.productCount to be affordable — ranking by rarity at query time
// measured 2,267 ms. That column now exists; see the migration.

// How many of the rarest ingredients to seed from. Three is enough to find
// the neighbourhood and few enough that the seed stays small: the rarest
// ingredient alone can be one a single manufacturer uses, and widening to
// three picks up the category around it.
const SEED_INGREDIENTS = 3
// A ceiling on the seed rows, for the pathological case: a product whose
// every ingredient is common (water, salt, sugar) has no rare seed, so the
// cheapest honest answer is to look at a bounded slice and accept that the
// shelf may be thin. Better a thin shelf than a 90,000-row read.
const SEED_ROWS = 1500
// Raised from 150 now that the 150 are no longer arbitrary: these are
// products that share a rare ingredient, so looking at more of them finds
// more real matches rather than more noise.
const CANDIDATES = 400
// Below this, an overlap fraction means very little: two products with three
// ingredients each can hit 100% by both containing water, salt and sugar.
const MIN_INGREDIENTS = 5
// Michael said "maybe 50%, for example". Jaccard is a stricter measure than
// the share-of-their-list number he would have had in mind.
//
// LOWERED FROM 0.4 TO 0.25 ON 2026-10-08, once the candidates were worth
// scoring. Jaccard punishes a long ingredient list: Campbell's meatballs
// lists 43 things, and nothing in the catalogue reaches 25% of that union,
// because the union is enormous. Measured on the real data, 0.4 left two of
// three sampled products with an empty shelf while 0.25 gave 30 peers each —
// and every one of the 26% matches on Au jus was, on inspection, a gravy.
//
// The percentage and the shared count are printed on every card, so a reader
// never has to take the threshold on trust: "8 of 24 ingredients, 26%" is
// checkable against two ingredient lists.
const MIN_OVERLAP = 0.25
const MAX_RESULTS = 6
// The second shelf: same kind of thing, shorter ingredient list. A lower bar
// than MIN_OVERLAP on purpose — the whole point is a product that is
// recognisably the same food while NOT sharing the long tail.
const MIN_FOOD_OVERLAP = 0.35

export type RelatedProduct = ProductImageFields & {
  id: string
  name: string
  upc: string | null
  category: string | null
  categorySource: string | null
  productType: string
  company: { id: string; legalName: string }
  // Shared ingredient count and the Jaccard percentage, both shown in the UI.
  // Showing the raw count as well as the percentage matters: "12 of 43" is
  // checkable against the two ingredient lists, and "28%" on its own is not.
  shared: number
  distinct: number
  percent: number
  // How many ingredients this product lists in total. Shown on the shorter-list
  // shelf beside ours, because the comparison IS the information.
  theirTotal: number
}

export type RelatedSet = {
  // Closest ingredient lists overall.
  similar: RelatedProduct[]
  // Same kind of product, fewer ingredients on the label.
  shorter: RelatedProduct[]
  // How many ingredients the product being viewed lists, for the comparison.
  myTotal: number
}

// WHY THERE IS A SECOND SHELF, AND WHY IT COUNTS INGREDIENTS RATHER THAN
// ADDITIVES.
//
// Michael, 2026-10-07, on an M&M's page: "maybe any products that try to mock
// M&Ms but use better ingredients should also apply. add that to the
// algorithm."
//
// He is right that the Jaccard shelf structurally excludes them: a
// short-ingredient competitor shares less of a 32-ingredient list, so it
// scores low and never appears. The alternatives he wants are exactly the
// products the first measure hides.
//
// I BUILT IT AS "SHORTER LIST", NOT "FEWER ADDITIVES", and the reason is a
// measurement I ran rather than a principle I am being precious about.
// Counting additives needs Ingredient.category, and that column has holes:
// M&M's own list contains propyl gallate (a preservative), soy lecithin (an
// emulsifier), gum acacia, dextrin and hydrogenated palm kernel oil, ALL
// uncategorised. So an additive count is 12 for this product and "0" for a
// Lindt truffle that certainly contains soy lecithin. A comparison that
// depends on which of two products happens to have had its additives
// classified is not a fact, it is a scoreboard with a bug — and a scoreboard
// is the thing this site does not build.
//
// Total ingredient count has no such hole: either we hold the whole list or
// we hold none of it. It is objective, checkable against the packet, and it
// is what a shopper looking for a simpler version is already scanning for.
// It is also NOT a verdict — a shorter list is not automatically better, and
// the heading says only what it is.
//
// When the classification gaps are closed (see /sourcing, "What we know we
// are missing"), a "fewer additives" count becomes honest and this is where
// it goes.
export async function getRelatedProducts(product: {
  id: string
  category: string | null
  companyId: string
}): Promise<RelatedSet> {
  const empty: RelatedSet = { similar: [], shorter: [], myTotal: 0 }
  // No category, nothing to be related within. A product whose category we
  // have not worked out is not a product we can put on a shelf.
  if (!product.category) return empty

  // Our own ingredients, each with how many products carry it. Sorted here
  // rather than in SQL: thirteen rows do not need an ORDER BY.
  const mineRows = await prisma.productIngredient.findMany({
    where: { productId: product.id },
    select: { ingredientId: true, ingredient: { select: { productCount: true } } },
  })

  const mine = new Set(mineRows.map((r) => r.ingredientId))
  if (mine.size < MIN_INGREDIENTS) return { ...empty, myTotal: mine.size }

  const seedIds = [...mineRows]
    .sort((a, b) => a.ingredient.productCount - b.ingredient.productCount)
    .slice(0, SEED_INGREDIENTS)
    .map((r) => r.ingredientId)

  // Every product carrying one of those rare ingredients. Index-driven on
  // ProductIngredient_ingredientId_idx, and bounded.
  const seedRows = await prisma.productIngredient.findMany({
    where: { ingredientId: { in: seedIds }, productId: { not: product.id } },
    select: { productId: true },
    take: SEED_ROWS,
  })
  const seedProductIds = [...new Set(seedRows.map((r) => r.productId))]
  if (seedProductIds.length === 0) return { ...empty, myTotal: mine.size }

  const candidates = await prisma.product.findMany({
    where: {
      id: { in: seedProductIds },
      category: product.category,
      companyId: { not: product.companyId },
      company: VETTED_COMPANIES,
    },
    // Still no orderBy: these are already the products worth looking at, and
    // the ranking that matters happens on the overlap below.
    take: CANDIDATES,
    select: {
      id: true,
      name: true,
      upc: true,
      category: true,
      categorySource: true,
      productType: true,
      imageUrl: true,
      imageSource: true,
      imageSourceUrl: true,
      company: { select: { id: true, legalName: true } },
    },
  })

  if (candidates.length === 0) return { ...empty, myTotal: mine.size }

  const rows = await prisma.productIngredient.findMany({
    where: { productId: { in: candidates.map((c) => c.id) } },
    select: { productId: true, ingredientId: true },
  })

  const byProduct = new Map<string, Set<string>>()
  for (const r of rows) {
    const set = byProduct.get(r.productId) ?? new Set<string>()
    set.add(r.ingredientId)
    byProduct.set(r.productId, set)
  }

  const similar: RelatedProduct[] = []
  const shorter: RelatedProduct[] = []

  for (const c of candidates) {
    const theirs = byProduct.get(c.id)
    if (!theirs || theirs.size < MIN_INGREDIENTS) continue

    let shared = 0
    for (const id of theirs) if (mine.has(id)) shared++
    if (shared === 0) continue

    // |A ∪ B| = |A| + |B| − |A ∩ B|
    const distinct = mine.size + theirs.size - shared
    const ratio = shared / distinct
    const row: RelatedProduct = {
      ...c,
      shared,
      distinct,
      percent: Math.round(ratio * 100),
      theirTotal: theirs.size,
    }

    if (ratio >= MIN_OVERLAP) similar.push(row)

    // The shorter shelf. Measured against OUR list rather than the union:
    // "how much of what is in this product is also in that one" is the
    // question that makes a 15-ingredient product recognisable as the same
    // food, and the union measure is what was hiding them.
    if (theirs.size < mine.size && shared / mine.size >= MIN_FOOD_OVERLAP) {
      shorter.push(row)
    }
  }

  // Most similar first. Ties broken by name so the shelf is stable between
  // requests rather than following whatever order the rows came back in.
  similar.sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name))
  // Shortest list first — the ordering IS the point of this shelf, and it is
  // an ordering by a count off the label, not by any judgement of ours.
  shorter.sort((a, b) => a.theirTotal - b.theirTotal || a.name.localeCompare(b.name))

  const chosen = new Set(similar.slice(0, MAX_RESULTS).map((r) => r.id))
  return {
    similar: similar.slice(0, MAX_RESULTS),
    // No product appears on both shelves; one card per product, on the shelf
    // that says more about it.
    shorter: shorter.filter((r) => !chosen.has(r.id)).slice(0, MAX_RESULTS),
    myTotal: mine.size,
  }
}

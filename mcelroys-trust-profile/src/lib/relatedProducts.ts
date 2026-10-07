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
// With `ORDER BY sourceRank, name, id` the planner switches from
// Product_category_idx to Product_sourceRank_name_id_idx and filters on
// category instead of seeking it — the same query went from 67 ms to 3,264 ms
// in testing. The candidate slice is therefore in physical index order, which
// is arbitrary but stable, and that is a deliberate trade.
//
// The arbitrariness is the real limitation here: in a 12,000-product category
// we look at 150 of them, so a better match may exist outside the slice. In
// testing the slice did contain genuinely similar products, but this is the
// first thing to fix if the shelf looks thin. The proper fix is a
// `productCount` column on Ingredient so the search can be seeded from a
// product's RAREST ingredients instead — that was measured too and costs
// 2,267 ms without the column, because rarity currently has to be counted
// per ingredient at query time.

const CANDIDATES = 150
// Below this, an overlap fraction means very little: two products with three
// ingredients each can hit 100% by both containing water, salt and sugar.
const MIN_INGREDIENTS = 5
// Michael said "maybe 50%, for example". Jaccard is a stricter measure than
// the share-of-their-list number he would have had in mind, so 0.4 here is
// about as demanding as 50% of one list. The percentage is printed on every
// card, so a reader never has to take the threshold on trust.
const MIN_OVERLAP = 0.4
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

  const [mineRows, candidates] = await Promise.all([
    prisma.productIngredient.findMany({
      where: { productId: product.id },
      select: { ingredientId: true },
    }),
    prisma.product.findMany({
      where: {
        category: product.category,
        companyId: { not: product.companyId },
        id: { not: product.id },
        company: VETTED_COMPANIES,
      },
      // NO orderBy. See the note above — adding one costs 3.2 seconds.
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
    }),
  ])

  const mine = new Set(mineRows.map((r) => r.ingredientId))
  if (mine.size < MIN_INGREDIENTS || candidates.length === 0) {
    return { ...empty, myTotal: mine.size }
  }

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

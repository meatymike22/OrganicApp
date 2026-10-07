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
}

export async function getRelatedProducts(product: {
  id: string
  category: string | null
  companyId: string
}): Promise<RelatedProduct[]> {
  // No category, nothing to be related within. A product whose category we
  // have not worked out is not a product we can put on a shelf.
  if (!product.category) return []

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
  if (mine.size < MIN_INGREDIENTS || candidates.length === 0) return []

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

  const scored: RelatedProduct[] = []
  for (const c of candidates) {
    const theirs = byProduct.get(c.id)
    if (!theirs || theirs.size < MIN_INGREDIENTS) continue

    let shared = 0
    for (const id of theirs) if (mine.has(id)) shared++
    if (shared === 0) continue

    // |A ∪ B| = |A| + |B| − |A ∩ B|
    const distinct = mine.size + theirs.size - shared
    const ratio = shared / distinct
    if (ratio < MIN_OVERLAP) continue

    scored.push({
      ...c,
      shared,
      distinct,
      percent: Math.round(ratio * 100),
    })
  }

  // Most similar first. Ties broken by name so the shelf is stable between
  // requests rather than following whatever order the rows came back in.
  scored.sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name))
  return scored.slice(0, MAX_RESULTS)
}

import type { Prisma } from '@prisma/client'

// FILTERING PRODUCTS BY WHAT IS *NOT* IN THEM.
//
// Michael: "We should be able to filter these products based on ingredients.
// If i want non-gmo, organic, no seed oils, no food coloring (as a broad
// category) or even something more specific that i can input like red 40 or
// sucralose, that should be able to be filtered."
//
// WHAT THIS FILE COVERS, AND WHAT IT DELIBERATELY DOES NOT.
//
// The ingredient filters are here. The organic and non-GMO filters are NOT,
// and leaving them out is a decision rather than an omission: across 416,382
// products Rootify holds 40 organic certification records and 18 non-GMO
// records. An "organic only" filter would return about 39 products and read
// to any visitor as "almost nothing is organic", which is false — it is a
// statement about our coverage, not about the market. A filter that reports
// our gaps as facts about food is the worst thing this site could ship.
//
// The fix is a different source, not a filter: Open Food Facts records the
// label claims transcribed off the package (`labels_tags`), which is where
// tens of thousands of organic and non-GMO products would come from. See
// scripts/probe-off-labels.ts. When that lands, those two filters belong
// here, worded as "the label says organic" rather than "certified".
//
// WHY EXCLUSION RATHER THAN INCLUSION. Every filter here is "products
// WITHOUT x". That is the honest direction for ingredient data: an ingredient
// list we hold is evidence something IS present, and its absence from a list
// is weaker evidence that it is not. So the filter means "no such ingredient
// appears in the list we have" — which is what the UI says, and why a
// product with no ingredient list on file passes every exclusion filter. It
// has to: excluding it would claim we know what is in it.

// The broad categories, as Michael named them, mapped onto the
// `Ingredient.category` values the classifier actually writes.
//
// `categories` must hold EXACT values. A typo is a filter that silently
// matches nothing, which looks like "no products contain seed oil".
export const INGREDIENT_FILTERS: {
  key: string
  label: string
  // What it says on the chip once it is on.
  short: string
  categories: string[]
}[] = [
  { key: 'seed-oil', label: 'No seed oils', short: 'no seed oils', categories: ['seed oil'] },
  { key: 'dye', label: 'No artificial dyes', short: 'no dyes', categories: ['artificial dye'] },
  {
    key: 'sweetener',
    label: 'No artificial sweeteners',
    short: 'no artificial sweeteners',
    categories: ['artificial sweetener'],
  },
  {
    key: 'preservative',
    label: 'No preservatives',
    short: 'no preservatives',
    // Three separate category values, all of which are preservatives. Mapping
    // only 'preservative' would quietly let every paraben through.
    categories: ['preservative', 'paraben preservative', 'antimicrobial preservative'],
  },
  { key: 'emulsifier', label: 'No emulsifiers', short: 'no emulsifiers', categories: ['emulsifier'] },
  {
    key: 'flavoring',
    label: 'No undisclosed flavoring',
    short: 'no undisclosed flavoring',
    categories: ['undisclosed flavoring'],
  },
]

// A free-text exclusion has to be long enough to mean something. "e" would
// match almost every ingredient in the database.
const MIN_TERM = 3
const MAX_TERM = 60
const MAX_TERMS = 4

export type IngredientFilterState = {
  // Keys from INGREDIENT_FILTERS, in catalogue order.
  keys: string[]
  // Free-text ingredient names to exclude, lowercased and de-duplicated.
  terms: string[]
}

export const EMPTY_FILTERS: IngredientFilterState = { keys: [], terms: [] }

export function hasAnyFilter(f: IngredientFilterState): boolean {
  return f.keys.length > 0 || f.terms.length > 0
}

// Parse ?free=seed-oil,dye and ?without=red+40,sucralose
//
// Unknown keys are dropped rather than honoured: a bad link should not become
// a filter nobody can see or clear. Terms are capped in count and length
// because each one costs a substring scan of the ingredient table.
export function parseIngredientFilters(
  free: string | undefined,
  without: string | undefined
): IngredientFilterState {
  const known = new Set(INGREDIENT_FILTERS.map((f) => f.key))
  const keys = (free ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => known.has(s))

  const terms = (without ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((s) => s.length >= MIN_TERM && s.length <= MAX_TERM)

  return {
    // Catalogue order, not URL order, so the same set of filters always
    // produces the same URL and the same chip order.
    keys: INGREDIENT_FILTERS.filter((f) => keys.includes(f.key)).map((f) => f.key),
    terms: [...new Set(terms)].slice(0, MAX_TERMS),
  }
}

// Back to URL params. Omits anything empty so a cleared filter leaves a clean
// URL rather than ?free=&without=.
export function ingredientFilterParams(f: IngredientFilterState): Record<string, string> {
  const out: Record<string, string> = {}
  if (f.keys.length > 0) out.free = f.keys.join(',')
  if (f.terms.length > 0) out.without = f.terms.join(',')
  return out
}

export function toggleFilterKey(f: IngredientFilterState, key: string): IngredientFilterState {
  const on = f.keys.includes(key)
  const keys = on ? f.keys.filter((k) => k !== key) : [...f.keys, key]
  return {
    keys: INGREDIENT_FILTERS.filter((x) => keys.includes(x.key)).map((x) => x.key),
    terms: f.terms,
  }
}

export function removeTerm(f: IngredientFilterState, term: string): IngredientFilterState {
  return { keys: f.keys, terms: f.terms.filter((t) => t !== term) }
}

// THE WHERE CLAUSES.
//
// One `NOT: { productIngredients: { some: ... } }` per filter, which Prisma
// renders as a NOT EXISTS and Postgres runs as an anti-join against
// Product_sourceRank_name_id_idx. Measured on the live database: the first
// page of results is 111 ms with two filters and 852 ms with all six.
//
// A free-text term matches the ingredient NAME BY SUBSTRING, not by exact
// row, and that is the whole point. "red 40" exists in the database as eight
// separate ingredients — `red 40` (12,105 products), `red 40 lake` (2,734),
// `artificial color red 40` (51), `red 40 color` (47), `artificial colors red
// 40` (46), `red 40 aluminum lake` (20), `artificial colors including red 40`
// (21) and `lake red 40` (14). Excluding only the exact row would leave about
// 5,700 products containing red 40 in a list of products the shopper asked to
// have none. Under-reporting is the dangerous direction here.
export function ingredientFilterWhere(f: IngredientFilterState): Prisma.ProductWhereInput[] {
  const and: Prisma.ProductWhereInput[] = []

  for (const key of f.keys) {
    const filter = INGREDIENT_FILTERS.find((x) => x.key === key)
    if (!filter) continue
    and.push({
      NOT: {
        productIngredients: {
          some: { ingredient: { category: { in: filter.categories } } },
        },
      },
    })
  }

  for (const term of f.terms) {
    and.push({
      NOT: {
        productIngredients: {
          some: { ingredient: { name: { contains: term, mode: 'insensitive' } } },
        },
      },
    })
  }

  return and
}

// WHY A FILTERED PAGE SHOWS NO TOTAL.
//
// The first page of a filtered list is fast because the anti-join stops as
// soon as it has enough rows. An exact COUNT cannot stop: it has to decide
// every one of 416,382 products, which measured at 5.3 seconds against a
// 3.55-million-row join table — worse than the 2.17 s the whole search page
// used to take before the sourceRank index.
//
// So a filtered list does not claim a total. It fetches one row more than it
// shows and uses that to decide whether there is a next page. The counts on
// this site have to be literally true; the way to keep that promise cheaply
// is to say nothing rather than to estimate. An approximate total dressed up
// as a count would be the first false number on the site.
export function needsExactCount(f: IngredientFilterState): boolean {
  return !hasAnyFilter(f)
}

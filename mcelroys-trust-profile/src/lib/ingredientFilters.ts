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
  // The hover explainer, shown on the "i" in the rail. Michael, 2026-10-07:
  // "there needs to be a little hover over explainer to explain what each of
  // these broad categories."
  //
  // THESE NAME REAL INGREDIENTS, with the number of products each is on, read
  // off our own database on 2026-10-07. Two reasons that matters more than a
  // tidy definition would. First, "no seed oils" tells a shopper nothing
  // until they know it catches soybean and canola — the two commonest
  // ingredients in the entire catalogue. Second, a filter described in the
  // abstract can drift away from what it actually does; one described by its
  // own contents cannot, because the examples come from the same category
  // values the query uses.
  //
  // Counts go stale as the catalogue grows. They are deliberately written as
  // approximations and the wording survives being a little out of date.
  what: string
  categories: string[]
}[] = [
  {
    key: 'seed-oil',
    label: 'No seed oils',
    short: 'no seed oils',
    what:
      'Seed and vegetable oils: soybean (on ~23,800 products), canola (~18,600), plain "vegetable oil" (~16,300), sunflower (~15,000), corn (~2,600), safflower (~1,900), and hydrogenated versions of them. About 1,470 ingredient names in all. Palm oil is not in this category — palm is pressed from the fruit, not the seed.',
    categories: ['seed oil'],
  },
  {
    key: 'dye',
    // RENAMED 2026-10-07: caramel color is now caught, and it is made by
    // caramelising sugar rather than synthesised, so "artificial dyes" would
    // have been the wrong word for what the filter does.
    label: 'No added colors',
    short: 'no added colors',
    what:
      'Colourings added to the food: caramel color (~13,500 products), red 40 (~12,100), yellow 5 (~11,200), blue 1 (~9,700), yellow 6 (~7,900), titanium dioxide (~4,500), and their lake forms. About 820 names in all.',
    categories: ['artificial dye'],
  },
  {
    key: 'sweetener',
    // RENAMED 2026-10-07, because the filter now covers stevia, monk fruit
    // and the sugar alcohols as well. Calling those "artificial" on our own
    // page would be a false label — they are plant extracts and sugar
    // alcohols — so the CATEGORY stayed 'artificial sweetener', a second
    // category 'sugar substitute' was added, and the FILTER name widened to
    // cover both honestly. Someone avoiding sweeteners wants all of them.
    label: 'No sugar substitutes',
    short: 'no sugar substitutes',
    what:
      'Anything sweet that is not sugar: sucralose (~8,100 products), acesulfame potassium (~5,000), aspartame (~2,300), sorbitol (~2,800), stevia (~3,900 across its spellings), erythritol (~1,600), monk fruit (~2,100), maltitol, xylitol, allulose, steviol glycoside, saccharin. Sugar, honey and fruit juice are not in this category.',
    categories: ['artificial sweetener', 'sugar substitute'],
  },
  {
    key: 'preservative',
    label: 'No preservatives',
    short: 'no preservatives',
    what:
      'Added preservatives: potassium sorbate (~14,500 products), sodium benzoate (~9,900), sodium nitrite (~5,800), calcium propionate (~4,400), sorbic acid (~4,400), sodium erythorbate (~4,100), natamycin (~2,400), potassium benzoate (~2,200), BHT, BHA, TBHQ, propyl gallate, and the parabens. Salt, sugar and vinegar are not in this category even where they preserve.',
    // Three separate category values, all of which are preservatives. Mapping
    // only 'preservative' would quietly let every paraben through.
    categories: ['preservative', 'paraben preservative', 'antimicrobial preservative'],
  },
  {
    key: 'emulsifier',
    // RENAMED 2026-10-07: the filter now catches the thickening gums as well,
    // and "emulsifiers" alone would have been a narrower promise than the
    // filter keeps. Guar and xanthan are thickeners, not emulsifiers; the
    // category keeps its old name so no stored row had to be migrated.
    label: 'No emulsifiers or gums',
    short: 'no emulsifiers or gums',
    what:
      'Ingredients that thicken a mixture or hold it together: soy lecithin (~31,000 products), xanthan gum (~22,200), guar gum (~15,300), carrageenan (~10,700), mono- and diglycerides (~7,100), cellulose gum (~6,700), locust bean gum (~6,200), gum arabic (~4,300), polysorbates, DATEM, gellan gum.',
    categories: ['emulsifier'],
  },
  {
    key: 'flavoring',
    label: 'No undisclosed flavoring',
    short: 'no undisclosed flavoring',
    what:
      'Flavour listed as a blend the label does not break down: "natural flavor" (~82,700 products), "spices" (~36,400), "artificial flavor" (~30,900), "flavoring", "seasoning". About 2,200 names in all. This is about disclosure, not about the flavouring itself — the point is that you cannot see what is in it. A named spice like allspice or cinnamon is not in this category, because it discloses itself.',
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

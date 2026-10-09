import type { Prisma } from '@prisma/client'
import { ALLERGENS, ALLERGEN_LABEL, type Allergen } from '@/lib/allergens'

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
      'Seed and vegetable oils: soybean, canola, plain "vegetable oil", sunflower, corn, safflower, and hydrogenated versions of them. Palm oil is not in this category — palm is pressed from the fruit, not the seed.',
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
      'Colourings added to the food: caramel color, red 40, yellow 5, blue 1, yellow 6, titanium dioxide, and their lake forms.',
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
      'Anything sweet that is not sugar: sucralose, acesulfame potassium, aspartame, sorbitol, stevia (across its spellings), erythritol, monk fruit, maltitol, xylitol, allulose, steviol glycoside, saccharin. Sugar, honey and fruit juice are not in this category.',
    categories: ['artificial sweetener', 'sugar substitute'],
  },
  {
    key: 'preservative',
    label: 'No preservatives',
    short: 'no preservatives',
    what:
      'Added preservatives: potassium sorbate, sodium benzoate, sodium nitrite, calcium propionate, sorbic acid, sodium erythorbate, natamycin, potassium benzoate, BHT, BHA, TBHQ, propyl gallate, and the parabens. Salt, sugar and vinegar are not in this category even where they preserve.',
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
      'Ingredients that thicken a mixture or hold it together: soy lecithin, xanthan gum, guar gum, carrageenan, mono- and diglycerides, cellulose gum, locust bean gum, gum arabic, polysorbates, DATEM, gellan gum.',
    categories: ['emulsifier'],
  },
  {
    key: 'flavoring',
    label: 'No undisclosed flavoring',
    short: 'no undisclosed flavoring',
    what:
      'Flavour listed as a blend the label does not break down: "natural flavor", "spices", "artificial flavor", "flavoring", "seasoning". This is about disclosure, not about the flavouring itself — the point is that you cannot see what is in it. A named spice like allspice or cinnamon is not in this category, because it discloses itself.',
    categories: ['undisclosed flavoring'],
  },
]

// ALLERGENS ARE A SEPARATE GROUP, WITH A STRICTER RULE.
//
// Michael, 2026-10-08: "also add allergens to this filter list."
//
// THEY COULD NOT JOIN THE LIST ABOVE, and the reason is the most important
// thing in this file. Every filter above passes a product whose ingredient
// list we do not hold, on the grounds that excluding it would claim we know
// what is in it. That is the right call for preservatives. It is the wrong
// call for peanuts: a shopper who filters out peanuts and is shown a product
// whose ingredients we never got has been told something we did not mean to
// say, and the consequence of that error is not an unexpected label.
//
// So an allergen filter inverts the rule. A product passes only when:
//   1. its ingredient list is disclosed, AND
//   2. every ingredient on it has been through the classifier
//      (allergensCheckedAt is not null), AND
//   3. none of them names the allergen.
//
// Unknown is treated as present. See allergenFilterWhere below.
//
// WHAT THE FILTER STILL CANNOT SEE, which is why every surface that offers
// it carries this warning rather than burying it:
//   - cross-contamination. "May contain traces of peanuts" is a separate
//     statement on a package and we hold none of them.
//   - anything inside "natural flavor", which is on 82,700 products and
//     names nothing. FALCPA requires a major allergen used within a flavour
//     to be declared separately, so the law is on our side here, but the
//     ingredient list is transcribed by volunteers and a missed line is a
//     missed line.
//   - the label's own "Contains: milk, soy" statement, which is the
//     authoritative one and which we do not store. Adding it is the right
//     next step for this feature.
//
// Nobody should use this instead of reading the package, and the wording on
// screen says exactly that.
export const ALLERGEN_FILTERS: {
  key: Allergen
  label: string
  short: string
  what: string
}[] = [
  {
    key: 'milk',
    label: 'No milk',
    short: 'no milk',
    what:
      'Dairy in any form: milk, cream, whey, cheese and cheese cultures, butter, lactose, casein and caseinates, yogurt, ghee, curd. Cocoa butter, peanut butter, coconut milk, almond milk and cream of tartar are NOT counted — they are not dairy.',
  },
  {
    key: 'egg',
    label: 'No eggs',
    short: 'no eggs',
    what:
      'Egg in any form: egg, yolk, white, albumen, mayonnaise, meringue, lysozyme. Eggplant is not counted.',
  },
  {
    key: 'peanut',
    label: 'No peanuts',
    short: 'no peanuts',
    what:
      'Peanut in any form: peanut, peanut oil, peanut butter, peanut flour, groundnut. Peanuts are legumes, so they are counted separately from tree nuts — filtering one does not filter the other.',
  },
  {
    key: 'tree nut',
    label: 'No tree nuts',
    short: 'no tree nuts',
    what:
      'Almond, cashew, pecan, walnut, hazelnut, pistachio, macadamia, brazil nut, pine nut, chestnut, praline, marzipan, nougat. COCONUT IS INCLUDED, because FDA’s tree-nut list for labelling includes it — that is FDA’s classification and not ours, and it means coconut oil is filtered out too. Nutmeg, water chestnut and nutritional yeast are not tree nuts and are not counted.',
  },
  {
    key: 'wheat',
    label: 'No wheat',
    short: 'no wheat',
    what:
      'Wheat flour, wheat, wheat gluten, wheat starch, semolina, durum, spelt, kamut, couscous, bulgur, seitan, matzo. An unqualified "flour" or "enriched flour" counts, because under 21 CFR 137.105 that means wheat flour on a US label. Rice, corn, oat, almond, chickpea and malted barley flours do not count, and neither does buckwheat. This is a WHEAT filter, not a gluten-free filter: barley and rye contain gluten and are not here.',
  },
  {
    key: 'soy',
    label: 'No soy',
    short: 'no soy',
    what:
      'Soy lecithin, soybean oil, soybean, soy protein, soy sauce, soya, tofu, tempeh, miso, edamame, tamari. Highly refined soybean oil and soy lecithin are exempt from FALCPA allergen labelling and many soy-allergic people tolerate them — they are still counted here, because that is not our call to make for you. Tamarind and annatto are not soy.',
  },
  {
    key: 'sesame',
    label: 'No sesame',
    short: 'no sesame',
    what:
      'Sesame seed, sesame oil, sesame, tahini, halva. Sesame became the ninth US major allergen under the FASTER Act on 1 January 2023.',
  },
  {
    key: 'fish',
    label: 'No fish',
    short: 'no fish',
    what:
      'Anchovy, Worcestershire sauce (which is made with anchovies and says so nowhere in its name), sardine, tuna, salmon, cod, pollock, tilapia, surimi, fish oil, fish sauce, bonito, caviar, roe.',
  },
  {
    key: 'shellfish',
    label: 'No shellfish',
    short: 'no shellfish',
    what:
      'Crustaceans — shrimp, crab, lobster, crayfish, krill, langoustine — AND molluscs: clam, oyster, mussel, scallop, squid, octopus, abalone, snail. FDA’s major-allergen list names crustacean shellfish only; molluscs are included here because someone avoiding shellfish is usually avoiding both. Oyster mushroom and scalloped potatoes are not counted.',
  },
]

const ALLERGEN_KEYS = new Set<string>(ALLERGENS)

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
  // Keys from ALLERGEN_FILTERS, in catalogue order. Separate from `keys`
  // because they obey a different rule about unknown data, and mixing them
  // into one list is how that difference would eventually get lost.
  allergens: Allergen[]
}

export const EMPTY_FILTERS: IngredientFilterState = { keys: [], terms: [], allergens: [] }

export function hasAnyFilter(f: IngredientFilterState): boolean {
  return f.keys.length > 0 || f.terms.length > 0 || f.allergens.length > 0
}

// Parse ?free=seed-oil,dye and ?without=red+40,sucralose
//
// Unknown keys are dropped rather than honoured: a bad link should not become
// a filter nobody can see or clear. Terms are capped in count and length
// because each one costs a substring scan of the ingredient table.
export function parseIngredientFilters(
  free: string | undefined,
  without: string | undefined,
  no?: string | undefined
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

  // ?no=milk,tree nut — a separate parameter from ?free= so that an allergen
  // key can never be read as an additive key or the other way round. A link
  // that does that would silently drop the stricter unknown-data rule.
  const allergens = (no ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter((x) => ALLERGEN_KEYS.has(x)) as Allergen[]

  return {
    // Catalogue order, not URL order, so the same set of filters always
    // produces the same URL and the same chip order.
    keys: INGREDIENT_FILTERS.filter((f) => keys.includes(f.key)).map((f) => f.key),
    terms: [...new Set(terms)].slice(0, MAX_TERMS),
    allergens: ALLERGEN_FILTERS.filter((f) => allergens.includes(f.key)).map((f) => f.key),
  }
}

// Back to URL params. Omits anything empty so a cleared filter leaves a clean
// URL rather than ?free=&without=.
export function ingredientFilterParams(f: IngredientFilterState): Record<string, string> {
  const out: Record<string, string> = {}
  if (f.keys.length > 0) out.free = f.keys.join(',')
  if (f.terms.length > 0) out.without = f.terms.join(',')
  if (f.allergens.length > 0) out.no = f.allergens.join(',')
  return out
}

export function toggleFilterKey(f: IngredientFilterState, key: string): IngredientFilterState {
  const on = f.keys.includes(key)
  const keys = on ? f.keys.filter((k) => k !== key) : [...f.keys, key]
  return {
    ...f,
    keys: INGREDIENT_FILTERS.filter((x) => keys.includes(x.key)).map((x) => x.key),
  }
}

export function toggleAllergen(f: IngredientFilterState, key: Allergen): IngredientFilterState {
  const on = f.allergens.includes(key)
  const next = on ? f.allergens.filter((k) => k !== key) : [...f.allergens, key]
  return {
    ...f,
    allergens: ALLERGEN_FILTERS.filter((x) => next.includes(x.key)).map((x) => x.key),
  }
}

export function removeTerm(f: IngredientFilterState, term: string): IngredientFilterState {
  return { ...f, terms: f.terms.filter((t) => t !== term) }
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

  and.push(...allergenFilterWhere(f))

  return and
}

// THE ALLERGEN CLAUSES, WHERE UNKNOWN COUNTS AS PRESENT.
//
// Three conditions, and the first two are added once however many allergens
// are selected, because they are about whether we can answer at all:
//
//   1. ingredientDisclosureStatus = 'disclosed'. 271,952 products of 416,382
//      have a disclosed list; the other 144,430 are not products we have
//      nothing on, they are products we cannot speak for. The additive
//      filters pass those. This one must not.
//
//   2. no ingredient on the product has a null allergensCheckedAt. An
//      ingredient added by an import after the last classifier run has an
//      empty allergens array, which looks exactly like "checked, none
//      found" and is not. Without this clause the filter would get quietly
//      less safe every time new products land.
//
//   3. then, per allergen, the ordinary anti-join: no ingredient on the
//      product lists it.
//
// Cost: condition 2 is one more NOT EXISTS of the same shape as the existing
// filters, which measured at 111 ms for two filters and 852 ms for all six.
// A filtered page already shows no total (see needsExactCount), so none of
// this is on the COUNT path.
export function allergenFilterWhere(f: IngredientFilterState): Prisma.ProductWhereInput[] {
  if (f.allergens.length === 0) return []

  const and: Prisma.ProductWhereInput[] = [
    { ingredientDisclosureStatus: 'disclosed' },
    { NOT: { productIngredients: { some: { ingredient: { allergensCheckedAt: null } } } } },
    // A disclosed status with no ingredient rows would otherwise satisfy
    // both clauses above and pass every allergen filter on an empty list.
    { productIngredients: { some: {} } },
  ]

  for (const allergen of f.allergens) {
    and.push({
      NOT: { productIngredients: { some: { ingredient: { allergens: { has: allergen } } } } },
    })
  }

  return and
}

// Every allergen written out, for a sentence that lists them: "no milk, no
// peanuts, no sesame". Used where a filtered result set has to say what it
// filtered.
export function allergenList(keys: Allergen[]): string {
  return keys.map((k) => ALLERGEN_LABEL[k]).join(', ')
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

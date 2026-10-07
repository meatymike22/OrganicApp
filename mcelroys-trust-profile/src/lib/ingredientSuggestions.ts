// INGREDIENT SUGGESTIONS for the "without this ingredient" box.
//
// A STATIC LIST, ON PURPOSE, AND THIS IS THE REASONING.
//
// The obvious build is an API route that queries the ingredient table per
// keystroke. Measured on the live database, that is 771 ms a keystroke: there
// is no index that serves a case-insensitive prefix match on
// `Ingredient.name`, so Postgres sequentially scans all 127,268 rows, and
// ordering by product count then costs a second pass over a 3.55-million-row
// join table. Making it fast needs a text_pattern_ops or trigram index plus a
// denormalised product count — a migration and a backfill.
//
// It does not need one, because of what this list IS. Suggestions are a
// convenience; the FILTER is the truth. Whatever the shopper types is applied
// as a live substring match against every ingredient name in the database
// (see ingredientFilterWhere in ingredientFilters.ts), so a suggestion list
// that has gone stale can only ever mean a missing suggestion — never a wrong
// result, and never a product shown that should have been filtered out.
//
// So this is every categorised ingredient on 25+ products, plus the handful
// of well-known concerns the classifier does not categorise (high fructose
// corn syrup, MSG, carrageenan). 101 entries, under 3 KB, filtered in the
// browser with no network round-trip at all.
//
// Label fragments the ingredient parser captured as ingredients are left out
// — "raisins coated with less than 1% sunflower oil" is a real row with 33
// products and nobody is going to type it.
//
// REGENERATE with the query in the review log for round 8, or by hand. Order
// is by product count, descending, which is also the order suggestions are
// offered: typing "red" should offer `red 40` (12,105 products) before
// `red 40 aluminum lake` (20).
export type IngredientSuggestion = {
  name: string
  // How many products list it. Shown with the suggestion, because someone
  // excluding an ingredient should know whether that rules out 12,000
  // products or 20.
  products: number
  // The broad category, when it has one. Lets the box point out that a whole
  // category checkbox would cover this ingredient and its variants.
  cat?: string
}

export const INGREDIENT_SUGGESTIONS: IngredientSuggestion[] = [
  { name: "natural flavor", products: 82691, cat: 'undisclosed flavoring' },
  { name: "soy lecithin", products: 30962 },
  { name: "artificial flavor", products: 30943, cat: 'undisclosed flavoring' },
  { name: "corn syrup", products: 27414 },
  { name: "soybean oil", products: 23802, cat: 'seed oil' },
  { name: "dextrose", products: 23441 },
  { name: "xanthan gum", products: 22180 },
  { name: "maltodextrin", products: 19375 },
  { name: "canola oil", products: 18630, cat: 'seed oil' },
  { name: "palm oil", products: 16788 },
  { name: "sunflower oil", products: 14957, cat: 'seed oil' },
  { name: "high fructose corn syrup", products: 14836 },
  { name: "potassium sorbate", products: 14545, cat: 'preservative' },
  { name: "caramel color", products: 13510 },
  { name: "red 40", products: 12105, cat: 'artificial dye' },
  { name: "modified corn starch", products: 11379 },
  { name: "yellow 5", products: 11209, cat: 'artificial dye' },
  { name: "carrageenan", products: 10741, cat: 'emulsifier' },
  { name: "sodium benzoate", products: 9885, cat: 'preservative' },
  { name: "blue 1", products: 9660, cat: 'artificial dye' },
  { name: "sucralose", products: 8058, cat: 'artificial sweetener' },
  { name: "yellow 6", products: 7885, cat: 'artificial dye' },
  { name: "enriched flour", products: 7124 },
  { name: "mono and diglycerides", products: 7077, cat: 'emulsifier' },
  { name: "monosodium glutamate", products: 6074 },
  { name: "sodium nitrite", products: 5778, cat: 'preservative' },
  { name: "flavoring", products: 5417, cat: 'undisclosed flavoring' },
  { name: "natural flavoring", products: 5059, cat: 'undisclosed flavoring' },
  { name: "acesulfame potassium", products: 4950, cat: 'artificial sweetener' },
  { name: "titanium dioxide", products: 4543, cat: 'artificial dye' },
  { name: "calcium propionate", products: 4382, cat: 'preservative' },
  { name: "polysorbate 80", products: 3085, cat: 'emulsifier' },
  { name: "bht", products: 3049, cat: 'preservative' },
  { name: "polysorbate 60", products: 2956, cat: 'emulsifier' },
  { name: "red 40 lake", products: 2734, cat: 'artificial dye' },
  { name: "flavor", products: 2661, cat: 'undisclosed flavoring' },
  { name: "corn oil", products: 2574, cat: 'seed oil' },
  { name: "partially hydrogenated soybean oil", products: 2486, cat: 'seed oil' },
  { name: "yellow 5 lake", products: 2357, cat: 'artificial dye' },
  { name: "aspartame", products: 2338, cat: 'artificial sweetener' },
  { name: "cottonseed oil", products: 2231, cat: 'seed oil' },
  { name: "yellow 6 lake", products: 2071, cat: 'artificial dye' },
  { name: "safflower oil", products: 1889, cat: 'seed oil' },
  { name: "blue 1 lake", products: 1878, cat: 'artificial dye' },
  { name: "bha", products: 1691, cat: 'preservative' },
  { name: "expeller pressed canola oil", products: 1546, cat: 'seed oil' },
  { name: "high oleic sunflower oil", products: 1366, cat: 'seed oil' },
  { name: "blue 2 lake", products: 1306, cat: 'artificial dye' },
  { name: "sodium metabisulfite", products: 1106, cat: 'preservative' },
  { name: "blue 2", products: 1099, cat: 'artificial dye' },
  { name: "sulfur dioxide", products: 1074, cat: 'preservative' },
  { name: "partially hydrogenated cottonseed oil", products: 903, cat: 'seed oil' },
  { name: "artificial flavoring", products: 803, cat: 'undisclosed flavoring' },
  { name: "hydrogenated soybean oil", products: 666, cat: 'seed oil' },
  { name: "rapeseed oil", products: 635, cat: 'seed oil' },
  { name: "smoke flavoring", products: 619, cat: 'undisclosed flavoring' },
  { name: "hydrogenated cottonseed oil", products: 571, cat: 'seed oil' },
  { name: "sodium nitrate", products: 488, cat: 'preservative' },
  { name: "high oleic canola oil", products: 454, cat: 'seed oil' },
  { name: "expeller pressed sunflower oil", products: 433, cat: 'seed oil' },
  { name: "interesterified soybean oil", products: 427, cat: 'seed oil' },
  { name: "rice bran oil", products: 350, cat: 'seed oil' },
  { name: "non-gmo canola oil", products: 328, cat: 'seed oil' },
  { name: "high oleic safflower oil", products: 286, cat: 'seed oil' },
  { name: "titanium dioxide color", products: 190, cat: 'artificial dye' },
  { name: "carrageenan gum", products: 173, cat: 'emulsifier' },
  { name: "sodium carboxymethylcellulose", products: 172, cat: 'emulsifier' },
  { name: "neotame", products: 163, cat: 'artificial sweetener' },
  { name: "hydrogenated rapeseed oil", products: 151, cat: 'seed oil' },
  { name: "high oleic soybean oil", products: 136, cat: 'seed oil' },
  { name: "grapeseed oil", products: 101, cat: 'seed oil' },
  { name: "msg", products: 99 },
  { name: "carboxymethylcellulose", products: 96, cat: 'emulsifier' },
  { name: "green 3", products: 95, cat: 'artificial dye' },
  { name: "acesulfame-k", products: 86, cat: 'artificial sweetener' },
  { name: "fragrance", products: 83, cat: 'undisclosed fragrance' },
  { name: "refined sunflower oil", products: 76, cat: 'seed oil' },
  { name: "orange flavor", products: 70, cat: 'undisclosed flavoring' },
  { name: "vanilla flavoring", products: 62, cat: 'undisclosed flavoring' },
  { name: "brominated soybean oil", products: 54, cat: 'seed oil' },
  { name: "mid-oleic sunflower oil", products: 54, cat: 'seed oil' },
  { name: "methyl and propyl paraben", products: 52, cat: 'paraben preservative' },
  { name: "sodium lauryl sulfate", products: 47, cat: 'sulfate surfactant' },
  { name: "fully hydrogenated soybean oil", products: 44, cat: 'seed oil' },
  { name: "refined soybean oil", products: 44, cat: 'seed oil' },
  { name: "polysorbate", products: 43, cat: 'emulsifier' },
  { name: "sodium saccharin", products: 41, cat: 'artificial sweetener' },
  { name: "highly refined soybean oil", products: 38, cat: 'seed oil' },
  { name: "low erucic acid rapeseed oil", products: 38, cat: 'seed oil' },
  { name: "polysorbate 65", products: 37, cat: 'emulsifier' },
  { name: "calcium carrageenan", products: 36, cat: 'emulsifier' },
  { name: "propylparaben", products: 32, cat: 'paraben preservative' },
  { name: "sunflower oil blend", products: 32, cat: 'seed oil' },
  { name: "sunflower oil powder", products: 31, cat: 'seed oil' },
  { name: "propyl paraben", products: 30, cat: 'paraben preservative' },
  { name: "fully hydrogenated cottonseed oil", products: 29, cat: 'seed oil' },
  { name: "fully refined soybean oil", products: 29, cat: 'seed oil' },
  { name: "methyl paraben", products: 27, cat: 'paraben preservative' },
  { name: "saccharin", products: 25, cat: 'artificial sweetener' },
  { name: "yellow 5 aluminum lake", products: 25, cat: 'artificial dye' },
  { name: "red 40 aluminum lake", products: 20, cat: 'artificial dye' },
]

// Best matches for what has been typed, prefix first then anywhere, each
// group already in product-count order.
export function suggestIngredients(raw: string, limit = 8): IngredientSuggestion[] {
  const q = raw.trim().toLowerCase()
  if (q.length < 2) return []
  const starts = INGREDIENT_SUGGESTIONS.filter((s) => s.name.startsWith(q))
  const within = INGREDIENT_SUGGESTIONS.filter((s) => !s.name.startsWith(q) && s.name.includes(q))
  return [...starts, ...within].slice(0, limit)
}

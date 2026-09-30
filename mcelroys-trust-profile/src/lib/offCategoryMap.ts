// Maps Open Food Facts categories onto Rootify's own category list
// (PRODUCT_CATEGORIES_BY_TYPE in productTypes.ts).
//
// WHY: until now every new product got category = null and waited for a
// human to pick one. That works for 76 products, not for a bulk import of
// thousands. OFF already categorizes products; this translates its labels
// into ours.
//
// HOW OFF CATEGORIES WORK: each product carries `categories_tags` — its most
// specific category PLUS every ancestor in OFF's taxonomy. A chocolate chip
// cookie is tagged something like:
//   en:snacks, en:sweet-snacks, en:biscuits-and-cakes, en:biscuits,
//   en:chocolate-biscuits, ...
// So we don't need OFF's whole ~9,000-category tree. We list a small set of
// "anchor" tags, most specific first, and the FIRST rule that matches any of
// the product's tags wins. Order therefore matters: "Toaster Pastry" must be
// checked before "Cookies" (OFF files toaster pastries under biscuits), and
// "Soup" before "Prepared Meal" (soups sit under meals).
//
// Every tag below was checked against OFF's published taxonomy
// (openfoodfacts-server/taxonomies/food/categories.txt, Sept 2026).
//
// UNMAPPED IS FINE: if nothing matches, the category stays null for a human
// to set — the same as before. The bulk import logs unmapped tags so rules
// can be added reactively, like the ingredient classification rules.
//
// NEVER OVERWRITES: callers only use this when a product has no category.
// A category a human chose is never replaced by an automatic guess.

import { PRODUCT_CATEGORIES_BY_TYPE } from './productTypes'

type Rule = { category: string; tags: string[] }

// FOOD rules, most specific first. Tags are written without the "en:" prefix.
const FOOD_RULES: Rule[] = [
  // Baby
  { category: 'Infant Formula', tags: ['infant-formulas', 'baby-formula'] },
  { category: 'Baby Food', tags: ['baby-foods'] },

  // Frozen desserts before other desserts and dairy
  { category: 'Ice Cream', tags: ['ice-creams', 'ice-creams-and-sorbets', 'frozen-desserts'] },

  // Baked goods & sweets — specific before general
  { category: 'Toaster Pastry', tags: ['toaster-pastries'] },
  { category: 'Cookies', tags: ['biscuits'] },
  { category: 'Chocolate', tags: ['chocolates', 'chocolate-candies'] },
  // Gummies and fruit snacks (added 2026-09-29 from the unmatched list)
  { category: 'Candy', tags: ['gummy-candies', 'gummies', 'fruit-snack', 'fruit-snacks'] },
  { category: 'Candy', tags: ['candies', 'confectioneries'] },
  { category: 'Snack', tags: ['protein-bars', 'energy-bars', 'cereal-bars', 'bars'] },
  // --- Added from the first bulk dry run's unmatched list (Sept 2026) ---
  // Free-form tags users typed that aren't in OFF's taxonomy, but are common.
  { category: 'Snack', tags: ['snack-bar', 'salted-snacks', 'crackers'] },
  // Added 2026-09-29 from the unmatched list (free-form tags OFF users typed)
  { category: 'Snack', tags: ['chips', 'chips-and-fries', 'plantain-chips', 'trail-mix'] },
  { category: 'Meat', tags: ['meat-snack', 'chicken-nuggets'] },
  { category: 'Bread & Bakery', tags: ['breads', 'pastries', 'cakes', 'muffins', 'pie-dough', 'tortillas', 'pancakes'] },

  // Soups & broths before "meals"
  { category: 'Broth', tags: ['broths', 'poultry-broth', 'bouillon-cubes', 'bouillon-powders', 'bouillons', 'stock-cubes', 'soup-bases', 'broth-bases'] },
  { category: 'Soup', tags: ['soups'] },

  // Ready-to-eat items with no better home (burritos, sandwiches, dinner kits)
  { category: 'Prepared Meal', tags: ['burritos', 'sandwiches', 'mexican-dinner-mixes'] },
  { category: 'Pasta', tags: ['pastas', 'noodles'] },
  { category: 'Cereal', tags: ['breakfast-cereals'] },

  // Sweeteners & spreads
  { category: 'Syrup', tags: ['maple-syrups', 'syrups'] },
  // Honey and butter are both filed under OFF's "spreads" — list them first
  // so they land in Sweetener and Dairy rather than Spread.
  { category: 'Sweetener', tags: ['honeys', 'sugars', 'sweeteners'] },
  { category: 'Dairy', tags: ['butters'] },
  // Nut and seed butters and margarine-style spreads. Added after the
  // 2026-09-28 review found ~750 of them under Cooking Fat: many carry only
  // OFF's "fats"/"vegetable-fats" plus a specific tag this list didn't have.
  { category: 'Spread', tags: ['peanut-butters', 'nut-butters', 'almond-butters', 'cashew-butters', 'seed-butters', 'sunflower-seed-butters', 'tahini', 'hazelnut-spreads', 'cocoa-and-hazelnuts-spreads', 'plant-based-spreads', 'nut-based-spreads', 'oilseed-purees', 'margarines', 'fat-spreads', 'jams', 'sweet-spreads', 'spreads'] },

  // Condiments before sauces (ketchup and mustard are also filed as sauces)
  { category: 'Condiment', tags: ['ketchup', 'mustards', 'mayonnaises', 'soy-sauces', 'vinegars', 'pickles', 'cooking-wines'] },
  { category: 'Sauce', tags: ['salsa', 'salsas', 'pasta-sauces', 'cooking-sauces', 'curry-sauces', 'tomato-sauces', 'tomato-pastes', 'sauces'] },
  // Seasoning mixes and rubs — ~2,100 had landed in Condiment via OFF's broad
  // "condiments" tag before these were listed (2026-09-28 review)
  { category: 'Spices & Seasoning', tags: ['spices', 'herbs-and-spices', 'salts', 'seasonings', 'seasoning-mixes', 'spice-mixes', 'spice-blends', 'dry-rubs', 'rubs'] },
  // Broad "condiments" only after sauces and spices, which OFF files under it
  { category: 'Condiment', tags: ['condiments'] },

  // Fats
  { category: 'Oil', tags: ['olive-oils', 'vegetable-oils', 'cooking-oil'] },
  { category: 'Cooking Fat', tags: ['ghee', 'lards', 'vegetable-fats', 'fats'] },

  // Dairy — alternatives and cheese before the broad "dairies" tag
  { category: 'Dairy Alternative', tags: ['plant-based-milk-alternatives', 'non-dairy-yogurts', 'milk-substitutes'] },
  // Coffee creamers (dairy and non-dairy) — shoppers look for them with dairy
  { category: 'Dairy', tags: ['creamer', 'creamers', 'coffee-creamers'] },
  { category: 'Cheese', tags: ['cheeses'] },
  { category: 'Dairy', tags: ['yogurts', 'milks', 'dairies'] },
  { category: 'Eggs', tags: ['eggs'] },

  // Meat & seafood — canned before fresh
  { category: 'Canned Meat', tags: ['canned-meats'] },
  { category: 'Seafood', tags: ['canned-fishes', 'seafood', 'fishes'] },
  // Before Meat: plant-based "meats" are also tagged as meat-like products
  { category: 'Meat Alternative', tags: ['meat-analogues'] },
  { category: 'Meat', tags: ['salami', 'prepared-meats', 'sausages', 'bacon', 'poultries', 'meats'] },

  // Plant staples
  { category: 'Canned Vegetable', tags: ['canned-vegetables', 'canned-legumes'] },
  // Peanuts are botanically legumes and OFF files them there, but shoppers
  // look for them with nuts (318 moved in the 2026-09-28 review)
  { category: 'Nuts & Seeds', tags: ['peanuts', 'roasted-peanuts', 'salted-peanuts', 'dry-roasted-peanuts'] },
  { category: 'Beans & Legumes', tags: ['legumes', 'pulses'] },
  { category: 'Grains & Rice', tags: ['rices', 'cereal-grains'] },
  { category: 'Flour', tags: ['flours'] },
  { category: 'Baking Ingredient', tags: ['baking-powders', 'baking-mixes', 'pancake-mixes', 'baking-decorations', 'pastry-helpers'] },
  { category: 'Canned Fruit', tags: ['canned-fruits'] },
  { category: 'Frozen Fruit', tags: ['frozen-fruits'] },
  { category: 'Frozen Vegetable', tags: ['frozen-vegetables'] },
  // Branded fresh produce (a Driscoll's clamshell) — see Product.commodityId
  { category: 'Fresh Produce', tags: ['fresh-fruits', 'fresh-vegetables', 'produce'] },
  { category: 'Snack', tags: ['dried-fruits'] },
  { category: 'Nuts & Seeds', tags: ['nut-and-seed-mixes', 'nuts', 'seeds'] },

  // Drinks — specific before the broad "beverages"
  // Alcohol (added 2026-09-29): beer, wine and spirits are in scope because
  // they can carry additives and their makers can have recalls. OFF files
  // alcohol-free beer and wine UNDER beers/wines, so those are caught first
  // and stay ordinary beverages.
  { category: 'Beverage', tags: ['non-alcoholic-beverages', 'alcohol-free-beverages', 'non-alcoholic-beers', 'alcohol-free-beers', 'non-alcoholic-wines', 'alcohol-free-wines', 'low-alcohol-beers'] },
  { category: 'Alcoholic Beverage', tags: ['alcoholic-beverages', 'beers', 'wines', 'spirits', 'ciders', 'hard-seltzers', 'liqueurs', 'sparkling-wines', 'red-wines', 'white-wines', 'rose-wines', 'whiskies', 'vodkas', 'rums', 'gins', 'tequilas', 'meads', 'sakes', 'cocktails', 'wine-based-drinks', 'beer-based-drinks'] },
  { category: 'Juice', tags: ['fruit-juices'] },
  { category: 'Coffee & Tea', tags: ['coffees', 'teas', 'herbal-teas', 'tea-bags'] },
  { category: 'Beverage', tags: ['energy-drinks', 'kombuchas', 'sodas', 'waters', 'electrolyte-drink', 'sports-drink', 'sports-drinks', 'protein-drink', 'drink-mix', 'beverages'] },

  { category: 'Supplement', tags: ['dietary-supplements', 'protein-supplement', 'protein-powders', 'vitamin-supplement', 'multivitamin', 'vitamins'] },

  // Broad buckets last
  { category: 'Prepared Meal', tags: ['meals'] },
  { category: 'Dessert', tags: ['puddings', 'desserts'] },
  { category: 'Snack', tags: ['salty-snacks', 'crisps', 'snacks'] },
]

export type CategoryMatch = { category: string; matchedTag: string }

// Returns our category for a FOOD product's OFF tags, or null if no rule
// matches. Only food is mapped: Open Beauty Facts uses a different taxonomy,
// and non-food items are few enough to categorize by hand.
export function mapOffFoodCategory(categoriesTags: unknown): CategoryMatch | null {
  if (!Array.isArray(categoriesTags)) return null
  // Tags OFF users typed in free-form arrive as "en:Salted snacks" rather
  // than the canonical "en:salted-snacks"; normalize so rules match both.
  const tags = new Set(categoriesTags.map((t) => String(t).toLowerCase().trim().replace(/\s+/g, '-')))
  for (const rule of FOOD_RULES) {
    for (const tag of rule.tags) {
      if (tags.has(`en:${tag}`)) return { category: rule.category, matchedTag: `en:${tag}` }
    }
  }
  return null
}

// SAFETY CHECK, runs once when this file loads: every category a rule can
// produce must exist in PRODUCT_CATEGORIES_BY_TYPE.food_beverage. Otherwise a
// typo here ("Diary") would quietly write thousands of invalid categories.
// Failing loudly at startup is much cheaper than cleaning that up.
const unknown = [...new Set(FOOD_RULES.map((r) => r.category))].filter(
  (c) => !PRODUCT_CATEGORIES_BY_TYPE.food_beverage.includes(c)
)
if (unknown.length > 0) {
  throw new Error(
    `offCategoryMap.ts maps to categories missing from productTypes.ts: ${unknown.join(', ')}`
  )
}

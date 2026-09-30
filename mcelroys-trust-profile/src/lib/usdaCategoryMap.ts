// Maps USDA FoodData Central "branded food categories" onto Rootify's own
// category list (PRODUCT_CATEGORIES_BY_TYPE in productTypes.ts).
//
// WHY USDA: every branded product in FoodData Central carries a category
// (branded_food_category, e.g. "Cheese", "Candy", "Canned & Bottled Beans")
// that the MANUFACTURER supplied with its label data, largely through GS1's
// data-sharing network — the retail industry's own product data standard.
// So which aisle a product belongs in is decided by the industry, not by us.
// That is the most objective categorization Rootify can cite. It is the first
// source scripts/categorize-products.ts uses.
//
// WHAT IS STILL OURS: USDA has ~200 categories, too many to browse, so each
// maps onto one of Rootify's ~46. That grouping is the one judgment call, and
// it lives in this one reviewable file. Where the grouping is unclear we
// follow USDA's own boundaries: USDA files canned beans separately from
// canned vegetables, so Rootify does too (Beans & Legumes).
//
// MIXED USDA CATEGORIES: a few USDA categories hold two of our categories
// ("Popcorn, Peanuts, Seeds & Related Snacks" is both Snack and Nuts &
// Seeds). For those a rule lists `alsoAllowed`: if the product NAME clearly
// says one of those (see nameCategoryMap.ts) that is used; otherwise the
// rule's main category. The name can only choose WITHIN USDA's category,
// never move a product out of it.
//
// HOW RULES MATCH: USDA's category text, lowercased, is tested against the
// rules in order; the first match wins. Written as patterns rather than exact
// names so small wording changes between USDA releases don't break them.
// Every USDA category seen, and what it mapped to, is printed by the
// categorize script's dry run for review. UNMAPPED IS FINE: the product then
// falls through to Open Food Facts' tags or the name.

import { PRODUCT_CATEGORIES_BY_TYPE } from './productTypes'

type UsdaRule = { pattern: RegExp; category: string | null; alsoAllowed?: string[] }

// Most specific first. category null = "USDA's category doesn't say enough;
// fall through to the next source".
const RULES: UsdaRule[] = [
  // --- Baby ---
  { pattern: /infant formula|baby formula|toddler formula/, category: 'Infant Formula' },
  { pattern: /baby|infant|toddler/, category: 'Baby Food' },

  // --- Drinks whose names contain alcohol words ---
  // "Non Alcoholic Beverages - Ready to Drink" is USDA's broad soft-drink group
  // (the first dry run filed ~950 of these under alcohol by mistake)
  { pattern: /non.?alcoholic/, category: 'Beverage', alsoAllowed: ['Juice', 'Coffee & Tea', 'Dairy Alternative', 'Supplement', 'Dairy'] },
  { pattern: /vinegar|cooking wine/, category: 'Condiment' },

  // USDA's category named just "Alcohol" holds cocktail MIXERS (Bloody Mary
  // mix, margarita mix, drink mixes) — not alcoholic drinks
  { pattern: /^alcohol$/, category: 'Beverage', alsoAllowed: ['Alcoholic Beverage', 'Juice'] },

  // --- Alcohol (rare in USDA; alcohol labels are regulated by TTB, not FDA) ---
  { pattern: /alcohol|\bbeer|\bwine(?! vinegar)|spirits|liquor|cocktail/, category: 'Alcoholic Beverage' },

  // --- Frozen desserts before other desserts and dairy ---
  { pattern: /ice cream|frozen yogurt|frozen dessert|sherbet|sorbet|frozen novelt|popsicle/, category: 'Ice Cream' },

  // Mixed "fruit & vegetables, prepared/processed" says too little on its own
  { pattern: /fruits? (&|and) vegetables?.*(prepared|processed)/, category: null },

  // --- Prepared foods that name bakery or dairy words ---
  { pattern: /breakfast sandwich|frozen breakfast/, category: 'Prepared Meal' },
  { pattern: /sushi/, category: 'Prepared Meal', alsoAllowed: ['Seafood'] },
  { pattern: /pasta (&|and) pizza sauce|pasta sauce|pizza sauce/, category: 'Sauce' },
  { pattern: /pizza/, category: 'Prepared Meal' },
  { pattern: /sandwich|wraps?\b|burrito|appetizer|hors d|entree|dinners?\b|\bmeals\b|deli salad|cooked (&|and) prepared|prepared meal|lunch|combination|side dish|sides\b|small meal|mexican dinner|sushi/,
    category: 'Prepared Meal', alsoAllowed: ['Pasta', 'Grains & Rice', 'Soup', 'Meat', 'Seafood', 'Meat Alternative', 'Bread & Bakery', 'Canned Vegetable', 'Frozen Vegetable'] },

  { pattern: /french fries|potatoes|potato\b|onion rings/, category: 'Frozen Vegetable', alsoAllowed: ['Snack'] },

  // --- Baking ---
  { pattern: /baking decoration|dessert topping|sprinkle|frosting|icing/, category: 'Baking Ingredient' },
  { pattern: /\bherbs?\b|\bspices?\b|seasonings|seasoning mix/, category: 'Spices & Seasoning', alsoAllowed: ['Baking Ingredient'] },
  { pattern: /baking additive|extract|yeast|baking powder|baking soda|leavening/, category: 'Baking Ingredient' },
  { pattern: /(cake|cookie|cupcake|brownie|bread|muffin|biscuit|pancake|waffle).*mix|mixes?.*(cake|cookie|bread|muffin)/, category: 'Bread & Bakery' },
  { pattern: /flour|corn ?meal|meal & grits|starch/, category: 'Flour', alsoAllowed: ['Baking Ingredient', 'Grains & Rice'] },
  { pattern: /baking/, category: 'Baking Ingredient' },

  // --- Sweets ---
  { pattern: /toaster pastr/, category: 'Toaster Pastry' },
  { pattern: /cakes?\b|cupcake/, category: 'Bread & Bakery', alsoAllowed: ['Snack'] },
  { pattern: /cookie|biscuit/, category: 'Cookies', alsoAllowed: ['Bread & Bakery'] },
  { pattern: /cracker|biscotti/, category: 'Snack', alsoAllowed: ['Cookies'] },
  { pattern: /pudding|custard|gelatin|gels\b|dessert/, category: 'Dessert', alsoAllowed: ['Baking Ingredient'] },
  { pattern: /chocolate/, category: 'Chocolate', alsoAllowed: ['Candy'] },
  { pattern: /candy|confection|chewing gum|\bgum\b|\bmints?\b/, category: 'Candy', alsoAllowed: ['Chocolate'] },

  // --- Bars and snacks ---
  { pattern: /granola bar|energy.*bar|snack.*bar|\bbars?\b/, category: 'Snack' },
  { pattern: /grains? (&|and) seeds|\bgrains\b/, category: 'Grains & Rice', alsoAllowed: ['Nuts & Seeds', 'Flour', 'Cereal', 'Beans & Legumes'] },
  { pattern: /popcorn|peanuts|seeds.*snack/, category: 'Snack', alsoAllowed: ['Nuts & Seeds'] },
  { pattern: /nut.*butter|seed butter|peanut butter/, category: 'Spread' },
  { pattern: /\bnuts?\b|\bseeds?\b/, category: 'Nuts & Seeds', alsoAllowed: ['Snack'] },
  { pattern: /chips|pretzel|puffs|crisps|snack/, category: 'Snack', alsoAllowed: ['Nuts & Seeds', 'Meat', 'Cheese'] },

  // --- Bakery ---
  { pattern: /bakery/, category: 'Bread & Bakery', alsoAllowed: ['Cookies', 'Snack', 'Prepared Meal'] },
  { pattern: /bread|buns?\b|rolls?\b|bagel|muffin|croissant|pastr|donut|doughnut|cakes?\b|cupcake|pies?\b|tortilla|pancake|waffle|french toast|crepe|dough|stuffing|crouton/,
    category: 'Bread & Bakery' },

  // --- Drinks ---
  { pattern: /plant based milk|non.?dairy|plant based water/, category: 'Dairy Alternative', alsoAllowed: ['Beverage'] },
  { pattern: /creamer|milk additive/, category: 'Dairy', alsoAllowed: ['Dairy Alternative'] },
  { pattern: /iced|bottled? tea|ready to drink/, category: 'Beverage' },
  { pattern: /tea bag|loose tea|\bteas?\b(?!.*(iced|bottle))|coffee/, category: 'Coffee & Tea', alsoAllowed: ['Beverage'] },
  { pattern: /frozen fruit/, category: 'Frozen Fruit', alsoAllowed: ['Juice'] },
  { pattern: /fruit juice concentrate|frozen.*juice/, category: 'Juice', alsoAllowed: ['Frozen Fruit'] },
  { pattern: /juice|nectar/, category: 'Juice', alsoAllowed: ['Beverage'] },
  { pattern: /energy.*drink|sports? drink/, category: 'Beverage', alsoAllowed: ['Supplement'] },
  { pattern: /protein|muscle|recovery|nutrition(al)? (drink|shake|supplement)|meal replacement/, category: 'Supplement', alsoAllowed: ['Beverage'] },
  { pattern: /vitamin|supplement|weight control|health care|diet aid/, category: 'Supplement' },
  { pattern: /soda|soft drink|\bwaters?\b|drinks?\b|beverage|energy|sport|powdered drink|iced|bottled? tea|kombucha|smoothie/, category: 'Beverage' },

  // --- Dairy & eggs ---
  { pattern: /ketchup|mustard/, category: 'Condiment', alsoAllowed: ['Sauce'] },
  { pattern: /salad dressing/, category: 'Sauce', alsoAllowed: ['Condiment'] },
  { pattern: /cheese sauce|cheese dip/, category: 'Sauce' },
  { pattern: /cheese/, category: 'Cheese' },
  { pattern: /yogh?urt|kefir/, category: 'Dairy', alsoAllowed: ['Dairy Alternative'] },
  { pattern: /egg/, category: 'Eggs' },
  { pattern: /nut.*butter|seed butter|peanut butter/, category: 'Spread' },
  { pattern: /butter|margarine/, category: 'Dairy', alsoAllowed: ['Spread', 'Dairy Alternative'] },
  { pattern: /milk|cream|dairy/, category: 'Dairy', alsoAllowed: ['Dairy Alternative'] },

  // --- Spreads & sweeteners (sauces first: "Sauces/Spreads/Dips/Condiments") ---
  { pattern: /sauce|gravy|marinade|dips?\b|salsa|hummus/, category: 'Sauce', alsoAllowed: ['Spread', 'Condiment'] },
  { pattern: /jam|jelly|fruit spread|preserves|marmalade|spreads?\b/, category: 'Spread' },
  { pattern: /honey/, category: 'Sweetener' },
  { pattern: /syrup|molasses/, category: 'Syrup', alsoAllowed: ['Sweetener'] },
  { pattern: /sugar|sweetener/, category: 'Sweetener' },

  // --- Sauces, condiments, seasonings, oils ---
  { pattern: /pickle|olive|relish|chutney|peppers? /, category: 'Condiment' },
  { pattern: /ketchup|mustard|mayonnaise|vinegar|condiment/, category: 'Condiment', alsoAllowed: ['Sauce'] },
  { pattern: /salad dressing|dressing/, category: 'Sauce', alsoAllowed: ['Condiment'] },
  { pattern: /seasoning|spice|herbs?\b|salts?\b|tenderizer|breading|coating/, category: 'Spices & Seasoning', alsoAllowed: ['Sauce'] },
  { pattern: /\boils?\b|shortening|cooking spray|\blard\b|\bfats?\b/, category: 'Oil', alsoAllowed: ['Cooking Fat'] },

  // --- Soups ---
  { pattern: /broth|stock|bouillon|soup base/, category: 'Broth', alsoAllowed: ['Soup'] },
  { pattern: /soup|chili|stew|chowder/, category: 'Soup', alsoAllowed: ['Broth', 'Prepared Meal'] },

  // --- Grains & pasta ---
  { pattern: /pasta dinner|pasta dish|noodle dish/, category: 'Prepared Meal', alsoAllowed: ['Pasta'] },
  { pattern: /pasta|noodle/, category: 'Pasta' },
  { pattern: /cereal|granola|oatmeal|\boats?\b/, category: 'Cereal' },
  { pattern: /rice|grain|quinoa|couscous/, category: 'Grains & Rice', alsoAllowed: ['Prepared Meal', 'Pasta'] },

  // --- Beans (USDA keeps them apart from canned vegetables) ---
  { pattern: /beans?\b|legume|lentil|peas\b/, category: 'Beans & Legumes' },

  // --- Meat, seafood, alternatives ---
  { pattern: /vegetarian|meat substitute|meat alternative|tofu|soy product|plant based (meat|protein)/, category: 'Meat Alternative' },
  { pattern: /canned tuna|canned seafood|canned fish/, category: 'Seafood' },
  { pattern: /canned (meat|chicken|poultry)/, category: 'Canned Meat' },
  { pattern: /fish|seafood|shellfish|tuna|salmon|shrimp/, category: 'Seafood' },
  { pattern: /bacon|sausage|hot ?dog|brats?\b|pepperoni|salami|cold cut|luncheon|deli meat|meats?\b|poultry|chicken|turkey|beef|pork|lamb|jerky|burgers?|patties/,
    category: 'Meat', alsoAllowed: ['Meat Alternative'] },

  // --- Fruit & vegetables ---
  { pattern: /canned fruit|fruit.*(canned|jarred)|applesauce/, category: 'Canned Fruit', alsoAllowed: ['Dessert'] },
  { pattern: /frozen fruit/, category: 'Frozen Fruit' },
  { pattern: /dried fruit/, category: 'Snack' },
  { pattern: /canned vegetable|vegetables.*(canned|jarred)|tomato/, category: 'Canned Vegetable' },
  { pattern: /frozen vegetable/, category: 'Frozen Vegetable' },
  { pattern: /pre.?packaged fruit|fresh|produce/, category: 'Fresh Produce', alsoAllowed: ['Canned Fruit', 'Canned Vegetable', 'Frozen Fruit', 'Frozen Vegetable'] },
  // Mixed "fruit & vegetable" categories say too little on their own
  { pattern: /fruit|vegetable/, category: null },
]

export type UsdaCategoryMatch = { category: string; rule: string }

// Maps one USDA category text. `nameGuess` is what the product name says
// (from categorizeByName), used only to choose within a mixed USDA category.
// Tofu, tempeh and plant-based "meats" that USDA files with meat
const PLANT_PROTEIN = /\b(tofu|tempeh|seitan|plant.?based|vegan|meatless|meat.?free)\b/i

export function mapUsdaCategory(usdaCategory: string, nameGuess?: string | null, productName?: string): UsdaCategoryMatch | null {
  const text = usdaCategory.toLowerCase().replace(/\s+/g, ' ').trim()
  // Some USDA records carry a whole GS1 definition paragraph instead of a
  // category name ("Includes any products that can be described/observed
  // as..."). Keyword rules misread those, so they fall through instead.
  if (!text || text.length > 90) return null
  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue
    if (!rule.category) return null
    if (nameGuess && rule.alsoAllowed?.includes(nameGuess)) return { category: nameGuess, rule: rule.pattern.source }
    if (rule.category === 'Meat' && productName && PLANT_PROTEIN.test(productName)) return { category: 'Meat Alternative', rule: rule.pattern.source }
    return { category: rule.category, rule: rule.pattern.source }
  }
  return null
}

// SAFETY CHECK (same as offCategoryMap.ts): every category a rule can produce
// must exist in productTypes.ts.
const produced = new Set(RULES.flatMap((r) => [r.category, ...(r.alsoAllowed ?? [])]).filter((c): c is string => !!c))
const unknownUsda = [...produced].filter((c) => !PRODUCT_CATEGORIES_BY_TYPE.food_beverage.includes(c))
if (unknownUsda.length > 0) {
  throw new Error(`usdaCategoryMap.ts maps to categories missing from productTypes.ts: ${unknownUsda.join(', ')}`)
}

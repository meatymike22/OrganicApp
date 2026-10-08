// Shared ingredient classification rules, used by BOTH ingest-openfoodfacts.ts
// and ingest-openbeautyfacts.ts.
//
// Kept in one place deliberately: these rules grow over time as new ingredients
// turn up in real product data, and duplicating them across scripts guarantees
// they eventually drift apart.
//
// SCOPING PRINCIPLE: only ingredients that plausibly warrant dedicated safety
// research get flagged — additives, preservatives, processing agents, and
// trade-secret-protected categories. Whole foods (quinoa, flax, sea salt) are
// deliberately NOT flagged; their relevant health information is the nutrition
// panel, not per-ingredient toxicology. This mirrors how Yuka scopes its own
// additive research rather than trying to study every ingredient.
//
// MAINTENANCE: rules are added REACTIVELY — when a real ingredient appears in
// ingested product data that should be flagged but isn't, add it here. Don't
// pre-build speculative lists of additives that may never appear in the catalog.
//
// ------------------------------------------------------------------------
// 2026-10-07: A LARGE REACTIVE ADDITION, with the counts that justified it.
// This is the policy above being exercised, not bent.
//
// Found while writing hover explainers for the ingredient filters: several of
// the commonest additives in the catalogue had NO category, so the filters
// silently missed them — a product containing soy lecithin passed a "no
// emulsifiers" filter. Michael, on a Keto ice cream bar: "yuka has this as an
// additive and sources to go with the risk, but we dont. fix that". That was
// steviol glycoside, uncategorised, along with every other non-sugar
// sweetener and sugar alcohol in the catalogue.
//
// Products containing each thing added below:
//   spices 36,359 · soy lecithin 30,962 · xanthan gum 22,180 · vegetable oil
//   16,316 · guar gum 15,257 · caramel color 13,510 · locust bean gum 6,175 ·
//   carob bean gum 3,067 · sorbitol 2,841 · stevia leaf extract 2,210 ·
//   gum acacia 2,072 · erythritol 1,639 · monk fruit extract 1,613 ·
//   maltitol 1,063 · stevia 685 · allulose 675 · xylitol 565 ·
//   steviol glycoside 549 · propyl gallate 498
//
// TWO THINGS TO KNOW BEFORE EDITING THESE:
//
// 1. A NEW KEYWORD CHANGES `flaggedForResearch` TOO, for every ingredient it
//    matches. That is correct — the flag means "an additive or processing
//    ingredient worth researching" — but the flagged counts on product pages
//    jump, and we hold no research on most of these. The product and
//    ingredient pages were fixed in rounds 9-11 to say "classified as worth
//    checking, not yet researched" rather than implying a finding, so this is
//    honest now. It would NOT have been before those fixes.
//
// 2. CHANGING A RULE DOES NOTHING TO EXISTING ROWS. classifyIngredient runs
//    at ingest. Run `npx tsx scripts/reclassify-ingredients.ts` (dry run by
//    default) to apply a change to the ingredients already stored.
// ------------------------------------------------------------------------

import { normalizeIngredientName } from './ingredientNormalization'

export type IngredientClassification = {
  category: string | null
  flaggedForResearch: boolean
}

export const CLASSIFICATION_RULES: { category: string; keywords: string[] }[] = [
  // --- Food-oriented categories ---
  {
    category: 'seed oil',
    keywords: [
      'canola oil', 'rapeseed oil', 'soybean oil', 'corn oil', 'cottonseed oil',
      'sunflower oil', 'safflower oil', 'grapeseed oil', 'rice bran oil',
      // Generic, and in practice almost always a soy or canola blend.
      // NOT 'palm oil': palm is pressed from the fruit, not the seed, so
      // filing it under seed oil would be wrong even though people group them.
      'vegetable oil',
    ],
  },
  {
    category: 'artificial sweetener',
    keywords: [
      'aspartame', 'sucralose', 'saccharin', 'acesulfame potassium', 'acesulfame-k',
      'neotame', 'advantame',
    ],
  },
  {
    // A SEPARATE CATEGORY, not more keywords under 'artificial sweetener'.
    // Stevia and monk fruit are plant extracts and erythritol is a sugar
    // alcohol; calling any of them "artificial" would be a false label on our
    // own page. They belong with the artificial ones in the FILTER — someone
    // avoiding sweeteners wants all of them — which is why the filter maps to
    // both categories and is named "No sugar substitutes" rather than
    // "No artificial sweeteners". See ingredientFilters.ts.
    category: 'sugar substitute',
    keywords: [
      // Sugar alcohols.
      'erythritol', 'maltitol', 'sorbitol', 'xylitol', 'isomalt', 'mannitol',
      'lactitol',
      // Plant-derived non-sugar sweeteners. Both spellings are needed:
      // "steviol" does not contain "stevia".
      'stevia', 'steviol', 'monk fruit', 'luo han guo', 'allulose',
      'thaumatin',
    ],
  },
  {
    category: 'preservative',
    keywords: [
      'sodium benzoate', 'potassium sorbate', 'bha', 'bht', 'sodium nitrite',
      'sodium nitrate', 'calcium propionate', 'sulfur dioxide', 'sodium metabisulfite',
      // Added 2026-10-07. Antioxidant preservatives and sulfites that were
      // turning up uncategorised in real labels.
      'propyl gallate', 'tbhq', 'tert-butylhydroquinone', 'sodium erythorbate',
      'potassium benzoate', 'sorbic acid', 'benzoic acid', 'sodium sulfite',
      'sodium bisulfite', 'potassium metabisulfite', 'natamycin',
      'sodium propionate', 'potassium propionate',
    ],
  },
  {
    category: 'artificial dye',
    keywords: [
      'red 40', 'yellow 5', 'yellow 6', 'blue 1', 'blue 2', 'green 3',
      'fd&c', 'titanium dioxide',
      // Added 2026-10-07: an added colouring on 13,510 products and
      // uncategorised. Made by caramelising sugar rather than synthesised,
      // which is why the filter it feeds is named "No added colors" rather
      // than "No artificial dyes" — the category keeps its name so no stored
      // row has to change.
      'caramel color',
    ],
  },
  {
    category: 'emulsifier',
    keywords: [
      'polysorbate', 'carrageenan', 'carboxymethylcellulose', 'mono- and diglycerides',
      // Added 2026-10-07. Emulsifiers, stabilisers and thickening gums. Soy
      // lecithin alone is on 30,962 products and was passing a "no
      // emulsifiers" filter untouched.
      //
      // Taxonomically these are not all emulsifiers — guar and xanthan are
      // thickeners. The category keeps its name so no stored row has to be
      // migrated, and the FILTER is named "No emulsifiers or gums", which is
      // what it actually does. Naming is in ingredientFilters.ts.
      //
      // 'lecithin' as a substring catches soy, sunflower and egg lecithin,
      // which is intended. Bare 'gum' is deliberately NOT a keyword: it would
      // match chewing gum, gum base and guar-free products alike.
      'lecithin', 'xanthan gum', 'guar gum', 'locust bean gum', 'carob bean gum',
      'gum acacia', 'gum arabic', 'cellulose gum', 'gellan gum', 'tara gum',
      'tragacanth', 'mono and diglycerides', 'datem',
      'sodium stearoyl lactylate', 'polyglycerol ester',
    ],
  },
  {
    category: 'undisclosed flavoring',
    // "Flavor" / "natural flavor" / "artificial flavor" can legally conceal
    // dozens of undisclosed component chemicals under trade-secret protection —
    // the consumer cannot see what is actually in it. Flagged for the same
    // reason as "fragrance" below: the concern is non-disclosure, not a known
    // harm. Added reactively after "flavor" appeared in real ingested data.
    // (No separate British 'flavour' keyword: names are normalized to US
    // spelling first, and a bare 'flavor' keyword would match every named
    // flavor — 'malt flavor', 'orange flavor' — which is exactly what the
    // exact-match rule below exists to avoid.)
    keywords: ['natural flavor', 'artificial flavor', 'flavoring'],
    // NOTE: bare "flavor" is handled as an exact-match special case in
    // classifyIngredient() below, since substring-matching "flavor" alone
    // would also catch legitimate named flavors.
  },

  // --- Cosmetic / personal care categories ---
  {
    category: 'paraben preservative',
    keywords: ['paraben', 'methylparaben', 'propylparaben', 'butylparaben', 'ethylparaben'],
  },
  {
    category: 'phthalate',
    keywords: ['phthalate', 'dbp', 'dehp', 'diethyl phthalate'],
  },
  {
    category: 'formaldehyde releaser',
    keywords: [
      'formaldehyde', 'quaternium-15', 'dmdm hydantoin',
      'imidazolidinyl urea', 'diazolidinyl urea',
    ],
  },
  {
    category: 'sulfate surfactant',
    keywords: ['sodium lauryl sulfate', 'sodium laureth sulfate', 'ammonium lauryl sulfate'],
  },
  {
    category: 'undisclosed fragrance',
    keywords: ['fragrance', 'parfum'],
  },
  {
    category: 'ethanolamine',
    keywords: ['diethanolamine', 'triethanolamine', 'cocamide dea', 'cocamide mea'],
  },
  {
    category: 'antimicrobial preservative',
    // Added reactively after benzalkonium chloride appeared in real ingested
    // data (WaterWipes). A quaternary ammonium antimicrobial that is the
    // subject of ongoing safety discussion, particularly for infant products.
    keywords: ['benzalkonium chloride', 'benzethonium chloride', 'chlorhexidine'],
  },
]

// Ingredient names that should be flagged on an EXACT match only. Substring
// matching would over-trigger on these — e.g. matching "flavor" as a substring
// would wrongly flag "vanilla flavor extract from real beans".
const EXACT_MATCH_RULES: Record<string, string> = {
  'flavor': 'undisclosed flavoring',
  'flavour': 'undisclosed flavoring',
  'flavors': 'undisclosed flavoring',
  'flavours': 'undisclosed flavoring',
  // Added 2026-10-07. "Spices" is a blend the label does not break down —
  // the same non-disclosure concern as "natural flavor", and it is on 36,359
  // products. EXACT match only: a substring rule on 'spice' would also catch
  // 'allspice', which is one named spice and discloses itself perfectly well.
  'spices': 'undisclosed flavoring',
  'spice': 'undisclosed flavoring',
  'spice blend': 'undisclosed flavoring',
  'seasoning': 'undisclosed flavoring',
  'seasonings': 'undisclosed flavoring',
}

// Keywords go through the SAME normalization as ingredient names, so a rule
// written as "mono- and diglycerides" or "fd&c" still matches the stored
// canonical spelling ("mono and diglycerides", "fd and c red 40"). Without
// this, normalizing names would have silently stopped these rules firing.
const norm = (s: string) => normalizeIngredientName(s) ?? s.toLowerCase().trim()
const NORMALIZED_RULES = CLASSIFICATION_RULES.map((rule) => ({
  category: rule.category,
  keywords: rule.keywords.map(norm),
}))
const NORMALIZED_EXACT: Record<string, string> = Object.fromEntries(
  Object.entries(EXACT_MATCH_RULES).map(([k, v]) => [norm(k), v])
)

export function classifyIngredient(name: string): IngredientClassification {
  const lower = norm(name)

  // Exact-match rules first, so they aren't shadowed by broader substring rules
  if (NORMALIZED_EXACT[lower]) {
    return { category: NORMALIZED_EXACT[lower], flaggedForResearch: true }
  }

  for (const rule of NORMALIZED_RULES) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) {
      return { category: rule.category, flaggedForResearch: true }
    }
  }

  return { category: null, flaggedForResearch: false }
}

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
    category: 'preservative',
    keywords: [
      'sodium benzoate', 'potassium sorbate', 'bha', 'bht', 'sodium nitrite',
      'sodium nitrate', 'calcium propionate', 'sulfur dioxide', 'sodium metabisulfite',
    ],
  },
  {
    category: 'artificial dye',
    keywords: [
      'red 40', 'yellow 5', 'yellow 6', 'blue 1', 'blue 2', 'green 3',
      'fd&c', 'titanium dioxide',
    ],
  },
  {
    category: 'emulsifier',
    keywords: [
      'polysorbate', 'carrageenan', 'carboxymethylcellulose', 'mono- and diglycerides',
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

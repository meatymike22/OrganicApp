// ONE canonical spelling for every ingredient name stored in Ingredient.name.
//
// WHY: Ingredient is a SHARED table — one row per substance, researched once
// (IngredientStudy, IngredientRegulatoryStatus) and reused by every product
// that contains it. That only works if the same substance always lands on the
// same row. Labels spell things many ways, and before this module the
// database already held pairs like:
//   "carrot" / "carrots"              "natural flavor" / "natural flavors"
//   "live & active cultures" / "live and active cultures"
//   "zinc sulphate" (UK) vs what a US label would call "zinc sulfate"
//   "cayenne" / "cayenne*"            "apple" / "apple*^" (footnote markers)
// Each pair is two rows: a study attached to one is invisible on products
// linked to the other, and a filter for one misses the other. At bulk-import
// scale that multiplies into thousands of split rows.
//
// USED BY: ingredientParsing.ts (every name it outputs), ingredientStore.ts
// (every lookup/create), ingredientClassification.ts (keyword matching), and
// scripts/normalize-ingredients.ts (one-off cleanup of existing rows).
//
// DESIGN RULE — conservative on purpose. A normalization that wrongly MERGES
// two different substances is worse than one that leaves two spellings apart,
// because a merge silently attaches one substance's research to another. So:
//   - spelling/format differences are normalized automatically (safe)
//   - true synonyms ("soybean lecithin" = "soy lecithin") go in ALIASES by
//     hand, reactively, as they turn up in real data — same maintenance
//     approach as the classification rules. No speculative lists.

// British → American spellings, applied as whole-word replacements. US labels
// are the target audience, so US spelling is canonical.
const SPELLING: Record<string, string> = {
  flavour: 'flavor',
  flavours: 'flavors',
  flavouring: 'flavoring',
  flavourings: 'flavorings',
  colour: 'color',
  colours: 'colors',
  colouring: 'coloring',
  fibre: 'fiber',
  fibres: 'fibers',
  sulphate: 'sulfate',
  sulphates: 'sulfates',
  sulphite: 'sulfite',
  sulphites: 'sulfites',
  sulphur: 'sulfur',
  yoghurt: 'yogurt',
  stabiliser: 'stabilizer',
  stabilisers: 'stabilizers',
  caramelised: 'caramelized',
  pasteurised: 'pasteurized',
  homogenised: 'homogenized',
  demineralised: 'demineralized',
  hydrolysed: 'hydrolyzed',
  skimmed: 'skim',
  aluminium: 'aluminum',
}

// Hand-maintained synonyms: left side is a spelling seen in real data, right
// side is the canonical row it belongs to. Keys and values must already be in
// normalized form (lowercase, singular). Add entries reactively.
export const ALIASES: Record<string, string> = {
  'soybean lecithin': 'soy lecithin',
  'flaxseed': 'flax seed',
}

// Words that are never an ingredient on their own — label headers, footnote
// residue, and fragments left over from missing commas in the source text.
const JUNK = new Set([
  'organic', 'ingredient', 'ingredients', 'contains', 'and', 'or', 'and/or',
  'vitamin', 'vitamins', 'mineral', 'minerals', 'extract', 'hydrolyzed',
  'subst', 'biologique', 'bio', 'other ingredients', 'less than 2% of',
  'vitamins and minerals', 'minerals and vitamins', 'vitamin and mineral blend',
  'vitamin blend', 'mineral blend', 'or less of', 'less of', 'less than',
  'of', 'the following', 'contains one or more of the following',
  // Added after the 2026-09-28 data review: fragments left when a label's
  // words were split apart ("fd" from "FD&C", "vit", "inc", "llc", "dv"),
  // and abbreviations that name nothing on their own.
  'vit', 'inc', 'fd', 'lt', 'us', 'u.s', 'usa', 'com', 'sat', 'llc', 'ltd',
  'co', 'hig', 'org', 'min', 'od', 'non', 'ble', 'ca', 'sa', 'con', 'na',
  'sod', 'su', 'alt', 'di', 'may', 'vi', 'nj', 'dv', 'rda', 'sea', 'raw',
  'red', 'mg', 'the following ingredient', 'following', 'less than 1% of',
  'less than 0.5% of', 'or less',
  'added', 'added as', 'as', 'color added',
])

// Whole phrases that are label boilerplate, not ingredients: allergen and
// facility statements, distributor lines, storage instructions, footnotes.
// The review found ~1,700 of these stored as ingredients ("allergen
// information", "manufactured in a facility that processes peanut",
// "keep refrigerated", "† adds a trivial amount of fat").
const BOILERPLATE = [
  // A bare claim, not an ingredient: "no sugar added", "no preservatives".
  // (When a real ingredient follows the claim — "no salt cashew" — the claim
  // is stripped off instead; see NO_CLAIM_PREFIX.)
  /^no$/,
  /^(big\s+\d+\s+)?allerg/,
  // Section headers left after the colon split: "more of the following",
  // "may not contain"
  /^(or\s+)?(more|less)\s+of\s+(each\s+of\s+)?the\s+following$/,
  /^may\s+(not\s+)?contain\b/,
  /\bregistered trademark\b|\btrademark of\b/,
  /\b(sat\.?|trans|total)\s+fat\b/,
  /^per ser/,
  /^(fat|sodium|protein|carbs?|carbohydrates?|sugars?|calories|fiber)\s+\d+(\.\d+)?\s*(g|mg)?$/,
  /^(a\s+|for\s+)?allerg(en|y|ens)\b/,
  /\b(manufactured|distributed|produced|processed|made|packaged)\s+(in|by|for|on|exclusively|and)\b/,
  // "packed by/for ..." is a distributor line; "packed in" is only
  // boilerplate before a place ("packed in u.s.a") — "packed in water" is
  // the packing medium (see PACKED_IN_MEDIUM and the parser's split).
  /\bpacked\s+(by|for|on|exclusively)\b/,
  /\bpacked in (u\.?s\.?a?|usa|canada|mexico|china|the|a facility)\b/,
  /\bfacility\b/,
  /\b(shared|same)\s+equipment\b/,
  /\bequipment that\b/,
  /^(keep\s+)?refrigerate/,
  /^keep (refrigerated|frozen)/,
  /^see ingredients\b/,
  /\bwarning\b/,
  /^(per\s+)?serving$/,
  /^best by\b/,
  /^organically produced$/,
  /\bingredients? may vary\b/,
  /\badds an? (trivial|dietarily insignificant) amount\b/,
  /^(proudly\s+)?distributed\b/,
  /\bwww\.|\.com\b/,
]

// Label claims that sometimes get glued onto the next ingredient:
// "no salt cashew" → cashew, "no sugar added dates syrup" → dates syrup,
// "no added antibiotic chicken" → chicken. Alone, the claim is removed.
const NO_CLAIM_PREFIX =
  /^no\s+(?:added\s+)?(?:artificial\s+|high\s+fructose\s+)?(?:sugars?|salt|preservatives?|msg|nitrites?|nitrates?|colou?rs?|colou?rings?|flavou?rs?|flavou?rings?|ingredients?|gluten|alcohol|additives?|sweeteners?|concentrate|wheat(?:\s+ingredients?)?|soy|eggs?|fish|milk|dairy(?:\s+ingredients?)?|lactose|caffeine|water|starch(?:es)?|seed\s+oils?|corn\s+syrup|antibiotics?|hormones?|onion|garlic|juice|smoke|visible\b.*|ingredients\s+found|contiene\b.*|flavoring\s+agent\b.*)(?:\s+(?:added|used))?(?:\s+|$)/

// "packed in water", "packed in vinegar", "packed in natural pork casing":
// the packing medium IS an ingredient. Other "packed in/for" lines are
// distributor boilerplate (see BOILERPLATE).
const PACKED_IN_MEDIUM = /^packed in (?!.*\b(u\.?s\.?a?|usa|canada|mexico|china|facility)\b)/

// Standalone B/D/K vitamin codes, left when "vitamins b6, b12, d3" was
// split into items. Mapped back to the full vitamin name.
const BARE_VITAMIN = /^(b(?:1|2|3|5|6|7|9|12)|d[23]|k[12])$/

// Marketing words that sometimes lead an ingredient name without changing
// what the substance is ("PURE cane sugar", "100% whole grain oat flour").
// Stripped from the FRONT only, repeatedly.
const LEADING_MARKETING = /^(pure|100\s*%|all natural)\s+/

// "Organic cane sugar" and "cane sugar" are the SAME substance — organic is a
// fact about how THIS product sourced it, which ProductIngredient records in
// isOrganicSourced. So the word is removed from the name and reported back
// as a flag instead of being lost.
const LEADING_ORGANIC = /^(certified\s+)?organic\s+/

// ---- Singular form ----------------------------------------------------
// Only the LAST word is singularized ("brussels sprouts" → "brussels sprout",
// not "brussel sprout"), and only by these rules. Words that merely END in
// "s" (molasses, citrus, asparagus, hummus) are protected by the checks and
// the exception list.
const NEVER_SINGULARIZE = new Set([
  'molasses', 'hummus', 'couscous', 'asparagus', 'citrus', 'hibiscus',
  'species', 'series', 'swiss', 'glass', 'grass', 'bass', 'lotus', 'cactus',
  'octopus', 'oats', 'greens', 'peas', 'lentils', 'chickpeas',
  'grits', 'spices', 'herbs', 'nucleotides', 'tocopherols', 'polysorbates',
  'solids', 'sprinkles', 'bitters', 'cultures', 'diglycerides', 'triglycerides',
])
// NOTE: foods commonly written in the plural on labels ("oats", "peas",
// "spices", "cultures") are kept plural — "oat" or "spice" would look wrong
// on the page, and the singular form rarely appears on labels anyway.
// Their singular spellings are folded INTO the plural here instead:
const PLURAL_CANONICAL: Record<string, string> = {
  oat: 'oats', pea: 'peas', lentil: 'lentils', chickpea: 'chickpeas',
  spice: 'spices', herb: 'herbs', nucleotide: 'nucleotides',
  tocopherol: 'tocopherols', culture: 'cultures',
}
const IRREGULAR: Record<string, string> = {
  leaves: 'leaf', berries: 'berry', cherries: 'cherry', potatoes: 'potato',
  tomatoes: 'tomato', mangoes: 'mango', peaches: 'peach', radishes: 'radish',
  anchovies: 'anchovy', loaves: 'loaf', chilies: 'chili', chillies: 'chilli',
}

function singularizeWord(word: string): string {
  if (PLURAL_CANONICAL[word]) return PLURAL_CANONICAL[word]
  if (NEVER_SINGULARIZE.has(word)) return word
  if (IRREGULAR[word]) return IRREGULAR[word]
  if (word.length <= 3) return word // "gas", "yes", abbreviations
  if (/(ss|us|is)$/.test(word)) return word // glass, citrus, cannabis
  if (/rries$/.test(word)) return word.slice(0, -3) + 'y' // cranberries → cranberry
  // (other "-ies" words just drop the "s": cookies → cookie, brownies → brownie)
  if (/(ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2) // peaches, radishes
  if (/oes$/.test(word)) return word.slice(0, -2) // tomatoes
  if (/s$/.test(word) && !/'s$/.test(word)) return word.slice(0, -1) // carrots → carrot
  return word
}

function singularizeLastWord(name: string): string {
  const words = name.split(' ')
  const last = words[words.length - 1]
  // Leave chemical/technical tokens alone (contain digits or hyphens):
  // "b12", "gbi-30", "5-monophosphate"
  if (/[\d-]/.test(last)) return name
  words[words.length - 1] = singularizeWord(last)
  return words.join(' ')
}

// ---- Main entry points ------------------------------------------------
export type NormalizedIngredient = {
  name: string
  // True when the name itself said "organic" (e.g. "organic cane sugar").
  // Labels that use the "*" footnote convention are detected by the parser.
  organic: boolean
}

// Returns the canonical name, or null when the text isn't an ingredient at
// all (a header like "vitamins:", a footnote fragment, an empty string).
export function normalizeIngredientName(raw: string): string | null {
  return normalizeIngredient(raw)?.name ?? null
}

export function normalizeIngredient(raw: string): NormalizedIngredient | null {
  let s = raw
    // Trademark symbols before NFKD (which would turn ™ into the letters "TM")
    .replace(/[\u2122\u00ae\u00a9]/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents: jalapeño → jalapeno
    .toLowerCase()
    // Mis-decoded footnote marks: "†" and "‡" read with the wrong encoding
    // become "â€" and "â€¡", which after the accent strip above are "a€",
    // "a€¡" or "a¢a€a¡" ("cocoa buttera€¡"). 212 rows in the review.
    .replace(/(?:a¢)?a€a?[¡\u0099\u009d]?/g, ' ')
    .replace(/[‘’ʼ]/g, "'")
    // Curly and square brackets are parentheses on many labels
    .replace(/[{[]/g, '(')
    .replace(/[}\]]/g, ')')
    .replace(/&/g, ' and ')
    // "natural and and artificial flavor" (a doubled word on the label)
    .replace(/\b(and|or)\s+\1\b/g, '$1')
    // Footnote markers anywhere at the ends: "apple*^", "†salt", "sugar**"
    .replace(/^[\s*^†‡#°¹²³]+|[\s*^†‡#°¹²³]+$/g, '')
    // A trailing colon marks a group header ("vitamins:") — drop the colon;
    // the JUNK check below then removes bare headers.
    .replace(/:+$/, '')
    // "mono- and diglycerides" → "mono and diglycerides" (hyphen + space
    // is a suspended compound, not part of a chemical name)
    .replace(/(\w)-\s+/g, '$1 ')
    // "vitamin b-12" / "vitamin b 12" → "vitamin b12"
    .replace(/\bvitamin ([a-k])[\s-]+(\d+)\b/g, 'vitamin $1$2')
    // Certified colors: "FD&C Red #40", "fd and c yellow no. 5" → "red 40",
    // "yellow 5" — the form US labels most often use and the classification
    // rules match. ("&" was already turned into "and" above.)
    .replace(/\bf\.?\s*d\.?\s*and\s*c\.?\s+/g, '')
    .replace(/\b(red|yellow|blue|green|orange|citrus red)\s*(?:#|no\.?)\s*(\d+)/g, '$1 $2')
    // Purpose statements that labels attach to an ingredient: "potassium
    // sorbate to maintain freshness", "bht added to help protect flavor",
    // "citric acid (as a preservative)". They describe WHY it's there, not
    // WHAT it is, and made each wording its own ingredient row.
    .replace(/\s+(?:added\s+)?(?:to|for)\s+(?:help\s+)?(?:maintain|preserve|retain|protect|promote|keep|prevent|preserving|maintaining|retaining|protecting|freshness|color|colour|flavor|flavour|texture|consistency)\b.*$/, '')
    .replace(/\s+(?:as\s+(?:an?\s+)?)(?:preservative|antioxidant|emulsifier|stabilizer|thickener|anticaking agent|color|colour)\b.*$/, '')
    // Concentration statements left on the front of a name: "less than 2%
    // silicon dioxide", "2% or less of salt", "not more than 2% silicon
    // dioxide", "less than 1/10 of 1% potassium sorbate". The parser records
    // these as trace; the name is just the substance.
    .replace(/^less\s+than\s+\d+\s*ppm\s+(?:of\s+)?/, '')
    .replace(/^(?:contains\s+)?(?:(?:less\s+than|not\s+more\s+than|no\s+more\s+than)\s+[\d./]+(?:\s*(?:%|percent))?(?:\s+of\s+[\d.]+\s*(?:%|percent))?|[\d.]+\s*%\s+or\s+less)(?:\s+of)?(?:\s*:)?\s*/, '')
    // "includes blue 1 lake", "including red 40", "incl. paprika"
    .replace(/^(?:includes?|including|include|incl\.?)\s+/, '')
    // "two percent or less of the following: salt", "or less of the
    // following: sugar" (the number was split off), "consists of milk
    // chocolate", "less than 50 ppm sulfur dioxide"
    .replace(/^(?:(?:\d+(?:\.\d+)?|one|two|three)\s*(?:%|percent)\s+)?or\s+(?:less|more)\s+of(?:\s+each)?(?:\s+of)?(?:\s+the\s+following)?\s*:?\s*/, '')
    .replace(/^(?:each\s+of\s+)?the\s+following\s*:\s*/, '')
    .replace(/^(?:a\s+)?blend\s+of\s+/, '')
    .replace(/^(?:ingredients\s+)?consists?\s+of\s+/, '')

    // "c red 40" — the "FD&C" prefix split at the "&", leaving a stray "c"
    .replace(/^c\s+(?=(?:red|yellow|blue|green|orange)\s+\d)/, '')
    // "sodium benzoate added", left when "as a preservative" came off
    .replace(/\s+added$/, '')
    // A leading "with", "and" or "or" is a fragment of the sentence the label
    // was written as ("...benzoic acid, and sodium benzoate"), not the name
    .replace(/^(with|and|or|and\/or)\s+/, '')
    // Trailing percentages: "chocolate 11%" (the % is concentration info,
    // not part of the substance's name)
    .replace(/\s*\d+(\.\d+)?\s*%$/, '')
    // Percentages at the front: "100 % grass-fed milk"
    .replace(/^\d+(\.\d+)?\s*%\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.,;:\s]+|[.,;:\s]+$/g, '')
    .trim()

  // British spellings, whole words only
  s = s.replace(/[a-z]+/g, (w) => SPELLING[w] ?? w)

  // Leading marketing words and "organic", repeatedly, in any order
  // ("pure organic maple syrup", "organic 100% grass-fed milk")
  let organic = false
  let prev = ''
  while (prev !== s) {
    prev = s
    if (LEADING_ORGANIC.test(s)) organic = true
    s = s
      .replace(LEADING_ORGANIC, '')
      .replace(LEADING_MARKETING, '')
      .replace(/^\d+(\.\d+)?\s*%\s*/, '')
      .trim()
  }

  // Unbalanced brackets are residue of a list split in the wrong place
  // ("salt)", "vanillin }", "), cheddar cheese sauce") — 2,000+ rows in the
  // review. Balanced ones are left for the parser, which reads them as
  // synonyms or sub-ingredients.
  if ((s.match(/\(/g) ?? []).length !== (s.match(/\)/g) ?? []).length) {
    s = s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').replace(/^[.,;:\s]+|[.,;:\s]+$/g, '').trim()
  }

  if (PACKED_IN_MEDIUM.test(s)) s = s.replace(/^packed in /, '')
  // "sea salt allergen", "mixed tocopherols allergen statement",
  // "cocoa powder allergen information": allergen text run into the last item
  s = s.replace(/\s+(?:for\s+)?allerg(?:en|y|ens)\b.*$/, '').trim()
  // "no. 1 grade mustard seed" — a grade, not a claim
  s = s.replace(/^no\.?\s*\d+\s+(?:grade\s+)?/, '')
  const claim = s.match(NO_CLAIM_PREFIX)
  if (claim) {
    s = s.slice(claim[0].length).trim()
    // what's left must look like an ingredient, not the rest of a sentence
    // ("no antibiotics ever", "no added salt and no gmo's")
    if (!s || /^(and|or|ever|administered|found|ad|except|has|is|are)\b/.test(s)) return null
  }
  // Any other "no ..." phrase is a claim or an instruction ("no gmo", "no
  // thawing necessary", "no refrigeration necessary")
  if (/^no\s/.test(s)) return null
  if (BOILERPLATE.some((re) => re.test(s))) return null
  // Bare numbers and weights ("500", "471", "1g") — E-numbers without their
  // "E", or nutrition-panel residue. Not identifiable as a substance.
  if (/^\d+(\.\d+)?\s*(g|mg|mcg|%)?$/.test(s)) return null
  if (BARE_VITAMIN.test(s)) s = `vitamin ${s}`

  // Checked before AND after singularizing, so "vitamins and minerals"
  // is caught whichever form it arrives in.
  if (JUNK.has(s)) return null
  // A purpose phrase that ended up as its own list item ("to help retain
  // color", "for freshness") — the substance it described is already listed.
  if (/^(to|for)\s+(help|maintain|preserve|retain|protect|promote|keep|prevent|freshness|color|colour|flavor)\b/.test(s)) return null
  s = singularizeLastWord(s)
  s = ALIASES[s] ?? s

  if (s.length < 2 || JUNK.has(s)) return null
  return { name: s, organic }
}

// WHAT AN INGREDIENT NAME IS, AND WHAT IS JUST WRECKAGE FROM THE IMPORT.
//
// Michael, on /ingredients, 2026-10-08: "a lot of these ingredients have
// characters in them that shouldnt be there at all. numbers, sepcial
// characters, etc. This seriously needs to be cleaned up."
//
// He is right, and the junk falls into a small number of causes rather than
// being generally messy. Counted across all 127,268 ingredient names:
//
//   566  OFF ALLERGEN MARKUP. Open Food Facts wraps allergens in
//        underscores in its ingredient text, so we stored "_wheat_ flour",
//        "_milk_", "_soy_ lecithin", "_peanuts_". 361 of the 566 are
//        duplicates of a clean name already in the table, so this is a merge
//        as much as a strip: 1,307 product links, 980 of them mergeable.
//
//   163  LEADING PUNCTUATION left by a split: "+cocoa butter",
//        "/or safflower oil", "\"b\" vitamin".
//
//     1  LIST GLUE, and it is the biggest single offender by reach:
//        "each of the following" is an ingredient on 2,626 products, left
//        behind by "contains 2% or less of each of the following:".
//
//   111  DIGITS, DATES AND LOT CODES: "000 2", "02/03/26", "30 6086".
//    25  more date and lot boilerplate: "best by", "lot code",
//        "please refer to the code on end of can".
//    13  NUTRITION-PANEL BOILERPLATE: "000 calorie diet", "daily value".
//
// WHAT IS DELIBERATELY LEFT ALONE, because it is not junk:
//
//   - DIGITS IN REAL NAMES. "red 40" is on 12,105 products, "yellow 5" on
//     11,209, "blue 1" on 9,700; "2'-fucosyllactose" and "blue 1 lake" are
//     also real. A rule that strips digits from ingredient names would
//     destroy the entire food-dye catalogue. Nothing here touches a digit
//     that is part of a name.
//
//   - NON-LATIN NAMES. 515 names are Ukrainian, Bulgarian, Chinese or
//     Korean — "цукор" (sugar), "вода" (water), "рибене" , "鸡蛋" (egg).
//     Those are REAL ingredients off real labels, and deleting them would
//     throw away the only ingredient record we hold for those products.
//     They are excluded from the English /ingredients index instead, which
//     is a display decision, not a data one. Translating them is a separate
//     job and not one to do by guesswork.
//
// VERIFIED BEFORE WRITING ANY OF THIS: not one affected name carries an
// IngredientStudy, an IngredientAuthorityAssessment or an
// IngredientRegulatoryStatus. Zero, across all seven classes. So no merge or
// deletion here can destroy a research record — which is the only thing in
// this table that could not be rebuilt from the next import.

export type NameVerdict =
  | { action: 'keep' }
  // The name is a real ingredient written badly. `to` is what it should say.
  // The caller merges into an existing ingredient of that name if one exists.
  | { action: 'rename'; to: string; why: string }
  // Not an ingredient at all. The caller deletes the ingredient and its
  // product links.
  | { action: 'drop'; why: string }

// Phrases that are a label's list punctuation rather than a thing in the
// food. EXACT names only: "contains" as a substring would catch
// "contains 2% milk", which is a real if clumsy ingredient record.
const NOT_INGREDIENTS = new Set([
  'each of the following',
  'of each of the following',
  'or less of each of the following',
  'the following',
  'and/or',
  'and or',
  'and',
  'or',
  'contains',
  'contains:',
  'may contain',
  'ingredients',
  'ingredient',
  'other',
  'other ingredients',
  'etc',
  'less than',
  'less than 2% of',
  '2% or less of',
  'contains 2% or less of',
  'none',
  'n/a',
  'na',
  'unknown',
  'no',
  'yes',

  // ADDED 2026-10-08 (round 15), from a live query rather than a guess.
  //
  // Michael, on a Danone "activia" product: "this product and the ingredient
  // list make no sense. We need to do a database check for things like this."
  // Its seven ingredients were: cultured reduced fat milk | cane serv | than
  // | natural flavor | modified corn sugar | water | modified food starch.
  //
  // "than" and "cane serv" are not junk characters — they are FRAGMENTS of
  // sentences the importer split on commas: "...less than 2% of..." and
  // "...cane sugar ... per serving". Round 14's cleanup handled names that
  // CONTAIN boilerplate; it did not handle a stray preposition that became
  // its own row.
  //
  // Every name below was confirmed present in the live Ingredient table with
  // ZERO research records attached, product reach 1 to 109, about 387 links
  // in total. Exact-match only, so "one" cannot touch "onion" and "in"
  // cannot touch "inulin".
  'each',
  'less',
  'one',
  'two',
  'serv',
  'serving',
  'per',
  'per serving',
  'cane serv',
  'daily',
  'value',
  'daily value',
  'an',
  'a',
  'the',
  'to',
  'at',
  'by',
  'in',
  'on',
  'of',
  'for',
  'it',
  'is',
  'as',
  'are',
  'that',
  'this',
  'than',
  'from',
  'with',
  'made',
  'added',
  'not',
  'may',
])

// Nutrition-panel and packaging boilerplate that was parsed as an
// ingredient. Substring matches, because these only ever appear inside
// sentences and never inside a food name.
const BOILERPLATE = [
  'calorie diet',
  'daily value',
  'percent daily',
  'best by',
  'lot code',
  'date code',
  'proof-of-purchase',
  'proof of purchase',
  'stamped date',
  'refer to the code',
  'refer to the end',
  'see bottom of',
  'see side panel',
  'distributed by',
  'manufactured for',
  'questions or comments',
  'call 1-800',
  'www.',
  'http',
]

// Characters that can open or close a name. Note what is NOT here: a digit,
// a quote, "(" and "!" — "2'-fucosyllactose", "\"b\" vitamin" keeps its
// letters, "(organic)" and "¡Ajua!" are real shapes.
const EDGE_JUNK = /^[\s+/\\|*~_,.;:&-]+|[\s+/\\|*~_,.;:&-]+$/g

// A leading TRACE DECLARATION. The label said how little; the ingredient is
// what follows. "1/10 of 1% sodium benzoate" IS sodium benzoate, and
// recording it under its own name splits one additive across two rows — 83
// products under that spelling and 32 more under "1/10 of 1% benzoate of
// soda".
//
// THREE EXPLICIT SHAPES, AND A PERCENT SIGN IS NOT ENOUGH ON ITS OWN. The
// first draft of this was one permissive pattern with every part optional,
// and the selftest below caught it renaming "2'-fucosyllactose" to
// "'-fucosyllactose", "3-fucosyllactose" to "fucosyllactose" and "1 grade
// mustard seed" to "grade mustard seed". A leading number is part of a name
// far more often than it is a quantity.
//
// So the pattern requires an actual declaration of smallness — "less than",
// "or less", or a fraction OF a percent. That is also what keeps "2% milk"
// intact: it is a specification of the milk, not a trace of it, and
// collapsing it into "milk" would throw away the fat content.
const QUANTITY_PREFIX = new RegExp(
  '^(?:' +
    // "less than 2% of", "less than 1%", "no more than 2% of"
    String.raw`(?:less than|no more than|under)\s+[\d/.]+\s*(?:%|percent)\s*(?:of\s+)?` +
    '|' +
    // "2% or less of", "1% or less"
    String.raw`[\d/.]+\s*(?:%|percent)\s+or\s+less\s*(?:of\s+)?` +
    '|' +
    // "1/10 of 1% " — a fraction of a percent
    String.raw`[\d/.]+\s+of\s+[\d/.]+\s*(?:%|percent)\s*(?:of\s+)?` +
  ')'
)

export function cleanIngredientName(raw: string): NameVerdict {
  const name = raw.trim()
  const lower = name.toLowerCase()

  // ---- not an ingredient at all
  if (NOT_INGREDIENTS.has(lower)) {
    return { action: 'drop', why: 'list punctuation, not an ingredient' }
  }
  for (const phrase of BOILERPLATE) {
    if (lower.includes(phrase)) {
      return { action: 'drop', why: `packaging boilerplate ("${phrase}")` }
    }
  }
  // Nothing but digits, separators and percent signs: a date, a lot number
  // or a stray figure. A name with ANY letter in it is kept and cleaned.
  if (/^[0-9][0-9\s./%-]*$/.test(name)) {
    return { action: 'drop', why: 'digits only — a date, lot number or stray figure' }
  }

  // ---- a real name, written badly
  let out = name

  // OFF allergen markup: the underscores are its annotation, not the label's
  // text. Removed wherever they are, because "_soy_ lecithin" and
  // "lecithin_soy_" are the same mistake.
  if (out.includes('_')) out = out.replace(/_/g, ' ')

  out = out.replace(EDGE_JUNK, '')

  // Strip a leading quantity qualifier, but ONLY if what remains still has
  // letters and is long enough to be a name. "1 grade mustard seed" keeps
  // its "1 grade" — that is a grade, not a quantity — because the pattern
  // below does not match a bare digit followed by a word.
  const beforeQuantity = out
  const afterQuantity = out.replace(QUANTITY_PREFIX, '').replace(EDGE_JUNK, '')
  if (afterQuantity !== out && /[a-zA-Z]{3}/.test(afterQuantity) && afterQuantity.length >= 3) {
    out = afterQuantity
  }
  const strippedQuantity = out !== beforeQuantity

  out = out.replace(/\s{2,}/g, ' ').trim()

  if (out === name) return { action: 'keep' }
  // Cleaning emptied it, or left something that is not a name.
  if (out.length < 2 || !/[a-zA-Z]/.test(out)) {
    return { action: 'drop', why: 'nothing but punctuation and digits once cleaned' }
  }

  const why = name.includes('_')
    ? 'Open Food Facts allergen markup'
    : strippedQuantity
      ? 'leading trace declaration'
      : 'edge punctuation'
  return { action: 'rename', to: out, why }
}

// True for a name we hold but cannot show in an English ingredient index.
// NOT a reason to delete it — see the header. The /ingredients page uses this
// to leave them out of the browse list while every product page that lists
// one still shows it.
export function isNonLatinName(name: string): boolean {
  return !/[a-zA-Z]/.test(name)
}

// ------------------------------------------------------------------ selftest
//
//   npx tsx src/lib/ingredientNames.ts --selftest
//
// Every case is a real ingredient name from the database, with its product
// count where the count is the reason the case exists.
if (typeof process !== 'undefined' && process.argv?.includes('--selftest')) {
  let bad = 0
  const check = (input: string, want: NameVerdict, why?: string) => {
    const got = cleanIngredientName(input)
    const same =
      got.action === want.action &&
      (want.action !== 'rename' || (got.action === 'rename' && got.to === want.to))
    if (!same) {
      bad++
      console.log(`FAIL ${JSON.stringify(input)}${why ? `  (${why})` : ''}`)
      console.log(`  got  ${JSON.stringify(got)}`)
      console.log(`  want ${JSON.stringify(want)}`)
    }
  }
  const keep = { action: 'keep' } as const
  const rename = (to: string) => ({ action: 'rename', to, why: '' }) as const
  const drop = { action: 'drop', why: '' } as const

  // ---- OFF allergen markup, 566 names
  check('_wheat_ flour', rename('wheat flour'), '100 products')
  check('_milk_', rename('milk'), '51 products')
  check('_wheat_', rename('wheat'))
  check('_almonds_', rename('almonds'))
  check('_soy_ lecithin', rename('soy lecithin'))
  check('_soybean_ oil', rename('soybean oil'))
  check('_peanuts_', rename('peanuts'), '18 products')
  check('_eggs_', rename('eggs'))

  // ---- leading punctuation, 163 names
  check('+cocoa butter', rename('cocoa butter'), '35 products')
  check('/or safflower oil', rename('or safflower oil'), '40 products')
  check(', black premium coffee', rename('black premium coffee'))
  check('- jordans', rename('jordans'))
  check('cocoa butter*+', rename('cocoa butter'))
  check('sesame seeds+', rename('sesame seeds'))

  // ---- list glue and boilerplate
  check('each of the following', drop, '2,626 products')
  check('the following', drop)
  check('and/or', drop)
  check('contains', drop)
  check('000 calorie diet', drop, '58 products')
  check('please refer to the code on end of can', drop)
  check('dry place lot code and best by', drop)
  check('can code', keep, 'not boilerplate: "code" alone is not in the list')

  // ---- digits only
  check('000 2', drop, '5 products')
  check('02/03/26', drop)
  check('30 6086', drop)
  check('1 1/2', drop)

  // ---- quantity qualifiers
  check('1/10 of 1% sodium benzoate', rename('sodium benzoate'), '83 products')
  check('1/10 of 1% benzoate of soda', rename('benzoate of soda'), '32 products')
  check('less than 2% of silicon dioxide', rename('silicon dioxide'))
  check('2% or less of salt', rename('salt'))
  // The shapes that must NOT be read as a trace declaration. All three of
  // these were broken by the first draft of QUANTITY_PREFIX.
  check('2% milk', keep, 'a specification of the milk, not a trace of it')
  check('1% milk', keep)
  check('2% reduced fat milk', keep)

  // ---- THE NAMES THAT MUST SURVIVE UNTOUCHED. A digit in a name is not junk.
  for (const real of [
    'red 40', 'yellow 5', 'blue 1', 'yellow 6', 'red 3', 'blue 2',
    'red 40 lake', 'yellow 5 lake', 'blue 1 lake', 'blue 2 lake',
    "2'-fucosyllactose", '3-fucosyllactose', 'omega-3', 'vitamin b12',
    'vitamin d3', 'vitamin b6', 'fd&c yellow 5', 'polysorbate 80',
    'polysorbate 60', 'mono and diglycerides', 'water', 'salt', 'sugar',
    'soy lecithin', 'wheat flour', 'cocoa butter', '1 grade mustard seed',
    'milk', 'peanut butter', 'high fructose corn syrup', 'xanthan gum',
  ]) {
    check(real, keep)
  }

  // ---- non-Latin names are kept as data and flagged for the index only
  for (const foreign of ['цукор', 'вода', '鸡蛋', '고든어']) {
    check(foreign, keep)
    if (!isNonLatinName(foreign)) {
      bad++
      console.log(`FAIL isNonLatinName(${JSON.stringify(foreign)}) should be true`)
    }
  }
  for (const english of ['water', 'red 40', '_milk_']) {
    if (isNonLatinName(english)) {
      bad++
      console.log(`FAIL isNonLatinName(${JSON.stringify(english)}) should be false`)
    }
  }

  console.log(bad === 0 ? 'ingredientNames: all cases pass' : `ingredientNames: ${bad} FAILURES`)
}

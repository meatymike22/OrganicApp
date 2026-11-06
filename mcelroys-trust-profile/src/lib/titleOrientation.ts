// WHICH SIDE OF THE SPLIT IS THE PRODUCT?
//
// r37 established that Open Food Facts names are comma-delimited and that a
// two-field name splits deterministically. Hand-scoring found the split
// RIGHT but INVERTED on roughly a quarter of them -- the product landed in
// the secondary and a marketing phrase became the <h1>:
//
//   title "Our Speciality"  / secondary "Strawberry Frosted Sugar Cookies"
//   title "Onederful"       / secondary "Organic Tofu"
//   title "Steamfresh"      / secondary "Tuscan Vegetables With Marinara Sauce"
//
// THE BOUNDARY IS NOT IN QUESTION -- the comma found it for free. Only the
// orientation is, and this module answers most of it with no model call.
//
// ---------------------------------------------------------------------------
// THE LEXICON IS DERIVED FROM THE CATALOGUE, AND TAKES TWO COUNTS PER WORD.
//
// The last word of a product name is almost always the product type. Count
// the final word of every multi-word name by DISTINCT COMPANIES and the
// product types sort to the top: sauce 3,291, mix 2,329, chocolate 2,123,
// cheese 2,056, chips 1,557, bar 1,474, cookies 1,242.
//
// Distinct companies, not product count: one company with 400 varieties of
// one thing must not mint a product-type noun on its own. Same shape as
// r34's category-word rule, computed from the live catalogue so it
// self-maintains.
//
// A COUNT ALONE IS NOT ENOUGH, AND THE FIRST VERSION OF THIS FILE WAS WRONG
// ABOUT THAT. It used the count only, and asserted in a comment that a
// lexicon polluted with flavour words was "tolerable because the test is
// one-sided -- a dirty lexicon makes the test slightly MORE eager to confirm
// the status quo, never more eager to change it."
//
// THAT WAS FALSE. Measured on 29,209 real splits it was right on 16 of 20,
// and all four failures had a rare head noun against a FLAVOUR tail:
//
//   Angel Food Mini-Cakes | Strawberry       minicakes 0  strawberry 821
//   Superfood Red Rotini Red Lentil | Tomato & Red Bell Pepper
//                                            lentil 21    pepper 528
//
// Swapping those puts "Strawberry" in the <h1>. At 80% precision, ~1,750 of
// 8,746 products would have got a WORSE title.
//
// THE FIX: A RATIO, NOT A BIGGER COUNT.
//
// The lexicon was built from `name`, which INCLUDES trailing flavour fields
// -- "Chunky Salsa, Mild" contributes `mild`. So count each word twice: over
// all multi-word names, and over only those with NO COMMA, where the last
// word really is the product type. A product noun ends a complete name; a
// flavour word disproportionately ends a trailing comma field, which is
// precisely what "flavour field" means.
//
//   product nouns   sauce .91  crackers .93  spread .91  tofu .94  cheese .85
//   flavours        pepper .61  original .58  vanilla .57  strawberry .50
//                   mild .38  smoked .34  assorted .30  smoke .20
//
// THERE IS NO CLEAN GAP, and an earlier draft of this comment claimed one.
// The real distribution over the 640 words with >=50 companies is CONTINUOUS
// and top-heavy: 274 words at .90-.99, 181 at .80-.90, 62 at .70-.80, then a
// thin tail of 113 below .70. The apparent gap was an artifact of nineteen
// hand-picked words.
//
// SO 0.70 WAS VALIDATED BY READING ALL 113 WORDS IT EXCLUDES, not by tuning.
// Every one is a flavour, a fruit, a nut or a preparation modifier:
//
//   smoke assorted smoked peppermint mild cranberry maple blackberry grape
//   apricot jalapeno lemon barbeque raisin sriracha hot raspberry orange
//   blueberry pomegranate walnut barbecue pecan cherry apple spicy tomato
//   chipotle medium citrus grapefruit banana strawberry beet pear roasted
//   sour habanero almond hazelnut mint guava cinnamon peach traditional
//   carrot acai coconut caramel spice sweet vanilla berry smores espresso
//   original melon ginger rosemary peanut nut lime spices chip tangerine
//   pumpkin salty watermelon chunk pepper sweetened red salted creme
//   cappuccino brown unsalted pineapple herb sesame seasoned balsamic garlic
//   toffee italian product mango onion parmesan basil fudge bbq kiwi mocha
//   swirl sours brittle bean chia molasses blue snickerdoodle chai dark
//   pistachio creamy white cashew vegetable buttermilk flax cheddar horseradish
//
// Four or five are arguable -- `brittle`, `bean`, `cheddar`, `parmesan` are
// product types in some names. THE FAILURE DIRECTION IS SAFE: excluding a
// real product noun makes this LESS willing to swap, never more, so the
// split is left exactly as it stands today.
//
// Re-scored against the same 20 rows, the ratio rule is right on 19.
//
// ---------------------------------------------------------------------------
// WHAT THIS DELIBERATELY DOES NOT HANDLE.
//
// The remaining failure of 20 is not an orientation error at all:
//
//   Thin Sliced Boneless | Skinless Chicken Breasts
//
// "boneless, skinless" is one conventional phrase, so the SPLIT is wrong and
// no orientation can rescue it. Measured: 26 products say "boneless,
// skinless", 30 have any `-less, -less` pair, 3 have a preparation pair, 8 an
// idiom pair -- at most 41 products. NO GUARD IS BUILT FOR THEM. A one-line
// regex would catch 30, but r37 went wrong three times generalising a rule
// from a single observed row, and 41 pages is far below the ~1,750 the ratio
// fix removes. Bounded, logged, left alone.
//
// 'unknown' IS THE HONEST ANSWER AND THE DEFAULT. Both nouns unknown, and
// this says so rather than guessing. Those rows go to the model pass, where
// orientation is a binary choice on an already-split pair -- cheap, and far
// easier than finding a boundary.
//
// NOTHING HERE WRITES, AND NOTHING HERE SWAPS. Like splitTitleParts, this is
// a display decision that something else has to apply.

import { splitTitleParts, type TitleBranch } from './titleParts'
import { PRODUCT_NOUNS } from './productNouns.generated'

// THE DEFAULT LEXICON IS A COMMITTED, GENERATED FILE.
//
//   npx tsx scripts/generate-product-nouns.ts --write
//
// 976 words at >= 25 distinct companies, of which 527 clear the product-noun
// test. It is a file rather than a column or a per-request query because the
// split and its orientation are DISPLAY decisions (no migration), because a
// 640-row full-table aggregate per product render is absurd, and because a
// committed file keeps orientSplit a PURE function that selftests without a
// database. The generator prints a diff on regeneration and calls out any
// word that CROSSES the threshold, since that is what changes an <h1>.

export type Orientation =
  // The head carries a product-type noun. Keep the split as it stands.
  | 'head_is_product'
  // The head does not and the tail does. INVERTED.
  | 'tail_is_product'
  // Neither side names a known product type. Hand to the model.
  | 'unknown'

export interface NounStats {
  // Distinct companies whose multi-word product names end in this word.
  all: number
  // ... counted only over names with NO comma.
  commaFree: number
}

export type Lexicon = Map<string, NounStats>

// 50 distinct companies before a word is judged at all: below that the ratio
// is too noisy to mean anything. Validated by the read above, not tuned.
export const MIN_COMPANIES = 50
// 0.70 comma-free. See the 113 words above.
export const MIN_COMMA_FREE_RATIO = 0.7

// Must match the SQL that builds the lexicon EXACTLY, or every lookup
// silently misses and this returns 'unknown' for everything WHILE LOOKING
// LIKE IT RAN -- the false "zero failures" shape that bit r30 and r33. The
// probe asserts agreement on a 4,000-row sample for that reason.
//
//   SQL: lower(btrim(regexp_replace(
//          regexp_replace(name, '[^[:alnum:][:space:]]', '', 'g'),
//          '^.*[[:space:]]', '')))
export function lastNoun(phrase: string): string {
  const stripped = phrase.replace(/[^\p{L}\p{N}\s]/gu, '')
  const words = stripped.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  return words[words.length - 1].toLowerCase()
}

export function isProductNoun(
  word: string,
  lexicon: Lexicon = PRODUCT_NOUNS,
  minCompanies: number = MIN_COMPANIES,
  minRatio: number = MIN_COMMA_FREE_RATIO
): boolean {
  const s = lexicon.get(word)
  if (s === undefined) return false
  if (s.all < minCompanies) return false
  if (s.all === 0) return false
  return s.commaFree / s.all >= minRatio
}

export function orientSplit(
  head: string,
  tail: string,
  lexicon: Lexicon = PRODUCT_NOUNS,
  minCompanies: number = MIN_COMPANIES,
  minRatio: number = MIN_COMMA_FREE_RATIO
): Orientation {
  // The head names a product type. Nothing to change, whatever the tail is.
  if (isProductNoun(lastNoun(head), lexicon, minCompanies, minRatio))
    return 'head_is_product'
  // It does not, and the tail does. That is the inversion.
  if (isProductNoun(lastNoun(tail), lexicon, minCompanies, minRatio))
    return 'tail_is_product'
  return 'unknown'
}

// SPLIT AND ORIENT IN ONE CALL, which is what a page actually wants.
//
// Kept HERE rather than in titleParts.ts so that titleParts stays free of
// the lexicon and its 21 selftests keep running on strings alone.
//
// The returned `swapped` flag is not decoration: it is the only way a probe
// or a reviewer can tell an orientation decision from a plain split, and
// r37's whole method is that a rule has to be auditable row by row.
export interface OrientedTitle {
  title: string
  secondary?: string
  branch: TitleBranch
  orientation?: Orientation
  swapped: boolean
}

export function splitAndOrient(
  displayed: string,
  lexicon: Lexicon = PRODUCT_NOUNS
): OrientedTitle {
  const parts = splitTitleParts(displayed)
  if (parts.branch !== 'split' || parts.secondary === undefined) {
    return { title: parts.title, branch: parts.branch, swapped: false }
  }
  const orientation = orientSplit(parts.title, parts.secondary, lexicon)
  if (orientation === 'tail_is_product') {
    return {
      title: parts.secondary,
      secondary: parts.title,
      branch: parts.branch,
      orientation,
      swapped: true,
    }
  }
  // 'head_is_product' and 'unknown' both leave the split as it stands.
  // 'unknown' is NOT a reason to swap -- it is a reason to do nothing and
  // let the model pass decide later.
  return {
    title: parts.title,
    secondary: parts.secondary,
    branch: parts.branch,
    orientation,
    swapped: false,
  }
}

// --------------------------------------------------------------- selftest
//   npx tsx src/lib/titleOrientation.ts --selftest

if (process.argv[1]?.endsWith('titleOrientation.ts')) {
  // EVERY NUMBER BELOW IS MEASURED, 2026-11-04, not invented for the test.
  // all = distinct companies over multi-word names; commaFree = the same
  // over comma-free names only.
  const lex: Lexicon = new Map([
    ['sauce',      { all: 3291, commaFree: 2988 }],
    ['chocolate',  { all: 2123, commaFree: 1490 }],
    ['cheese',     { all: 2056, commaFree: 1753 }],
    ['cookies',    { all: 1242, commaFree: 1077 }],
    ['spread',     { all:  716, commaFree:  655 }],
    ['crackers',   { all:  638, commaFree:  596 }],
    ['soda',       { all:  463, commaFree:  419 }],
    ['mushrooms',  { all:  250, commaFree:  223 }],
    ['tofu',       { all:  148, commaFree:  139 }],
    ['breasts',    { all:   57, commaFree:   53 }],
    // flavour and modifier words: common, but they end trailing fields
    ['original',   { all:  934, commaFree:  543 }],  // .58
    ['vanilla',    { all:  907, commaFree:  521 }],  // .57
    ['strawberry', { all:  821, commaFree:  411 }],  // .50
    ['honey',      { all:  748, commaFree:  601 }],  // .80 - a product noun
    ['raspberry',  { all:  554, commaFree:  235 }],  // .42
    ['pepper',     { all:  528, commaFree:  323 }],  // .61
    ['mild',       { all:  273, commaFree:  105 }],  // .38
    // below the 50-company floor: not judged at all
    ['lentil',     { all:   21, commaFree:   15 }],
    ['kitchen',    { all:    8, commaFree:    6 }],
    ['speciality', { all:    1, commaFree:    1 }],
    ['cock',       { all:    1, commaFree:    1 }],
    // 'onederful', 'minicakes', 'steamfresh' are deliberately ABSENT, which
    // is how an invented brand word arrives: the SQL applies a floor.
  ])

  type Case = { head: string; tail: string; want: Orientation; why: string }
  const cases: Case[] = [
    // --- real inversions, from the probe's own output -------------------
    { head: 'Our Speciality', tail: 'Strawberry Frosted Sugar Cookies',
      want: 'tail_is_product', why: 'speciality under the floor, cookies .87' },
    { head: 'Onederful', tail: 'Organic Tofu',
      want: 'tail_is_product', why: 'absent head, tofu .94' },
    { head: 'Nusco', tail: 'Hazelnut Chocolate Spread',
      want: 'tail_is_product', why: 'absent head, spread .91' },
    { head: 'Soignon', tail: 'Goat Cheese',
      want: 'tail_is_product', why: 'absent head, cheese .85' },
    { head: 'Fresh Selections', tail: 'Portobello Whole Mushrooms',
      want: 'tail_is_product', why: 'absent head, mushrooms .89' },
    { head: 'Route 66 Sodas', tail: 'Cream Soda',
      want: 'tail_is_product', why: 'plural "sodas" absent, soda .90' },
    { head: 'Sea Buddies', tail: 'Extra Cheddar Baked Snack Crackers',
      want: 'tail_is_product', why: 'absent head, crackers .93' },
    { head: 'Beelove', tail: 'Raw Natural Honey',
      want: 'tail_is_product', why: 'honey .80 clears the ratio' },

    // --- THE FOUR THE COUNT-ONLY VERSION GOT WRONG ----------------------
    // These are the whole reason the ratio exists. Each must now refuse.
    { head: 'Angel Food Mini-Cakes', tail: 'Strawberry',
      want: 'unknown', why: 'strawberry .50 is a FLAVOUR - must not become the h1' },
    { head: 'Superfood Red Rotini Red Lentil', tail: 'Tomato & Red Bell Pepper',
      want: 'unknown', why: 'lentil under floor AND pepper .61 is a flavour' },
    { head: 'Vanilla Bean Gelato Tub', tail: 'Original',
      want: 'unknown', why: 'original .58 is a modifier' },
    { head: 'Chunky Salsa Jar', tail: 'Mild',
      want: 'unknown', why: 'mild .38 is a modifier' },

    // --- correctly oriented: head carries the product noun --------------
    { head: 'Caribbean Traditions Seasoning', tail: 'Cock',
      want: 'unknown', why: 'seasoning not in this test lexicon; refuses rather than swaps' },
    { head: 'Squares Dark Chocolate', tail: 'Strawberry Filling',
      want: 'head_is_product', why: 'chocolate .70 exactly clears' },
    { head: 'Fruit Spread', tail: 'Raspberry',
      want: 'head_is_product', why: 'head wins outright; tail is a flavour anyway' },
    { head: 'Goat Cheese', tail: 'Vanilla',
      want: 'head_is_product', why: 'head is a product noun' },

    // --- the mis-SPLIT this module cannot and must not fix ---------------
    // breasts is .93, so this still reports an inversion. The split itself
    // is wrong ("boneless, skinless" is one phrase); 41 products, no guard.
    { head: 'Thin Sliced Boneless', tail: 'Skinless Chicken Breasts',
      want: 'tail_is_product', why: 'KNOWN LIMIT: a mis-split, not a mis-orientation' },

    // --- honest refusals -------------------------------------------------
    { head: 'Onederful', tail: 'Zognut', want: 'unknown', why: 'neither known' },
    { head: '', tail: '', want: 'unknown', why: 'empty input must not throw' },
    { head: 'Mann\'s', tail: 'Mediterranean Style Snap Pea Sensations',
      want: 'unknown', why: 'both absent - this is the model pass population' },

    // --- the floor is a floor, not a ratio shortcut ----------------------
    // lentil is .71, which CLEARS the ratio, but 21 companies is under the
    // 50-company floor, so it is not judged. Without the floor a word used
    // by three companies could decide an h1.
    { head: 'Red Lentil', tail: 'Zognut',
      want: 'unknown', why: 'lentil .71 but only 21 companies' },

    // --- normalisation ---------------------------------------------------
    { head: 'Goat CHEESE!', tail: 'Vanilla',
      want: 'head_is_product', why: 'case and punctuation ignored' },
    { head: 'Crème Brûlée', tail: 'Goat Cheese',
      want: 'tail_is_product', why: 'accented head survives as a word, just unknown' },
  ]

  let pass = 0
  const failures: string[] = []
  for (const c of cases) {
    const got = orientSplit(c.head, c.tail, lex)
    if (got === c.want) pass++
    else
      failures.push(
        `  ${JSON.stringify(c.head)} | ${JSON.stringify(c.tail)}\n` +
          `    expected ${c.want}, got ${got}   (${c.why})`
      )
  }

  // isProductNoun, directly: the ratio and the floor are separate gates.
  const nounChecks: [string, boolean, string][] = [
    ['sauce', true, '.91, 3291 companies'],
    ['cheese', true, '.85'],
    ['honey', true, '.80'],
    ['chocolate', true, '.70 exactly - inclusive bound'],
    ['pepper', false, '.61 - below the ratio'],
    ['vanilla', false, '.57'],
    ['mild', false, '.38'],
    ['lentil', false, 'ratio fine, under the 50-company floor'],
    ['speciality', false, 'one company'],
    ['onederful', false, 'absent from the lexicon'],
    ['', false, 'empty string'],
  ]
  for (const [word, want, why] of nounChecks) {
    const got = isProductNoun(word, lex)
    if (got === want) pass++
    else failures.push(`  isProductNoun(${JSON.stringify(word)}) expected ${want}, got ${got}  (${why})`)
  }

  const nounCases: [string, string][] = [
    ['Country Dijon Mustard', 'mustard'],
    ['MUSTARD!', 'mustard'],
    ['Pull \'N\' Peel Candy', 'candy'],
    ['35% Vegetable Oil Spread', 'spread'],
    ['Angel Food Mini-Cakes', 'minicakes'],
    ['Crème Brûlée', 'brûlée'],
    ['   ', ''],
    ['', ''],
  ]
  for (const [input, want] of nounCases) {
    const got = lastNoun(input)
    if (got === want) pass++
    else failures.push(`  lastNoun(${JSON.stringify(input)}) expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
  }

  // ---- splitAndOrient, END TO END, AGAINST THE REAL SHIPPED LEXICON.
  //
  // Every expectation below was hand-scored from probe-title-parts.ts output
  // BEFORE being written here, so these pin known-correct behaviour rather
  // than blessing whatever the code happens to do. If a regeneration of
  // productNouns.generated.ts moves a word across the threshold, these are
  // what will fail, which is the point: the generator's diff warns, and this
  // catches it if the warning is missed.
  type E2E = {
    in: string
    title: string
    secondary?: string
    branch: TitleBranch
    swapped: boolean
    why: string
  }
  const e2e: E2E[] = [
    // --- correctly swapped: the product was in the secondary --------------
    { in: 'Our Speciality, Strawberry Frosted Sugar Cookies',
      title: 'Strawberry Frosted Sugar Cookies', secondary: 'Our Speciality',
      branch: 'split', swapped: true, why: 'marketing phrase was the h1' },
    { in: 'Onederful, Organic Tofu',
      title: 'Organic Tofu', secondary: 'Onederful',
      branch: 'split', swapped: true, why: 'invented brand word was the h1' },
    { in: 'Soignon, Goat Cheese',
      title: 'Goat Cheese', secondary: 'Soignon',
      branch: 'split', swapped: true, why: 'brand was the h1' },

    // --- correctly left alone --------------------------------------------
    { in: 'Country Dijon Mustard, White Wine',
      title: 'Country Dijon Mustard', secondary: 'White Wine',
      branch: 'split', swapped: false, why: 'head is the product' },
    { in: 'Caribbean Traditions Seasoning, Cock',
      title: 'Caribbean Traditions Seasoning', secondary: 'Cock',
      branch: 'split', swapped: false, why: 'a real Grace product line, not garbage' },

    // --- THE TWO THE COUNT-ONLY TEST GOT WRONG. Must not swap. -----------
    { in: 'Angel Food Mini-Cakes, Strawberry',
      title: 'Angel Food Mini-Cakes', secondary: 'Strawberry',
      branch: 'split', swapped: false, why: 'strawberry .50 is a flavour' },
    { in: 'Superfood Red Rotini Red Lentil, Tomato & Red Bell Pepper',
      title: 'Superfood Red Rotini Red Lentil', secondary: 'Tomato & Red Bell Pepper',
      branch: 'split', swapped: false, why: 'pepper .61 is a flavour' },

    // --- a metadata tail must never become the h1 ------------------------
    // The separate metadata-tail guard will stop "2.35 Oz" being SHOWN as a
    // secondary at all; this pins that it at least never becomes the title.
    { in: 'Kosher Minced Onion, 2.35 Oz',
      title: 'Kosher Minced Onion', secondary: '2.35 Oz',
      branch: 'split', swapped: false, why: 'oz is absent, so nothing swaps' },

    // --- branches that never reach orientation ---------------------------
    { in: 'Premium Potato Chips, Chipotle, Ranch',
      title: 'Premium Potato Chips, Chipotle, Ranch',
      branch: 'multi_field', swapped: false, why: 'three fields, left alone' },
    { in: 'Broccoli, Cauliflower & Carrots',
      title: 'Broccoli, Cauliflower & Carrots',
      branch: 'short_head_list', swapped: false, why: 'enumerated list' },
    { in: 'Zesty lime natural spring water, zesty lime',
      title: 'Zesty lime natural spring water',
      branch: 'no_comma', swapped: false, why: 'echo trim runs first' },
    { in: 'Pepitas', title: 'Pepitas',
      branch: 'no_comma', swapped: false, why: 'nothing to split' },

    // --- the documented limit: a mis-SPLIT orientation cannot fix --------
    // "boneless, skinless" is one phrase. ~41 products, deliberately
    // unguarded. Pinned so the behaviour is a known quantity, not a shock.
    { in: 'Thin Sliced Boneless, Skinless Chicken Breasts',
      title: 'Skinless Chicken Breasts', secondary: 'Thin Sliced Boneless',
      branch: 'split', swapped: true, why: 'KNOWN LIMIT: the split itself is wrong' },
  ]

  for (const c of e2e) {
    const got = splitAndOrient(c.in)
    const ok =
      got.title === c.title &&
      (got.secondary ?? undefined) === (c.secondary ?? undefined) &&
      got.branch === c.branch &&
      got.swapped === c.swapped
    if (ok) pass++
    else
      failures.push(
        `  splitAndOrient(${JSON.stringify(c.in)})   (${c.why})\n` +
          `    expected title=${JSON.stringify(c.title)} secondary=${JSON.stringify(c.secondary)} branch=${c.branch} swapped=${c.swapped}\n` +
          `    got      title=${JSON.stringify(got.title)} secondary=${JSON.stringify(got.secondary)} branch=${got.branch} swapped=${got.swapped}`
      )
  }

  const total = cases.length + nounChecks.length + nounCases.length + e2e.length
  console.log(`selftest: ${pass}/${total} pass`)
  if (failures.length > 0) {
    console.log('')
    for (const f of failures) console.log(f + '\n')
    process.exitCode = 1
  }
}

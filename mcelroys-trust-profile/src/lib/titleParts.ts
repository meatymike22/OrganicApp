// THE SECONDARY TITLE, SPLIT OFF THE PRODUCT TITLE.
//
// Michael, 2026-11-02, on a Member's Mark record:
//
//   "The member's mark photo still includes secondary title information in
//   the product title. Instead of 'on the label' remove this and simply put
//   the secondary title beneath the product title, which in this case is
//   'Peanut butter filled wafer sticks with strawberry dip'"
//
// 47,862 products display a comma inside their title today. Measured
// 2026-11-04 over the 63,149 products whose stored name contains a comma:
//
//   15,287  one comma, and the leading field IS the company  -> ALREADY FIXED
//   25,847  one comma, leading field is not the company      -> needs a split
//   22,015  two or more commas                               -> needs a split
//
// THE LEADING-COMPANY CASE IS ALREADY HANDLED, and this module must not try
// to handle it again. `startsWithBrand` accepts a comma as a word boundary,
// so productDisplayName already turns "Borden, singles american cheese
// slices" into "Singles American Cheese Slices" on its own. That is why this
// function takes the ALREADY-DISPLAYED name, not the stored one.
//
// WHY OPEN FOOD FACTS NAMES SPLIT ON A COMMA AT ALL.
//
// `product_name` is a comma-delimited field list, and the field order is
// consistent across the corpus:
//
//   brand , [product line ,] product , [flavour] , [flavour repeated]
//
//   Borden, singles american cheese slices           brand , product
//   Nice!, caffeine-free soda, lemon lime            brand , product , flavour
//   Graham Cookies, Fudge Covered                    product , secondary
//   Whole Grain Corn & Oat Cereal, Caramel           product , flavour
//   Kashi, Heart To Heart, Instant Oatmeal, Apple Cinnamon, Apple Cinnamon
//
// The delimiters the r36 title-split pilot was paying a model and an image
// fetch to GUESS AT are already in the string for 63,149 products.
//
// ---------------------------------------------------------------------------
//
// TWO FIELDS SPLIT. ANYTHING ELSE IS LEFT ALONE.
//
// That is the whole rule, and the restraint is the point. An earlier design
// had a guard for comma-delimited lists inside one field:
//
//   Pear, Kiwi, Peas & Spinach Baby Food
//   mixed vegetables with carrots, corn, green beans & peas
//
// The guard turned out to be unnecessary. EVERY enumerated list of that
// shape has three or more fields, so leaving 3+ alone catches all of them
// without a heuristic. A two-field name whose tail carries "&" is a flavour,
// not a list - "Thick Cut Crispbreads, Chile & Lime" - and a guard keyed on
// "&" alone would have refused to split it.
//
// THREE-OR-MORE IS LEFT UNCHANGED RATHER THAN SPLIT AT THE FIRST COMMA,
// because no fixed rule survives contact with both of these:
//
//   Kashi, Heart To Heart, Instant Oatmeal, Apple Cinnamon
//     first field as title -> "Heart To Heart"      the LINE, not the product
//   Ghirardelli chocolate, fall assortment premium chocolate squares, 60% cacao, caramel
//     first field as title -> "fall assortment premium chocolate squares"  correct
//
// Each rule wins on one and loses on the other, and a title that names the
// product line instead of the product is worse than today's run-on. Those
// rows are reported as `multi_field` so the model pass can take them with
// their delimiters already found - which should make them its EASIEST rows,
// not its hardest.
//
// NOTHING HERE WRITES TO THE DATABASE. This is a display function; there is
// no migration, no --live, and nothing to revert.

import { trimRedundantTail } from './productName'

export type TitleBranch =
  // No comma survived the echo trim. Nothing to do.
  | 'no_comma'
  // Exactly two fields. Split. This is the win.
  | 'split'
  // Three or more fields: a product line is in there somewhere. Unchanged.
  | 'multi_field'
  // Two fields, but the leading one is a single bare word and the tail is
  // conjoined - "corn, green beans & peas". An enumerated list that happens
  // to be short enough to look like a title. Unchanged.
  | 'short_head_list'

export interface TitleParts {
  title: string
  secondary?: string
  branch: TitleBranch
}

// A two-field name is only a title/secondary pair if the head is a title.
// "corn, green beans & peas" is one enumerated list that happens to have a
// single comma; splitting it would print "Corn" as the product.
//
// Deliberately narrow: ONE bare word on the left AND a conjunction on the
// right. "Thick Cut Crispbreads, Chile & Lime" has a three-word head and
// must still split, so the conjunction alone cannot be the test.
function isShortHeadList(head: string, tail: string): boolean {
  const headWords = head.trim().split(/\s+/).filter(Boolean)
  if (headWords.length !== 1) return false
  return /\s(?:&|and)\s/i.test(tail)
}

export function splitTitleParts(displayed: string): TitleParts {
  // The echo trim runs FIRST, per Michael 2026-11-03: "echo-trimmer first,
  // model splitter second, photo path last." It is what collapses OFF's
  // duplicated flavour field - "raspberry, raspberry", "vanilla, vanilla" -
  // and without it a two-field name is frequently just a name plus its own
  // tail, which must not become a secondary line.
  const trimmed = trimRedundantTail(displayed).trim()

  const segments = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (segments.length < 2) return { title: trimmed, branch: 'no_comma' }

  if (segments.length > 2) return { title: trimmed, branch: 'multi_field' }

  const [head, tail] = segments

  if (isShortHeadList(head, tail)) {
    return { title: trimmed, branch: 'short_head_list' }
  }

  // Never leave a fragment too short to identify anything on either side.
  // The same floor productDisplayName uses when stripping a brand: a record
  // with no readable name is worse than a run-on one.
  if (head.replace(/[^a-z0-9]/gi, '').length < 3) {
    return { title: trimmed, branch: 'no_comma' }
  }
  if (tail.replace(/[^a-z0-9]/gi, '').length < 3) {
    return { title: head, branch: 'no_comma' }
  }

  return { title: head, secondary: tail, branch: 'split' }
}

// --------------------------------------------------------------- selftest
//   npx tsx src/lib/titleParts.ts --selftest

if (process.argv[1]?.endsWith('titleParts.ts')) {
  type Case = { in: string; title: string; secondary?: string; branch: TitleBranch }

  const cases: Case[] = [
    // --- the win: two fields, split -------------------------------------
    { in: 'Graham Cookies, Fudge Covered',
      title: 'Graham Cookies', secondary: 'Fudge Covered', branch: 'split' },
    { in: 'Whole Grain Corn & Oat Cereal, Caramel',
      title: 'Whole Grain Corn & Oat Cereal', secondary: 'Caramel', branch: 'split' },
    { in: 'Lightly Dipped Peanuts, Dark Chocolate',
      title: 'Lightly Dipped Peanuts', secondary: 'Dark Chocolate', branch: 'split' },
    // A conjunction in the TAIL is a flavour, not a list, when the head is a
    // real title. The guard that keyed on "&" alone refused this one.
    { in: 'Thick Cut Crispbreads, Chile & Lime',
      title: 'Thick Cut Crispbreads', secondary: 'Chile & Lime', branch: 'split' },
    // Michael's own example, after the company strip has run.
    { in: 'Peanut butter filled wafer sticks, with strawberry dip',
      title: 'Peanut butter filled wafer sticks', secondary: 'with strawberry dip',
      branch: 'split' },

    // --- the echo trim runs first ---------------------------------------
    // Two fields on the page, but the tail merely repeats the head, so the
    // trim collapses it and there is nothing left to split.
    { in: 'Blueberry Lemon Zest Triple Cream Cheese Spread, Blueberry Lemon Zest',
      title: 'Blueberry Lemon Zest Triple Cream Cheese Spread', branch: 'no_comma' },
    { in: 'Zesty lime natural spring water, zesty lime',
      title: 'Zesty lime natural spring water', branch: 'no_comma' },
    // Three fields where the last echoes: trims to two, then splits.
    { in: 'caffeine-free soda, lemon lime, lemon lime',
      title: 'caffeine-free soda', secondary: 'lemon lime', branch: 'split' },

    // --- three or more fields: unchanged, flagged ------------------------
    { in: 'Heart To Heart, Instant Oatmeal, Apple Cinnamon',
      title: 'Heart To Heart, Instant Oatmeal, Apple Cinnamon', branch: 'multi_field' },
    { in: 'fall assortment premium chocolate squares, 60% cacao, caramel',
      title: 'fall assortment premium chocolate squares, 60% cacao, caramel',
      branch: 'multi_field' },
    // The enumerated lists the dropped guard was written for. They land here
    // with no heuristic, which is the whole reason the guard was dropped.
    { in: 'Pear, Kiwi, Peas & Spinach Baby Food',
      title: 'Pear, Kiwi, Peas & Spinach Baby Food', branch: 'multi_field' },
    { in: 'mixed vegetables with carrots, corn, green beans & peas',
      title: 'mixed vegetables with carrots, corn, green beans & peas',
      branch: 'multi_field' },

    // --- two fields, but the head is one bare word and the tail conjoins -
    { in: 'corn, green beans & peas',
      title: 'corn, green beans & peas', branch: 'short_head_list' },
    { in: 'peanuts, cashews and almonds',
      title: 'peanuts, cashews and almonds', branch: 'short_head_list' },

    // --- no comma --------------------------------------------------------
    { in: 'Organic Gluten Free Artisan Pasta Red Lentil Fusilli',
      title: 'Organic Gluten Free Artisan Pasta Red Lentil Fusilli', branch: 'no_comma' },
    { in: 'Pepitas', title: 'Pepitas', branch: 'no_comma' },

    // --- never leave an unreadable fragment ------------------------------
    // A two-character tail is punctuation noise, not a secondary line.
    { in: 'Diced Tomatoes Steam Peeled, A',
      title: 'Diced Tomatoes Steam Peeled', branch: 'no_comma' },
    // A two-character head cannot be a title, so nothing is split off it.
    { in: 'A, Diced Tomatoes Steam Peeled',
      title: 'A, Diced Tomatoes Steam Peeled', branch: 'no_comma' },

    // --- punctuation and whitespace hygiene ------------------------------
    { in: 'Graham Cookies ,   Fudge Covered',
      title: 'Graham Cookies', secondary: 'Fudge Covered', branch: 'split' },
    { in: 'Graham Cookies, Fudge Covered,',
      title: 'Graham Cookies', secondary: 'Fudge Covered', branch: 'split' },
    // An accented tail must survive: squashed() folds marks, it does not
    // delete letters (the r33 Nestle bug).
    { in: 'Creme Brulee Gelato, Creme Fraiche',
      title: 'Creme Brulee Gelato', secondary: 'Creme Fraiche', branch: 'split' },
  ]

  let pass = 0
  const failures: string[] = []

  for (const c of cases) {
    const got = splitTitleParts(c.in)
    const ok =
      got.title === c.title &&
      (got.secondary ?? undefined) === (c.secondary ?? undefined) &&
      got.branch === c.branch
    if (ok) {
      pass++
    } else {
      failures.push(
        `  IN:       ${JSON.stringify(c.in)}\n` +
          `  expected: title=${JSON.stringify(c.title)} secondary=${JSON.stringify(c.secondary)} branch=${c.branch}\n` +
          `  got:      title=${JSON.stringify(got.title)} secondary=${JSON.stringify(got.secondary)} branch=${got.branch}`
      )
    }
  }

  console.log(`selftest: ${pass}/${cases.length} pass`)
  if (failures.length > 0) {
    console.log('')
    for (const f of failures) console.log(f + '\n')
    process.exitCode = 1
  }
}

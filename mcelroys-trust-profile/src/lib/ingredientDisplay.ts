// HOW AN INGREDIENT ROW IS COLOURED AND LABELLED.
//
// Michael, 2026-10-13, four comments on one M&M'S page that are one request:
//   "we should categorize ingredients based on color and have a VERY concise
//    legend about them up here."
//   "preservatives and emulsifiers should get their own text highlight color
//    because generally preservatives and emulsifers are add ons and not
//    natural. We need to distinctify them from natural ingredients"
//   "why are the lake variants not highligheted?"
//   "it feels like this section is way too large: the rows have too much
//    space and we can fit all these ingredients into view"
//
// He chose a hue per family with NO ordering between them — not a concern
// ramp. That distinction is the whole reason this file can exist at all: a
// red/amber/green ingredient list is a traffic light, which is the scoring
// system this project refuses to build. "This is a dye" is a fact read off
// the label. "This dye is bad" is a verdict. Only the first is here.
//
// TWO RULES THIS FILE MUST KEEP.
//
// 1. NO COLOUR MEANS "NO CATEGORY ON FILE". It does NOT mean natural, and
//    the legend must never say it does. On the very label that prompted
//    this, `hydrogenated palm kernel oil`, `cornstarch` and `dextrin` have
//    no category — and a hydrogenated fat is the least ambiguous additive
//    in the catalogue. 355 of 579 hydrogenated names are unclassified
//    (features item 34). Painting the uncoloured rows as natural would turn
//    our own classification gap into a claim about food.
//
// 2. AMBER IS NOT A FAMILY COLOUR. status.openResearch means "there is
//    research to read" everywhere on this site. The left rule now carries
//    the family, so research moved to its own small mark. Two meanings on
//    one channel is how a reader stops trusting either.

import { additive, type AdditiveKey } from '@/lib/design'

// Ingredient.category as the classifier writes it, mapped onto the families
// a shopper can hold in their head. Counted 2026-10-13 across the live
// table, by product links, so the five hues cover what people actually see:
//
//   undisclosed flavoring  2,097 names  173,591 links
//   emulsifier             1,738        136,835
//   seed oil               2,006        101,976
//   artificial dye         1,032         73,030
//   preservative           1,335         63,806
//   sugar substitute         521         16,589
//   artificial sweetener     318         16,126
//   paraben preservative      18            215
//   undisclosed fragrance     16            115
//   sulfate surfactant         5             57
//   antimicrobial pres.        2              2
//   ethanolamine               1              4
//   formaldehyde releaser      1              1
//
// PRESERVATIVE AND EMULSIFIER SHARE ONE HUE on purpose. He named them as a
// pair — "preservatives and emulsifiers ... are add ons" — and that is the
// distinction he asked for. They do different jobs, and the row still prints
// the exact category in its tooltip, so the finer fact is one hover away
// rather than gone.
const FAMILY_OF: Record<string, AdditiveKey> = {
  'artificial dye': 'dye',

  'undisclosed flavoring': 'flavour',
  'undisclosed fragrance': 'flavour',

  'sugar substitute': 'sweetener',
  'artificial sweetener': 'sweetener',

  preservative: 'shelfLife',
  'paraben preservative': 'shelfLife',
  'antimicrobial preservative': 'shelfLife',
  'formaldehyde releaser': 'shelfLife',
  emulsifier: 'shelfLife',

  'seed oil': 'oil',

  // Cosmetic-product categories. Real records, far too rare to earn a hue.
  'sulfate surfactant': 'other',
  ethanolamine: 'other',
}

export function familyFor(category: string | null | undefined): AdditiveKey | null {
  if (!category) return null
  return FAMILY_OF[category] ?? 'other'
}

// The families actually present on one product, in the order the legend
// prints them, so a label with two dyes and a preservative gets a two-entry
// legend rather than the whole scheme. Order is fixed rather than by
// frequency: a legend that reorders itself per product is a legend you have
// to read twice.
const LEGEND_ORDER: AdditiveKey[] = ['dye', 'flavour', 'sweetener', 'shelfLife', 'oil', 'other']

export function familiesPresent(categories: (string | null | undefined)[]): AdditiveKey[] {
  const seen = new Set<AdditiveKey>()
  for (const c of categories) {
    const f = familyFor(c)
    if (f) seen.add(f)
  }
  return LEGEND_ORDER.filter((k) => seen.has(k))
}

export function familyLabel(key: AdditiveKey): string {
  return additive[key].label
}

// ------------------------------------------------------- lakes and dyes

// A LAKE IS THE SAME COLOUR ADDITIVE, FIXED ONTO A SUBSTRATE.
//
// Michael, 2026-10-13: "why are the lake variants not highligheted?"
//
// Because the research marker asks "do we hold a study on THIS row", and the
// studies landed inconsistently across the pairs. Measured 2026-10-13:
//
//   red 40 lake    2,734 products   1 study    red 40    1 study
//   yellow 5 lake  2,357            0          yellow 5  0
//   yellow 6 lake  2,071            0          yellow 6  1
//   blue 1 lake    1,878            0          blue 1     1
//   blue 2 lake    1,306            0          blue 2     0
//
// So Yellow 6 was marked and Yellow 6 Lake was not, on the same label, for
// the same colourant. He chose to link them and to say so on the row.
//
// WHY THIS IS AN EXPLICIT TABLE AND NOT A RULE. Stripping a trailing "lake"
// looks obvious and is a trap: the table also contains `cheddar lake`,
// `black lake`, `blue t lake`, `yr y lake`, `raisins ntainer oz | lake` and
// about a hundred more mis-parsed fragments, each on one or two products.
// A rule would quietly attach a dye's research to cheddar. So the map lists
// only spellings observed in the database with a real product count, and
// anything not named here gets no link at all. Verified: these ten names
// carry about 10,400 of the roughly 11,000 lake product links.
//
// The research shown is the BASE DYE'S record, so the row says so. A reader
// must never think we hold a study on the lake itself when we hold one on
// the dye it is made from.
const LAKE_BASE: Record<string, string> = {
  'red 40 lake': 'red 40',
  'red 40 aluminum lake': 'red 40',
  'yellow 5 lake': 'yellow 5',
  'yellow 5 aluminum lake': 'yellow 5',
  'yellow 6 lake': 'yellow 6',
  'yellow 6 aluminum lake': 'yellow 6',
  'blue 1 lake': 'blue 1',
  'blue 1 aluminum lake': 'blue 1',
  'blue 2 lake': 'blue 2',
  'blue 2 aluminum lake': 'blue 2',
}

// The base dye this name is a lake of, or null. Case-insensitive because
// Ingredient.name is stored lowercase today and that is not guaranteed.
export function baseDyeOf(name: string): string | null {
  return LAKE_BASE[name.trim().toLowerCase()] ?? null
}

// Every base dye any lake could point at, for the one extra query the
// product and ingredient pages run to fetch their research.
export function allBaseDyes(): string[] {
  return [...new Set(Object.values(LAKE_BASE))]
}

// --------------------------------------------------------------- selftest
//   npx tsx src/lib/ingredientDisplay.ts --selftest
if (process.argv[1]?.includes('ingredientDisplay')) {
  let bad = 0
  const eq = (what: string, got: unknown, want: unknown) => {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) bad++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
  }

  eq('a dye is a dye', familyFor('artificial dye'), 'dye')
  eq('preservative and emulsifier share a family', familyFor('preservative'), familyFor('emulsifier'))
  eq('no category means no family', familyFor(null), null)
  eq('an empty string is not a family', familyFor(''), null)
  // A category the classifier invents later must still get a colour rather
  // than silently falling back to "uncoloured", which means something else.
  eq('an unknown category is still an additive', familyFor('something new'), 'other')

  eq('legend keeps its fixed order', familiesPresent(['preservative', 'artificial dye', null]), ['dye', 'shelfLife'])
  eq('legend de-duplicates', familiesPresent(['artificial dye', 'artificial dye']), ['dye'])
  eq('a label with no additives has no legend', familiesPresent([null, undefined, '']), [])

  eq('a lake points at its dye', baseDyeOf('yellow 6 lake'), 'yellow 6')
  eq('the aluminum spelling too', baseDyeOf('Blue 1 Aluminum Lake'), 'blue 1')
  // The traps. None of these may ever resolve.
  eq('cheddar lake is not a dye', baseDyeOf('cheddar lake'), null)
  eq('black lake is not a dye', baseDyeOf('black lake'), null)
  eq('a bare lake is not a dye', baseDyeOf('lake'), null)
  eq('a mis-parsed fragment is not a dye', baseDyeOf('blue 2 lake ue1ue 1 lake'), null)
  eq('a base dye is not its own lake', baseDyeOf('yellow 6'), null)
  eq('five base dyes', allBaseDyes().length, 5)

  console.log(bad === 0 ? 'ingredientDisplay: all cases pass' : `ingredientDisplay: ${bad} FAILURES`)
}

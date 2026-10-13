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
// PRESERVATIVE AND EMULSIFIER ARE SEPARATE AS OF 2026-10-13. Round 18 gave
// them one hue because Michael had named them as a pair; he then asked for
// the split outright: "preservative and emulsifier should be separated as
// distinct categories." They do different jobs — one stops microbes, one
// stops oil and water parting — so separate is the truer shape. The reason
// seven families became workable is the glossary below: a legend entry now
// carries a definition, so the colour is a pointer rather than the whole
// explanation.
const FAMILY_OF: Record<string, AdditiveKey> = {
  'artificial dye': 'dye',

  'undisclosed flavoring': 'flavour',
  'undisclosed fragrance': 'flavour',

  'sugar substitute': 'sweetener',
  'artificial sweetener': 'sweetener',

  preservative: 'preservative',
  'paraben preservative': 'preservative',
  'antimicrobial preservative': 'preservative',
  'formaldehyde releaser': 'preservative',

  emulsifier: 'emulsifier',

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
const LEGEND_ORDER: AdditiveKey[] = [
  'dye',
  'flavour',
  'sweetener',
  'preservative',
  'emulsifier',
  'oil',
  'other',
]

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

// ------------------------------------------------------------- glossary

// WHAT EACH FAMILY MEANS, IN WORDS A SHOPPER CAN USE.
//
// Michael, 2026-10-13, three comments pointing at the same hole:
//   "also we should have a glossary of definitions of ingredients. Let's
//    start by putting an 'i' next to each of these so the user can hover and
//    understand what each of them mean. On the ingredient page, define it so
//    the layman can begin to understand what thye are eating"
//   "put a little 'i' next to each category so the user can understand what
//    each means"
//   "definition of the ingredients and how it is made should be right under
//    the title here."
//
// WHAT THIS FILE CAN HONESTLY ANSWER, and what it cannot. A definition of a
// CLASS — what an emulsifier is — is a published, citable fact, and there
// are thirteen classes, so it can be written once and cover all 9,090
// flagged ingredients. A definition of an INDIVIDUAL ingredient — what
// propyl gallate is and how it is made — is 127,268 separate facts, needs a
// column that does not exist, and needs a source for each one. That is a
// build, not a constant, and it is logged as such. This file is the first
// half, shipped now.
//
// THE TWO LINES ARE KEPT APART ON PURPOSE.
//
// `plain` is OURS. It is written here, in our voice, and the UI never
// presents it as anyone else's. It is deliberately about FUNCTION — what
// the additive does in the food — because function is what a label is
// telling you and is not contested. None of these lines says an additive is
// safe or unsafe; that question belongs to the research records, which have
// their own sources and their own wording rules.
//
// `codex` is a VERBATIM QUOTE from the Codex Alimentarius list of food
// additive functional classes, published by the FAO/WHO Codex Alimentarius
// Commission. It is present only for the four families that map cleanly onto
// a Codex class, and absent where the mapping would be a stretch. Quoting it
// is the point: a reader can see which sentence is an international standards
// body's and which is ours.
//
// WHY `flavour` HAS NO CODEX LINE, and this is the kind of near-miss the
// three-state rule exists to catch. Codex defines a "flavour enhancer" as
// something that enhances an existing taste. Our `undisclosed flavoring`
// category is a FLAVOURING — a substance that supplies taste — which Codex
// handles outside its functional classes entirely. Pasting the enhancer
// definition onto it would have been a plausible-looking wrong answer
// attributed to the FAO.
//
// `oil` has none because a seed oil is an ingredient rather than an additive,
// so no additive class defines it. `other` has none because it is a bucket.
export const GLOSSARY_SOURCE = {
  label: 'Codex Alimentarius food additive functional classes (FAO/WHO)',
  url: 'https://www.fao.org/gsfaonline/reference/techfuncs.html',
} as const

export type FamilyGloss = {
  // Rootify's own plain-English line about what this class does.
  plain: string
  // Verbatim, where a Codex functional class maps cleanly. Attributed in the
  // UI to GLOSSARY_SOURCE, never shown as ours.
  codex?: string
}

const GLOSSARY: Record<AdditiveKey, FamilyGloss> = {
  dye: {
    plain: 'A colour, added to make the food look a particular way rather than to feed you.',
    codex: 'A food additive, which adds or restores colour in a food.',
  },
  flavour: {
    plain:
      'Something added for taste or smell. The label is allowed to say only "natural flavor" or "artificial flavor", so the actual substances are not published.',
  },
  sweetener: {
    plain: 'Something added to make the food taste sweet in place of, or alongside, sugar.',
    codex:
      'A food additive (other than a mono- or disaccharide sugar), which imparts a sweet taste to a food.',
  },
  preservative: {
    plain: 'Something added to stop the food spoiling or going rancid, so it keeps for longer.',
    codex:
      'A food additive, which prolongs the shelf-life of a food by protecting against deterioration caused by microorganisms.',
  },
  emulsifier: {
    plain:
      'Something added to keep ingredients that would separate — oil and water, say — mixed together and smooth.',
    codex:
      'A food additive, which forms or maintains a uniform emulsion of two or more phases in a food.',
  },
  oil: {
    plain:
      'An oil pressed from seeds rather than from a fruit or an animal. An ingredient in its own right, not an additive.',
  },
  other: {
    plain: 'An additive we have classified, in a class too uncommon to have its own colour here.',
  },
}

export function glossFor(key: AdditiveKey): FamilyGloss {
  return GLOSSARY[key]
}

// The whole tooltip for a family, as one string. Used by the legend, and by
// an ingredient row, so the two can never word it differently.
export function familyHelp(key: AdditiveKey): string {
  const g = GLOSSARY[key]
  return g.codex
    ? `${g.plain}\n\n${GLOSSARY_SOURCE.label}: “${g.codex}”`
    : g.plain
}

// The same thing for an ingredient's stored category, which is what a row
// and an ingredient page have in hand. Null when there is no category, and
// the caller must then say "no category on file" rather than guess.
export function categoryHelp(category: string | null | undefined): string | null {
  const key = familyFor(category)
  return key ? familyHelp(key) : null
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

  eq(
    'legend keeps its fixed order',
    familiesPresent(['preservative', 'artificial dye', null]),
    ['dye', 'preservative']
  )
  // The split of 2026-10-13: these two must no longer collapse together.
  eq(
    'preservative and emulsifier are two legend entries',
    familiesPresent(['emulsifier', 'preservative']),
    ['preservative', 'emulsifier']
  )
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

  // ---- the glossary
  eq('preservative and emulsifier are separate now', familyFor('preservative') === familyFor('emulsifier'), false)
  eq('every family has a plain line', LEGEND_ORDER.every((k) => glossFor(k).plain.length > 20), true)
  // The near-miss this file exists to avoid: a flavouring is not a flavour
  // enhancer, so no Codex line may be attached to it.
  eq('no borrowed Codex line on flavourings', glossFor('flavour').codex, undefined)
  eq('no Codex line on seed oil', glossFor('oil').codex, undefined)
  eq('a dye quotes Codex', (glossFor('dye').codex ?? '').startsWith('A food additive'), true)
  eq('help text carries the attribution', familyHelp('dye').includes('Codex Alimentarius'), true)
  eq('help text omits attribution when there is no quote', familyHelp('oil').includes('Codex'), false)
  eq('a stored category resolves to help', (categoryHelp('emulsifier') ?? '').length > 20, true)
  eq('no category means no help', categoryHelp(null), null)

  console.log(bad === 0 ? 'ingredientDisplay: all cases pass' : `ingredientDisplay: ${bad} FAILURES`)
}

// Display-level cleanup for product names.
//
// WHY THIS EXISTS: product names come out of Open Food Facts, where the name
// field is typed by volunteers out of whatever is on the front of the pack.
// A lot of records arrive with a leading separator left over from a longer
// string that got split — ":ratio keto friendly", ", black premium coffee",
// "- Jordans" — or with an invisible bidirectional control character in front
// of the first letter, which the browser renders as a blank gap.
//
// Those characters are typography, not fact. Stripping them changes nothing a
// shopper would check us on, and leaving them in puts junk at the top of every
// list, because the list sorts by name and punctuation sorts before letters.
//
// WHAT THIS DELIBERATELY DOES NOT DO:
//   - It does not change capitalisation. "ratio KETO FRIENDLY" is how the box
//     reads, and a name is a quotation of the package.
//   - It does not strip a leading "!", "¡", "(", quote or "#". Those open real
//     names — "¡Ajua!" is a brand — so removing them would rewrite the name.
//   - It does not rename, expand, translate or de-duplicate anything. Two
//     records that are genuinely the same product are a database problem and
//     get merged in the data, not papered over here.
//
// Only characters that cannot begin a name are removed.

// Zero-width and bidirectional control characters. These are invisible, so
// they never carry meaning in a product name, but they do take up a character
// slot and they do sort before every letter.
const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿]/g

// Separators and connectors: a name cannot start or end with one of these.
// Note the absence of ! ¡ ? ¿ ( [ " ' # — all of which can.
const EDGE_PUNCTUATION = String.raw`:;,.·•\-–—_|/\\*+&~`

const LEADING = new RegExp(`^[${EDGE_PUNCTUATION}\\s]+`)
const TRAILING = new RegExp(`[${EDGE_PUNCTUATION}\\s]+$`)

// ------------------------------------------------- characters, not markup

// HTML ENTITIES ARRIVE AS LITERAL TEXT.
//
// Michael, on a search row reading `&quot;PB&J&quot; Wafer Sticks`: "this is
// not english. we need to do a pass and remove titles like this". He is
// right that it is unreadable, and the cause is narrower than it looks — the
// name is English, it is just still HTML-escaped. Whatever produced the Open
// Food Facts record escaped the characters once too often, so the stored
// name holds the six characters `&quot;` where the package has one `"`.
//
// Across the catalogue on 2026-10-08 this affects 88 product names and 6
// company names, and only three entities appear in any of them:
//
//   &quot;  almost always an INCH MARK — `10&quot; Margherita`, `4&quot;
//           Baked Cherry Pie` — and sometimes a real quotation: `&quot;THE
//           ORIGINAL&quot; TOP THE TATER`.
//   &amp;   an ampersand: `Granola Crunchy Oats &amp; Honey`.
//   &lt;    a less-than sign, which carries the whole meaning of the name it
//           is in: `Eilliens Salted Mixed Nuts &lt;40% Peanuts`,
//           `Cocomels &lt;1g Sugar Caramel Sea Salt`.
//
// That last one is why this is a decode and not a strip. Removing `&lt;`
// turns "under 1g of sugar" into "1g of sugar", which is a false claim about
// the product. Decoding it prints what the package prints.
//
// WHY THE STORED VALUE IS LEFT ALONE. Same reason as every other rule in
// this file: the stored name is the quotation of the source record, and
// search matches against it. A shopper who types `4" pie` is not helped by
// us having rewritten the database, and a reviewer comparing our row against
// the Open Food Facts page needs to see what the record actually says.
//
// SINGLE PASS, DELIBERATELY. `&amp;quot;` means a label that literally reads
// `&quot;`, so it decodes to `&quot;` and stops there. Decoding repeatedly
// until nothing changes would invent a quotation mark that is not on the box.
const ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
}

// The semicolon is required. `AT&T` must survive this function untouched,
// and it does: there is no `;` to close the entity, so no match.
const ENTITY = /&(?:([a-zA-Z]+)|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/g

export function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw
  return raw.replace(ENTITY, (whole, named?: string, dec?: string, hex?: string) => {
    if (named !== undefined) {
      const mapped = ENTITIES[named.toLowerCase()]
      // An entity this function does not know stays as it was written.
      // Guessing at `&euro;` is how a name acquires a character the package
      // does not have; leaving it visible is how someone notices and adds it.
      return mapped ?? whole
    }
    const code = dec !== undefined ? parseInt(dec, 10) : parseInt(hex as string, 16)
    // Control characters, the surrogate range and anything past the end of
    // Unicode are not printable text. A record containing one of those is a
    // broken record, and the honest thing is to leave the escape visible
    // rather than to render an invisible or replacement character that looks
    // like our rendering bug.
    if (!Number.isFinite(code)) return whole
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return whole
    if (code >= 0xd800 && code <= 0xdfff) return whole
    if (code > 0x10ffff) return whole
    return String.fromCodePoint(code)
  })
}

// Legal names, which are NOT product names.
//
// This exists separately because displayName() below strips a trailing
// period, and `La Tourangelle, Inc.` needs its period: that is how the name
// is registered. So a company name gets the entity decode and the whitespace
// collapse, and nothing else.
export function companyDisplayName(raw: string): string {
  const cleaned = decodeEntities(raw).replace(INVISIBLE, '').replace(/\s{2,}/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : raw.trim()
}

export function displayName(raw: string): string {
  const cleaned = decodeEntities(raw)
    .replace(INVISIBLE, '')
    .replace(LEADING, '')
    .replace(TRAILING, '')
    // Collapse runs of whitespace left behind by a removed character.
    .replace(/\s{2,}/g, ' ')
    .trim()

  // If cleanup emptied the string, the record is nothing but punctuation.
  // Show it as it is rather than an empty row — an empty name on screen looks
  // like our bug, and this way a reviewer can see the record and fix it.
  return cleaned.length > 0 ? cleaned : raw.trim()
}

// ------------------------------------------------- one title schema

// TITLE CASE FOR A PRODUCT NAME.
//
// Michael, 2026-10-13: "These products need to have professional looking
// title names. Capitalize first letters where appropriate (excluding non
// important prepositions, i.e. if we should based on proper grammar) so we
// can have a standard title schema".
//
// The names arrive from Open Food Facts in whatever case the contributor
// typed: `activia`, `Chocolate BROWNIE`, `M &M'S Peanut Butter Share Size`,
// `Barra de chocolate con leche`. A shelf of those reads as a database dump,
// which is what he is objecting to.
//
// THE RULE IS DELIBERATELY NARROW, because this runs on 416,382 names in
// many languages and the cost of being clever is wrong-looking names at
// scale. A token's case is changed ONLY when the token is pure letters and
// is entirely lower case or entirely upper case:
//
//   activia            -> Activia        (all lower, capitalised)
//   BROWNIE            -> Brownie        (all upper, brought down)
//   chocolate          -> Chocolate
//
// Everything else is left exactly as stored, which is what protects the
// names that already carry meaning in their case:
//
//   M &M'S             -> M &M'S         (has punctuation, untouched)
//   55g, 1%, 3.40      -> unchanged      (has a digit, untouched)
//   iPhone, McVitie's  -> unchanged      (mixed case, untouched)
//   LLC, USA           -> unchanged      (upper, but only 3 letters)
//
// ALL-CAPS TOKENS OF THREE LETTERS OR FEWER ARE LEFT ALONE, because at that
// length an all-caps word is far more often an acronym or a unit than a
// shouted word: LLC, USA, BBQ, OZ, XL, DHA. "BROWNIE" is seven and gets
// brought down.
//
// UNLESS THE WHOLE NAME IS SHOUTED, which is the exception the first draft
// missed: "CHICKEN BROTH LOW SODIUM" came out as "Chicken Broth LOW Sodium",
// because LOW is three letters and looked like an acronym. In a name with no
// lower-case letter anywhere there is no information in any token's case, so
// the acronym exemption has nothing to go on and is switched off. In a name
// that does have lower case, an all-caps short token was a deliberate
// choice: "BBQ sauce" keeps its BBQ.
//
// WHAT THIS CANNOT FIX, and should not pretend to: `M &M'S` has its space in
// the wrong place in the source record. That is a transcription problem in
// ingestion, not a casing problem, and a casing function that "repaired" it
// would be guessing at the label. It stays as stored and is logged.
const TITLE_STOPWORDS = new Set([
  // Articles, conjunctions, and prepositions of three letters or fewer,
  // which is the line both AP and Chicago draw. Never applied to the first
  // or last word of a name.
  'a', 'an', 'the',
  'and', 'as', 'but', 'for', 'if', 'nor', 'or', 'so', 'yet',
  'at', 'by', 'in', 'of', 'off', 'on', 'per', 'to', 'up', 'via', 'vs',
])

// `forced` means first or last word, which only ever suppresses stopword
// lowering. `shouting` is a property of the WHOLE name. The two are separate
// because conflating them is what produced "Bbq Sauce".
function recase(token: string, forced: boolean, shouting: boolean): string {
  // TRAILING SENTENCE PUNCTUATION CARRIES NO CASE INFORMATION, so it is set
  // aside and reattached instead of disqualifying the word.
  //
  // This was a real defect, reported 2026-10-28 on a USDA-recovered name:
  // "the capital letters here are not professional and need to go away".
  // The name came out as
  //
  //   STRAWBERRY, Red RASPBERRY, BLACKBERRY, Black RASPBERRY, White GRAPE, ...
  //
  // Every word still shouting had a comma stuck to it; every word that got
  // cased did not. The pure-letters guard below exists to protect case that
  // MEANS something — "M &M'S", "55g", "1%", "iPhone" — and a comma means
  // nothing, so a comma should not buy a word an exemption. FDC writes
  // comma-separated flavour lists and 554 of the 611 names recovered from it
  // are ALL CAPS, so this was most of what that recovery put on screen.
  //
  // ONLY `,.;:` AND ONLY AT THE END. Not brackets, not apostrophes, not
  // ampersands, not leading characters. Each of those appears in a case the
  // selftest pins: "(preservative)" stays lower-case inside its parentheses,
  // "&M'S" keeps its shape, "Inc." is already mixed case and untouched. A
  // wider peel would start repairing punctuation, which is ingestion's job
  // and a guess at the label.
  const edge = /^(.*?)([,.;:]+)$/.exec(token)
  const core = edge ? edge[1] : token
  const trailing = edge ? edge[2] : ''

  // Not pure letters: a digit, a symbol, an apostrophe, an ampersand. Leave
  // it exactly as the source wrote it. An empty core — a token that was
  // nothing but punctuation — lands here too.
  if (!/^[A-Za-z]+$/.test(core)) return token

  const recased = recaseWord(core, forced, shouting)
  return recased === core ? token : recased + trailing
}

// The decision itself, on a bare word with no punctuation attached.
function recaseWord(token: string, forced: boolean, shouting: boolean): string {
  const lower = token.toLowerCase()
  const isAllLower = token === lower
  const isAllUpper = token === token.toUpperCase()

  // Mixed case is a deliberate spelling (iPhone, McVitie's, LaCroix).
  if (!isAllLower && !isAllUpper) return token
  // A short all-caps token is an acronym or a unit far more often than a
  // word — unless the whole name is shouted, in which case its case says
  // nothing. This deliberately outranks `forced`.
  if (isAllUpper && !isAllLower && token.length <= 3 && !shouting) return token

  if (!forced && TITLE_STOPWORDS.has(lower)) return lower
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function titleCaseName(raw: string): string {
  // No lower-case letter anywhere means the source shouted the whole name.
  const shouting = !/[a-z]/.test(raw)
  const tokens = raw.split(/(\s+)/)
  // Which tokens are words, so "first" and "last" mean the first and last
  // WORD rather than the first and last chunk of whitespace.
  const wordIndexes = tokens
    .map((t, i) => (t.trim().length > 0 ? i : -1))
    .filter((i) => i !== -1)
  if (wordIndexes.length === 0) return raw
  const first = wordIndexes[0]
  const last = wordIndexes[wordIndexes.length - 1]

  return tokens
    .map((t, i) => (t.trim().length === 0 ? t : recase(t, i === first || i === last, shouting)))
    .join('')
}

// --------------------------------------------------------------- selftest
//   npx tsx src/lib/productName.ts --selftest
if (process.argv[1]?.endsWith('productName.ts')) {
  let bad = 0
  const eq = (src: string, want: string) => {
    const got = titleCaseName(src)
    const ok = got === want
    if (!ok) bad++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(src)} -> ${JSON.stringify(got)}${ok ? '' : ` want ${JSON.stringify(want)}`}`)
  }
  eq('activia', 'Activia')
  eq('Chocolate BROWNIE', 'Chocolate Brownie')
  eq('cream of mushroom soup', 'Cream of Mushroom Soup')
  eq('the best of the best', 'The Best of the Best')
  eq('to go', 'To Go')
  // The shouted name, and the reason `shouting` exists.
  eq('CHICKEN BROTH LOW SODIUM', 'Chicken Broth Low Sodium')
  eq('DARK CHOCOLATE SEA SALT', 'Dark Chocolate Sea Salt')
  // Case that carries meaning, left alone.
  eq('BBQ sauce', 'BBQ Sauce')
  eq('LLC brand foods', 'LLC Brand Foods')
  eq('iPhone case', 'iPhone Case')
  eq('La Tourangelle, Inc.', 'La Tourangelle, Inc.')
  // Tokens with punctuation or digits are never touched.
  eq("M &M'S Peanut Butter Share Size", "M &M'S Peanut Butter Share Size")
  eq('Snickers Creamy Peanut Butter 55g', 'Snickers Creamy Peanut Butter 55g')
  eq('organic valley 1% lowfat milk', 'Organic Valley 1% Lowfat Milk')
  eq('sodium benzoate (preservative)', 'Sodium Benzoate (preservative)')
  // TRAILING PUNCTUATION MUST NOT EXEMPT A WORD. The defect reported on
  // 2026-10-28: a comma-separated shouted flavour list came back half
  // shouting, because every word with a comma stuck to it skipped the recase
  // entirely. This is the actual stored name of 0022000285287, after
  // trimRedundantTail has removed its doubled tail.
  eq(
    'STRAWBERRY, RED RASPBERRY, BLACKBERRY, BLACK RASPBERRY, WHITE GRAPE, CHERRY BERRY FLAVORED WILD BERRIES GUMMIES',
    'Strawberry, Red Raspberry, Blackberry, Black Raspberry, White Grape, Cherry Berry Flavored Wild Berries Gummies'
  )
  eq('CHERRY, GRAPE, LEMON-LIME, MIXED BERRY', 'Cherry, Grape, LEMON-LIME, Mixed Berry')
  eq('MILK, 2%', 'Milk, 2%')
  eq('CHICKEN; BEEF: PORK.', 'Chicken; Beef: Pork.')
  // A stopword with a comma is still a stopword, and still not lowered when
  // it is the last word.
  eq('SOUP OF THE DAY, OF', 'Soup of the Day, Of')
  // Tokens that are nothing but punctuation survive untouched.
  eq('...', '...')
  eq('A , B', 'A , B')
  // Degenerate input must come back unchanged rather than empty.
  eq('', '')
  eq('   ', '   ')
  console.log(bad === 0 ? 'titleCaseName: all cases pass' : `titleCaseName: ${bad} FAILURES`)

  // ---- trimRedundantTail ----
  let badTrim = 0
  const tt = (src: string, want: string) => {
    const got = trimRedundantTail(src)
    const ok = got === want
    if (!ok) badTrim++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(src)} -> ${JSON.stringify(got)}${ok ? '' : ` want ${JSON.stringify(want)}`}`)
  }
  // The shape this exists for, from the FDC recovery log.
  tt('SWEETENED RICE CEREAL, SWEETENED', 'SWEETENED RICE CEREAL')
  tt('GUAVA NECTAR, GUAVA', 'GUAVA NECTAR')
  tt('PEANUT BUTTER PLANT PROTEIN BARS, PEANUT BUTTER', 'PEANUT BUTTER PLANT PROTEIN BARS')
  tt('GARLIC BUTTER SMOKED OYSTERS, GARLIC BUTTER', 'GARLIC BUTTER SMOKED OYSTERS')
  tt('AGUAS FRESCAS STRAWBERRY ENERGY DRINK, STRAWBERRY', 'AGUAS FRESCAS STRAWBERRY ENERGY DRINK')
  // Repeated more than once.
  tt('CREAMY MILK CHOCOLATE, CREAMY MILK CHOCOLATE, CREAMY MILK CHOCOLATE', 'CREAMY MILK CHOCOLATE')
  // A doubled flavour list unwinds one item per pass, leaving the real name.
  tt(
    'CHERRY, GRAPE, LEMON-LIME, MIXED BERRY, ORANGE ELECTROLYTE FREEZER POPS, CHERRY, GRAPE, LEMON-LIME, MIXED BERRY, ORANGE',
    'CHERRY, GRAPE, LEMON-LIME, MIXED BERRY, ORANGE ELECTROLYTE FREEZER POPS'
  )
  // MUST NOT TOUCH: nothing repeats.
  tt('Water, Sugar', 'Water, Sugar')
  tt('La Tourangelle, Inc.', 'La Tourangelle, Inc.')
  tt('Ham, Original', 'Ham, Original')
  tt('Chocolate Chip Cookies', 'Chocolate Chip Cookies')
  // MUST NOT MATCH ON A SUBSTRING. "ran" is inside "orange" but is not a
  // token of it, and "cola" is inside "chocolate" by letters only.
  tt('ORANGE SODA, RAN', 'ORANGE SODA, RAN')
  tt('CHOCOLATE BAR, COLA', 'CHOCOLATE BAR, COLA')
  // A tail too short to be worth judging is left alone.
  tt('MILK, 2%', 'MILK, 2%')
  // Never strip down to nothing.
  tt('Oz, Oz', 'Oz, Oz')
  tt('', '')
  console.log(badTrim === 0 ? 'trimRedundantTail: all cases pass' : `trimRedundantTail: ${badTrim} FAILURES`)
}

// ------------------------------------------------- the brand, said once

// Open Food Facts names usually repeat the brand: the record for a King
// Arthur flour is called "King Arthur '00' Neapolitan-Style Pizza Flour".
// On a Rootify row the company name is already printed directly above the
// product name, so the brand is said twice in two lines.
//
// This removes the brand from the FRONT of the name only, and only when it is
// genuinely the same brand. It is a display change, not a rename: the stored
// name is untouched and search still matches against it, so a shopper can
// type "King Arthur" and find this product even though the row no longer
// prints those words twice.

// Compared loosely: case, curly vs straight apostrophes and runs of
// whitespace should not decide whether two spellings are the same brand.
function loose(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// Every prefix of a company name that might be the brand, longest first:
// "King Arthur Baking Company" -> "king arthur baking company",
// "king arthur baking", "king arthur", "king".
//
// Longest-first matters. For "Nature's Path Foods" the two-word prefix is the
// brand; if the one-word prefix were tried first, "Nature's Path Organic
// Flakes" would come out as "Path Organic Flakes".
function brandCandidates(companyName: string): string[] {
  const words = loose(companyName)
    .split(' ')
    // A trailing comma is list punctuation from the legal name, not part of
    // the word. Without this, "La Tourangelle, Inc." offers the prefix
    // "la tourangelle," which never matches the product "La Tourangelle
    // Organic extra virgin olive oil". Periods are left alone, because a
    // name like "1.2.3 Gluten Free" needs them.
    .map((w) => w.replace(/[,;]+$/, ''))
    .filter(Boolean)
  const out: string[] = []
  for (let n = words.length; n >= 1; n--) {
    const candidate = words.slice(0, n).join(' ')
    // A one or two character prefix is not a brand, it is a coincidence.
    if (candidate.length >= 3) out.push(candidate)
  }
  return out
}

// True if `name` starts with `brand` AND the brand ends where a word ends.
//
// Three separate traps, each of which produced a wrong name in testing:
//
//   1. No boundary check at all: company "Rise" turns "Risotto Rice" into
//      "tto Rice".
//   2. Treating an apostrophe as a boundary: company "Campbell Soup Supply
//      Co." matches the first word of "Campbell's Chicken Broth" and leaves
//      "'s Chicken Broth". The possessive means the brand word was longer
//      than the match.
//   3. Ignoring what follows: company "Rise" matches the start of "Rise &
//      Shine Bars" at a clean space boundary, and strips a brand that was
//      really the first half of a compound product name, leaving "Shine
//      Bars". An "&" or "+" after the match means the two sides belong
//      together.
function startsWithBrand(name: string, brand: string): boolean {
  const n = loose(name)
  if (!n.startsWith(brand)) return false

  const next = n.charAt(brand.length)
  // An apostrophe counts as part of the word, not a boundary (trap 2).
  if (next !== '' && /[a-z0-9']/.test(next)) return false

  // Look past the separator: a conjunction joins the two halves (trap 3).
  const after = n.slice(brand.length).replace(/^[\s,:;.\-\u2013\u2014|/]+/, '')
  if (/^[&+]/.test(after)) return false

  return true
}

// FDC'S REDUNDANT TAIL CLAUSE.
//
// USDA FoodData Central writes a product name as "DESCRIPTION, MODIFIER", and
// the modifier usually just repeats part of the description:
//
//   "SWEETENED RICE CEREAL, SWEETENED"
//   "GUAVA NECTAR, GUAVA"
//   "PEANUT BUTTER PLANT PROTEIN BARS, PEANUT BUTTER"
//
// 333 of the 552 names recovered from FDC carry it (recover-product-names.ts,
// 2026-10-26), so without this 60% of those titles would read badly. The
// stored value stays verbatim — that is the record — and this is display only.
//
// IT REMOVES A REPETITION, NOT INFORMATION, and that is what makes it safe
// under the project's rule about never inventing a name the record does not
// carry: every word dropped already appears earlier in the same string.
//
// CONSERVATIVE ON PURPOSE. The clause goes only when the WHOLE tail already
// appears in the head as a complete run of words — compared on the normalised
// form and padded with spaces so a token boundary is required. Substring
// matching would be a disaster here: "ORANGE" must not match inside
// "...ORANGE ELECTROLYTE..." by accident, and a genuine flavour list whose
// last item merely resembles an earlier one must keep it.
//
// It loops because FDC sometimes repeats more than once ("VANILLA, VANILLA,
// VANILLA"), and because unwinding a doubled flavour list takes one pass per
// item. It never returns something too short to identify a product.
export function trimRedundantTail(name: string): string {
  let out = name.trim()
  for (let i = 0; i < 8; i++) {
    const comma = out.lastIndexOf(',')
    if (comma <= 0) break
    const head = out.slice(0, comma).trim()
    const tail = out.slice(comma + 1).trim()
    const h = head.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const tl = tail.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (tl.length < 3) break
    // Token-boundary containment, not substring.
    if (!` ${h} `.includes(` ${tl} `)) break
    // Never trim away so much that nothing identifiable is left.
    if (head.replace(/[^a-z0-9]/gi, '').length < 3) break
    out = head
  }
  return out
}

export function productDisplayName(
  rawName: string,
  companyName: string | null | undefined,
  dbaNames: string[] = []
): string {
  const cleaned = trimRedundantTail(displayName(rawName))
  if (!companyName && dbaNames.length === 0) return cleaned

  const candidates = [companyName ?? '', ...dbaNames]
    .map(decodeEntities)
    .filter(Boolean)
    .flatMap((n) => brandCandidates(n))
    // Longest first across all the names a company goes by.
    .sort((a, b) => b.length - a.length)

  for (const brand of candidates) {
    if (!startsWithBrand(cleaned, brand)) continue
    const rest = displayName(cleaned.slice(brand.length))
    // Never strip the brand if the brand IS the whole name, and never leave
    // behind a fragment too short to identify anything. "Jovial" under
    // Jovial Foods stays "Jovial"; a row with no name is worse than a
    // repeated one.
    if (rest.length >= 3 && /[a-z0-9]/i.test(rest)) return titleCaseName(rest)
    return titleCaseName(cleaned)
  }

  return titleCaseName(cleaned)
}

// ------------------------------------------------------------- the brand

// THE NAME ON THE SHELF, when it is not the name of the company.
//
// Michael, 2026-10-08, on CROPP Cooperative's "1% Lowfat Milk": "this should
// say 'Organic Valley 1% Lowfat Milk'. it should be 'brand, then, concise
// product name'."
//
// He is right that the page was unreadable: the header said "CROPP
// Cooperative" over "1% Lowfat Milk", and nothing anywhere said Organic
// Valley — the only words actually printed on the carton. CROPP is the
// co-operative that owns the brand, which is a fact worth having and not the
// fact a shopper is holding.
//
// There is no brand column on Product. What there is, is Company.dbaNames,
// and CROPP's is exactly ["Organic Valley"].
//
// THE TRAP, and why this is not just dbaNames[0]: for most companies
// dbaNames holds spelling variants of their own legal name, not a distinct
// brand. Alexandre Family Farm has ["Alexandra Family Farm", "Alexandre
// Family Farms", "Alexandre Farms"]; Mars has ["Mars Candy", "Mars Wrigley",
// ...]; Nature's Path has ["Nature path", "Nature's Path Organic"]. Prefixing
// any of those would print the company's name twice with one of them
// misspelled.
//
// So a dbaName qualifies as a brand only when it shares NO significant word
// with the legal name. "Organic Valley" vs "CROPP Cooperative" shares
// nothing and qualifies. Every variant above shares its distinguishing word
// and does not. Corporate-form words are not significant — two companies
// both called "Inc" are not related — so they are dropped before comparing.
const CORPORATE_WORDS = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'ltd', 'limited', 'co', 'company',
  'corp', 'corporation', 'gmbh', 'sa', 'ag', 'nv', 'bv', 'plc', 'holdings',
  'group', 'brands', 'foods', 'food', 'farms', 'farm', 'cooperative', 'coop',
  'the', 'and', 'of', 'north', 'america', 'usa', 'us', 'international',
])

// Exported so scripts/probe-brand-prepend.ts can hold a frozen copy of the
// PRE-FIX productBrand logic beside the fixed one and diff the two. Nothing
// else should need it.
export function significantWords(name: string): Set<string> {
  const out = new Set<string>()
  for (const w of name.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 2) continue
    if (CORPORATE_WORDS.has(w)) continue
    out.add(w)
  }
  return out
}

// IS THIS CANDIDATE JUST THE LEGAL NAME, SPELLED DIFFERENTLY?
//
// `productBrand` below decides a dbaName is a DISTINCT brand when it shares
// no significant word with the legal name. That premise is sound for
// `CROPP Cooperative` / `Organic Valley`. It is defeated by a misspelling,
// and dbaNames come from crowdsourced OFF brand strings, so misspellings are
// everywhere. Member's Mark carries ten of them:
//
//   Member Mark · Member's Marks · Memberd Mark · Membermark · Members Mrk
//   Memebers Mark · Menmbers Mark · Members Mark Sparkling Water · ...
//
// `significantWords` splits on non-alphanumerics and drops tokens under two
// characters, so `Member's Mark` yields {member, mark} and the possessive
// vanishes. `Membermark` yields {membermark}: no overlap, so it was judged a
// different brand and printed as an <h1> on every Member's Mark product.
// THE SITE WAS PUBLISHING A BRAND NAME THAT DOES NOT EXIST.
//
// Same root cause as `Fritolay` vs `Frito-Lay Company`, which was logged
// separately as a data defect. It is one bug in one function.
//
// Three tests, cheapest first:
//   1. identical once punctuation is removed
//   2. identical to the legal name's significant words run together, which
//      is what dropping a possessive or a space produces
//   3. within a small edit distance, which is what a typo produces
//
// Edit distance applies ONLY at eight characters or more. Below that a single
// character is a large share of the word and real brands collide: `Dove` and
// `Dave` are one substitution apart and are not the same company.
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = cur
  }
  return prev[b.length]
}

// FOLD ACCENTS, DO NOT DELETE THEM.
//
// `[^a-z0-9]` removes an accented letter outright, so `Muller` and `Müller`
// compared as `muller` against `mller` and read as two different brands. The
// 2026-11-03 probe found about twenty of these still printing a "distinct
// brand" that was the company's own name with its diacritics:
//
//   Muller -> "Müller" · Kras -> "Kraš" · Stok -> "STOK" · Zursun -> "Zürsun"
//   Bequet -> "Bequet" · Sacla Italia -> "Sacla" · Manoa -> "Manoa"
//
// Nestle was worse than cosmetic: `Nestlé` squashed to `nestl`, five
// characters, which fell under the six-character floor and was never tested
// at all - so the typo `Neslet` printed as the brand on 560 products.
//
// NFD splits a letter into its base plus a combining mark; stripping the
// U+0300-U+036F block then leaves the base letter.
function squashed(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

// A RATIO, NOT A FIXED BUDGET.
//
// The first version allowed `max(1, 20% of the shorter string)` edits and
// required eight characters. The probe showed what that misses:
//
//   Wegmans            Wegman     -> Wegmen        4,189 products
//   Whole Foods Market wholefoods -> While Foods   2,219
//   Food Lion          FoodLion   -> Food Line     1,909
//   Kellogg's          Kellog     -> Kelligs         966
//
// `Wegmen` is six characters, so the eight-character floor skipped it
// without testing. `Food Line` is two edits from `Food Lion` at eight
// characters, where the budget was one.
//
// SIX CHARACTERS IS THE FLOOR, AND IT IS DOING THE REAL WORK. `Dove` and
// `Dave` are one edit apart in four characters - 25%, the same ratio as
// `foodline`/`foodlion` - so no threshold separates them. Length does.
//
// THIS IS SAFER THAN IT LOOKS because of WHERE it runs: a candidate is only
// ever compared against the legal name of THE SAME COMPANY RECORD, never
// across the catalogue. Two genuinely different brands filed under one
// company (CROPP Cooperative / Organic Valley) are nothing alike as strings.
// The loose end of this threshold is spent on misspellings of a name we are
// already holding, which is exactly the population it is for.
function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.min(a.length, b.length) < 6) return false
  return editDistance(a, b) / Math.max(a.length, b.length) <= 0.34
}

// EVERY word, longest prefix first - NOT significantWords.
//
//   "Ghiradelli Chocolate" -> ["ghiradellichocolate", "ghiradelli"]
//
// THE DISTINCTION THAT COST A RUN. `significantWords` drops CORPORATE_WORDS,
// and `foods` is one of them, so it reports
// `significantWords("Whole Foods Market") = ['whole', 'market']`. That is
// right for the question it was built for - whether a dbaName names a
// DIFFERENT COMPANY, where `Acme Foods` and `Acme` are the same firm - and
// wrong for the question here, which is whether one string is a misspelling
// of another. `While Foods` and `Whole Foods Market` differ by one letter in
// the word that filter deletes.
//
// So the spelling test splits on punctuation only and keeps everything. The
// overlap test further down still uses significantWords, because it is still
// asking the other question.
function rawPrefixes(name: string): string[] {
  const words = companyDisplayName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const out: string[] = []
  for (let n = words.length; n >= 1; n--) out.push(words.slice(0, n).join(''))
  return out
}

export function isSpellingOfLegalName(candidate: string, legalName: string): boolean {
  const c = squashed(candidate)
  if (c.length === 0) return false
  // Two ways to write the legal name: verbatim minus punctuation, and its
  // significant words run together (which is what dropping a possessive or a
  // corporate suffix produces).
  const refs = [squashed(legalName), [...significantWords(companyDisplayName(legalName))].join('')]

  // PREFIXES ON ONE SIDE AT A TIME, NEVER BOTH.
  //
  // Two different shortenings are needed, for two different shapes:
  //
  //   candidate prefix vs legal whole - `Ghiradelli Chocolate` is the legal
  //     name plus a descriptor, and the typo in `Ghiradelli` breaks a plain
  //     substring test, so the first word has to be compared on its own.
  //
  //   candidate whole vs legal prefix - `While Foods` is a misspelling of a
  //     legal name that carries an extra word, `Whole Foods Market`. Against
  //     the full legal name it is six edits (37%) and misses; against the
  //     prefix `wholefoods` it is one (10%).
  //
  // PREFIX AGAINST PREFIX IS NOT DONE, and that restraint is the point. It
  // would reduce both names to their first word, so any shared leading word
  // of six characters would merge two brands: `Organic Girl` and
  // `Organic Valley` both begin `organic` and are not the same thing.
  for (const prefix of rawPrefixes(candidate).concat(c)) {
    if (prefix.length === 0) continue
    for (const ref of refs) {
      if (ref.length === 0) continue
      if (nearlyEqual(prefix, ref)) return true
    }
  }
  for (const ref of rawPrefixes(legalName)) {
    if (ref.length === 0) continue
    if (nearlyEqual(c, ref)) return true
  }
  return false
}

// IS THIS CANDIDATE A SUB-BRAND, A PRODUCT LINE, OR A TRUNCATION?
//
// Added 2026-11-03 after the first probe run. Suppressing the squashed
// candidate made productBrand fall through to the NEXT dbaName, and for 87
// companies (~13,000 products) that was worse than what it replaced:
//
//   Hy-Vee       Hyvee        -> Hyvee Select
//   Del Monte    delmonte     -> Delmonte Quality
//   Larabar      Lara Bar     -> LARABAR KIDS
//   Bumble Bee   Bumblebee    -> Bumblebee Tiny Shrimp
//
// None of those is a different brand; each is the same brand plus a product
// line. The containment test is exact and needs no threshold: `hyveeselect`
// contains `hyvee`, while `organicvalley` has no such relationship to
// `croppcooperative` and survives.
//
// IT RUNS IN BOTH DIRECTIONS, because the dbaName is sometimes the shorter
// one: `Realgood Foods Co.` offers `Real Good Foods`, which is the legal name
// with the corporate suffix dropped.
//
// FIVE CHARACTERS MINIMUM. A three- or four-letter legal name appears inside
// unrelated words by coincidence, and a coincidence here deletes a real
// brand from every one of that company's pages.
function isBrandLineOfLegalName(candidate: string, legalName: string): boolean {
  const c = squashed(candidate)
  const refs = [squashed(legalName), [...significantWords(companyDisplayName(legalName))].join('')]
  for (const ref of refs) {
    if (ref.length < 5 || c.length < 5) continue
    if (c === ref) continue // handled by isSpellingOfLegalName
    if (c.includes(ref) || ref.includes(c)) return true
  }
  return false
}

// THE BRAND, FROM A HAND-VERIFIED LIST - NOT FROM dbaNames.
//
// WHAT THIS REPLACED, AND WHY. Until 2026-11-03 this function searched a
// company's crowdsourced `dbaNames` for one that shared no significant word
// with the legal name, and treated that as a distinct shelf brand. The probe
// measured the result across all 6,312 companies that have any dbaName:
//
//   ~600 products got a correct brand
//   ~15,900 got a wrong one           -- 96% wrong
//
// and the largest cases were the worst:
//
//   Kroger      -> "Car master"              6,704 products
//   Weis        -> "weis2GO"                 2,595
//   Aldi        -> "Appetites"               1,533
//   Publix      -> "GreenJise"               1,379   (typo of GreenWise)
//   Lidl        -> "Alesto"                  1,108   (a nut line, not a brand)
//   Walmart     -> "Markerside"              1,772   (typo of Marketside)
//
// THE PREMISE WAS UNFIXABLE, not mis-tuned. Four rounds of guards -
// squashed-spelling, typo tolerance, containment, accent folding - removed
// 95,734 bad prepends and could not touch these, because `Markerside` and
// `GreenJise` really are not spellings of `Walmart` or `Publix`. They are
// misspellings of real SUB-BRANDS, and no comparison against the legal name
// can tell a sub-brand from a brand. A heuristic that cannot distinguish its
// own successes from its failures does not get to run on a page.
//
// This also follows what Michael asked for on 2026-11-02: "The title also
// should not have the parent company / brand in it." In the three-line
// layout the brand line is the COMPANY RECORD, which is a sourced fact.
//
// WHY THE LIST IS SHORT, AND WHY IT SHOULD STAY SHORT. One company maps to
// one brand here, and that is only true when the company sells under a
// single consumer brand. It is FALSE for a multi-brand parent, so Procter &
// Gamble, Kimberly-Clark, Campbell Soup Supply and TOMY are deliberately
// absent even though the probe found a real brand for each: mapping
// Kimberly-Clark to "Huggies" would label its Kleenex products Huggies.
// Add an entry only after checking that the company has no second brand in
// the catalogue.
//
// Keys are the legal name, lowercased. Values are printed verbatim.
const CURATED_BRAND = new Map<string, string>([
  // Michael, 2026-10-08: "this should say 'Organic Valley 1% Lowfat Milk'.
  // it should be 'brand, then, concise product name'." CROPP is the
  // co-operative that owns the brand; Organic Valley is what is on the
  // carton, and it is the only consumer brand CROPP sells under.
  ['cropp cooperative', 'Organic Valley'],
  ['nurture llc', 'Happy Baby'],
  ['irish breeze limited', 'WaterWipes'],
  ['handi-craft company', "Dr. Brown's"],
])

/**
 * The shelf brand, when it is not the company name.
 *
 * `dbaNames` is accepted and DELIBERATELY IGNORED. The parameter is kept so
 * the two call sites stay unchanged, and because the argument documents what
 * this function used to read. Deriving a brand from it is the defect
 * described above; do not reinstate it.
 */
export function productBrand(legalName: string, dbaNames: string[]): string | undefined {
  void dbaNames
  return CURATED_BRAND.get(companyDisplayName(legalName).trim().toLowerCase())
}

// Prepends the brand to a heading, unless the name already carries it.
// Returns the heading unchanged when there is no distinct brand — which is
// the common case, because for most products the company name IS the brand
// and is already printed directly above the heading.
export function headingWithBrand(heading: string, brand: string | undefined): string {
  if (!brand) return heading
  const h = heading.toLowerCase()
  const b = brand.toLowerCase()
  if (h.startsWith(b)) return heading
  // Any significant brand word already in the heading means the label is
  // already identifying itself; do not say it twice.
  //
  // No escaping needed: significantWords splits on /[^a-z0-9]+/, so every
  // word it yields is alphanumeric and cannot carry regex syntax.
  for (const w of significantWords(brand)) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(heading)) {
      return heading
    }
  }
  return `${brand} ${heading}`
}

// ------------------------------------------------- a name you can take in

// HOW LONG A NAME HAS TO BE before it is worth shortening, and how far in a
// cut is allowed to land. Both thresholds exist to stop this firing on names
// that are already fine: "Milk, 2%" must stay "Milk, 2%", because "Milk" is
// a worse answer than the thing it replaced.
const LONG_ENOUGH_TO_SHORTEN = 44
const EARLIEST_CUT = 12

// Where a product name stops being the name and starts being the spec list.
// A comma, a semicolon or an opening bracket — the places a label author
// stopped naming the thing and started enumerating it.
const SPEC_LIST_STARTS = /[,;(–—]|\s-\s/

// The name for a heading, when the stored one is a paragraph.
//
// Michael's case: "50-50 baby spinach, baby lettuce, baby greens, radicchio".
// All of that is on the package and all of it is worth keeping, but as an
// <h1> it is a wall. Think like a layman: too much unneeded text and they
// stop reading. So the heading gets "50-50 baby spinach" and the full name
// goes on a quieter line underneath.
//
// THE RULE THAT MAKES THIS SAFE: this never appears alone. Every caller that
// shortens a name must also show `name` in full nearby — see the product
// page header. A cut at the first comma is a decent guess and sometimes a
// poor one ("divinely decadent, silky & rich brownies baking mix" loses the
// part that says what it is), and that is tolerable ONLY because nothing is
// actually hidden. Shorten without showing the full name and this becomes
// Rootify deciding what a product is called, which is not ours to decide.
// The longest a heading may be after shortening. A cut at the first comma is
// not always enough: "Buffalo-style chicken fully cooked breaded spicy
// chicken breast patty on a corn-dusted bun sandwich, buffalo-style chicken"
// has its first comma 98 characters in, and a 98-character heading is the
// wall we were trying to avoid. Names with no comma at all can be just as
// long. So there is a ceiling as well as a cut.
const MAX_HEADING = 56

// Trims to at most MAX_HEADING, at a word boundary, never mid-word.
function toCeiling(text: string): string {
  if (text.length <= MAX_HEADING) return text
  const clipped = text.slice(0, MAX_HEADING)
  const lastSpace = clipped.lastIndexOf(' ')
  const head = (lastSpace > EARLIEST_CUT ? clipped.slice(0, lastSpace) : clipped).replace(
    /[\s,;:.\-–—&/]+$/,
    ''
  )
  return head.length >= EARLIEST_CUT ? head : text
}

// LEADING CLAIMS, stripped so the noun survives.
//
// Michael, 2026-10-08, on "A2/A2 100% Grass-fed Regenerative Organic
// Probiotic Kefir": "the title should have less and be more concise to what
// the product actually is."
//
// That name is 57 characters, so the ceiling fired and cut from the END —
// which removed "Kefir", the only word that says what the product is, and
// kept five claims that could describe a dozen different foods. The shape is
// common on premium labels: a stack of marketing claims, then the noun, last.
// Cutting the tail is exactly backwards for it.
//
// So a recognised run of claims is removed from the FRONT first. Each entry
// is a claim about how the food was made or what it does not contain, never
// a word that says what the food IS.
const LEADING_CLAIM = new RegExp(
  '^(?:' +
    [
      String.raw`\d+(?:\.\d+)?\s*%`,                 // 100%, 2%
      String.raw`a[12](?:\s*/\s*a[12])?`,              // A2, A1/A2, A2/A2
      'grass[\\s-]?fed',
      'pasture[\\s-]?raised',
      'free[\\s-]?range',
      'cage[\\s-]?free',
      'regenerative(?:ly\\s+grown)?',
      'certified',
      'usda',
      'organic',
      'non[\\s-]?gmo(?:\\s+project\\s+verified)?',
      'gluten[\\s-]?free',
      'dairy[\\s-]?free',
      'sugar[\\s-]?free',
      'all[\\s-]?natural',
      'natural',
      'raw',
      'whole[\\s-]?30',
      'keto(?:\\s+friendly)?',
      'paleo',
      'vegan',
      'kosher',
      'halal',
      'premium',
      'artisan(?:al)?',
      'small[\\s-]?batch',
      'cold[\\s-]?pressed',
      'unsweetened',
      'no\\s+sugar\\s+added',
      'fair[\\s-]?trade',
      'heritage',
      'ultra[\\s-]?filtered',
      'grade\\s+a',
    ].join('|') +
  ')(?:[\\s,/&-]+|$)',
  'i'
)

// The remainder has to still be a name, not a fragment. Two words or ~10
// characters is the floor; below that the claims WERE the name and the stored
// version is the better answer.
const CLAIMS_FLOOR = 10

// Peels recognised claims off the front, one at a time, stopping as soon as
// the remainder would drop below the floor. Returns the input unchanged when
// nothing was recognised — so an unfamiliar label shape is left alone rather
// than guessed at.
function stripLeadingClaims(text: string): string {
  let out = text
  for (;;) {
    const m = LEADING_CLAIM.exec(out)
    if (!m || m[0].length === 0) break
    const rest = out.slice(m[0].length).trim()
    // Never strip down to nothing, and never strip the last word away: a
    // product genuinely called "Organic" has "Organic" as its name.
    if (rest.length < CLAIMS_FLOOR || !/[a-z]/i.test(rest)) break
    out = rest
  }
  return out
}

export function shortProductName(name: string): string {
  const raw = name.trim()
  if (raw.length <= LONG_ENOUGH_TO_SHORTEN) return raw

  // Claims come off the front BEFORE any tail cut, so the ceiling is spent on
  // the part of the name that identifies the product.
  const full = stripLeadingClaims(raw)
  if (full.length <= LONG_ENOUGH_TO_SHORTEN) return full

  const m = SPEC_LIST_STARTS.exec(full)
  if (m && m.index >= EARLIEST_CUT) {
    const head = full.slice(0, m.index).replace(/[\s,;:.\-–—]+$/, '').trim()
    if (head.length >= EARLIEST_CUT) return toCeiling(head)
  }

  // No usable spec-list break — a long name that is simply long.
  return toCeiling(full)
}

// True when the heading is showing less than the stored name, so a caller
// knows it owes the reader the full version.
export function isShortened(name: string): boolean {
  return shortProductName(name) !== name.trim()
}


// ----------------------------------------------- selftest, part two
//
// A SECOND BLOCK, AT THE END OF THE FILE ON PURPOSE.
//
// These cases call significantWords, which reads CORPORATE_WORDS - a `const`
// declared BELOW the first selftest block. Running them up there threw
// `ReferenceError: Cannot access 'CORPORATE_WORDS' before initialization`:
// the temporal dead zone. The original block only exercised titleCaseName and
// trimRedundantTail, neither of which touches that set, so it never hit it.
//
// Anything added here that reaches a module-level const must live after that
// const is initialised. Keeping the brand tests at the bottom makes that
// automatic rather than something to remember.
if (process.argv[1]?.endsWith('productName.ts')) {
  // ---- productBrand / isSpellingOfLegalName ----
  //
  // Every MEMBERS_MARK case below is a real dbaName on the live Member's Mark
  // company record, 2026-11-03. The first of them, `Membermark`, was being
  // printed as the <h1> brand on every Member's Mark product page.
  let badBrand = 0
  const sp = (cand: string, legal: string, want: boolean) => {
    const got = isSpellingOfLegalName(cand, legal)
    const ok = got === want
    if (!ok) badBrand++
    console.log(`${ok ? 'ok  ' : 'FAIL'} spelling ${JSON.stringify(cand)} of ${JSON.stringify(legal)} -> ${got}${ok ? '' : ` want ${want}`}`)
  }
  const MM = "Member's Mark"
  sp('Membermark', MM, true)        // squashed, the reported defect
  sp('Members Mrk', MM, true)       // typo
  sp('Memebers Mark', MM, true)     // typo
  sp('Menmbers Mark', MM, true)     // typo
  sp('Memberd Mark', MM, true)      // typo
  sp("Member's Marks", MM, true)    // plural
  sp('Member Mark', MM, true)       // possessive dropped
  sp('Fritolay', 'Frito-Lay Company', true)   // the same bug, logged separately
  // GENUINELY DIFFERENT BRANDS MUST SURVIVE. This is the case the function
  // exists for, and over-merging would silently delete it.
  sp('Organic Valley', 'CROPP Cooperative', false)
  sp('Ben & Jerry', 'Unilever', false)
  // SHORT NAMES GET NO TYPO TOLERANCE: one character is too large a share,
  // and these ratios are identical to real typo pairs. Length separates them.
  sp('Dove', 'Dave', false)
  sp('Oreo', 'Oreq', false)
  // The four that defeated the fixed budget, all real, from the probe.
  sp('Wegmen', 'Wegmans', true)              // 6 chars, under the old floor
  sp('While Foods', 'Whole Foods Market', true) // legal has an extra word
  sp('Food Line', 'Food Lion', true)         // 2 edits in 8 characters
  sp('Kelligs', "Kellogg's", true)
  sp('Philsburry', 'Pillsbury', true)
  sp('Arizono', 'Arizona', true)
  sp('Cheese its', 'Cheez-It', true)
  // A typo in the FIRST word must not let a line extension through.
  sp('Ghiradelli Chocolate', 'Ghirardelli', true)
  sp('Kiolbasa Smoked Meats', 'Kiolbassa', true)
  sp('Wellesley Farms Bacon', 'Wellsley Farms', true)
  // GENUINELY DIFFERENT CORPORATE NAMES MUST SURVIVE the looser threshold.
  // The risk introduced by prefixing the legal name: a shared leading word.
  // These must NOT merge.
  // ACCENTS ARE THE SAME LETTER. All real, from the 2026-11-03 probe.
  sp('Müller', 'Muller', true)
  sp('Kraš', 'Kras', true)
  sp('Zürsun', 'Zursun Ltd.', true)
  sp('Neslet', 'Nestlé', true)   // only reachable once the accent folds
  sp('Tajín Clasico', 'Tajin', true)
  sp('Ragú Kettle', 'Ragu', true)
  sp('Organic Girl', 'Organic Valley', false)
  sp('General Foods', 'General Electric', false)
  sp('Natrual Bliss', 'Coffee mate', false)
  sp('SUNWICK ALMONDS', '180 Snacks Inc.', false)
  sp('Western Heart', "Van De Kamp's", false)
  sp('North American Bison Cooperative', 'TenderBison', false)

  let badPB = 0
  const pb = (legal: string, dbas: string[], want: string | undefined) => {
    const got = productBrand(legal, dbas)
    const ok = got === want
    if (!ok) badPB++
    console.log(`${ok ? 'ok  ' : 'FAIL'} productBrand ${JSON.stringify(legal)} -> ${JSON.stringify(got)}${ok ? '' : ` want ${JSON.stringify(want)}`}`)
  }
  // The live record, verbatim. Before the guard this returned 'Membermark'.
  pb(MM, [
    'Member Mark', "Member's Mark / FullSan", "Member's Mark food service",
    "Member's Marks", 'Memberd Mark', 'Membermark',
    'Members Mark Sparkling Water', 'Members Mrk', 'Memebers Mark', 'Menmbers Mark',
  ], undefined)
  // Still finds a real brand.
  // SUB-BRANDS AND PRODUCT LINES, all real cases from the 2026-11-03 probe.
  pb('Hy-Vee', ['Hyvee', 'Hyvee Select'], undefined)
  pb('Del Monte', ['delmonte', 'Delmonte Quality'], undefined)
  pb('Larabar', ['Lara Bar', 'LARABAR KIDS'], undefined)
  pb('Bumble Bee', ['Bumblebee', 'Bumblebee Tiny Shrimp'], undefined)
  // The legal name is the LONGER one: a corporate suffix dropped.
  pb('Realgood Foods Co.', ['Real Good Foods'], undefined)
  // A short legal name must not swallow an unrelated candidate by
  // coincidental containment.
  // NOT on the curated list, so no brand - whatever its dbaNames say. This
  // case previously asserted the opposite: that an unrelated dbaName WAS the
  // brand. That expectation is the defect, so the test now asserts the fix.
  pb('Coop', ['Something Unrelated Entirely'], undefined)
  pb('Kroger', ['Car master'], undefined)
  pb('Publix', ['GreenJise'], undefined)
  pb('Walmart', ['Markerside'], undefined)
  // Multi-brand parents stay off the list on purpose.
  pb('Procter & Gamble', ['Pampers'], undefined)
  pb('Kimberly-Clark Worldwide, Inc.', ['Huggies'], undefined)
  // The curated entries, including the one Michael asked for.
  pb('CROPP Cooperative', [], 'Organic Valley')
  pb('cropp cooperative', ['anything'], 'Organic Valley')
  pb('Nurture LLC', [], 'Happy Baby')
  console.log(badBrand === 0 && badPB === 0
    ? 'productBrand: all cases pass'
    : `productBrand: ${badBrand + badPB} FAILURES`)
}

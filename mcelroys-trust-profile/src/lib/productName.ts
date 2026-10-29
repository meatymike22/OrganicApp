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

function significantWords(name: string): Set<string> {
  const out = new Set<string>()
  for (const w of name.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 2) continue
    if (CORPORATE_WORDS.has(w)) continue
    out.add(w)
  }
  return out
}

export function productBrand(legalName: string, dbaNames: string[]): string | undefined {
  const legal = significantWords(companyDisplayName(legalName))
  // Shortest first: given several distinct candidates, the shortest is the
  // most likely to be the plain brand rather than a divisional name.
  const candidates = [...dbaNames]
    .map((d) => companyDisplayName(d))
    .filter((d) => d.length > 0)
    .sort((a, b) => a.length - b.length)

  for (const cand of candidates) {
    const words = significantWords(cand)
    if (words.size === 0) continue
    let shares = false
    for (const w of words) {
      if (legal.has(w)) {
        shares = true
        break
      }
    }
    if (!shares) return cand
  }
  return undefined
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

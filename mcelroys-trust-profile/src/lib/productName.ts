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

export function productDisplayName(
  rawName: string,
  companyName: string | null | undefined,
  dbaNames: string[] = []
): string {
  const cleaned = displayName(rawName)
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
    if (rest.length >= 3 && /[a-z0-9]/i.test(rest)) return rest
    return cleaned
  }

  return cleaned
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

export function shortProductName(name: string): string {
  const full = name.trim()
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

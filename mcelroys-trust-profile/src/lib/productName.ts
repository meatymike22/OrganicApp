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

export function displayName(raw: string): string {
  const cleaned = raw
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

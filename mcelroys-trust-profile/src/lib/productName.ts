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

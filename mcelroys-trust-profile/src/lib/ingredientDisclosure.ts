// HOW COMPLETE IS THE INGREDIENT LIST WE HOLD?
//
// This file exists because the answer stopped being a yes/no on 2026-11-02,
// and because the states were previously compared as bare string literals in
// eight files. Item 20's bug class: a value matched in many places drifts,
// and adding a fourth state to eight scattered comparisons is exactly how a
// new state gets silently treated as an old one.
//
// THE FOURTH STATE, AND WHY IT HAD TO EXIST.
//
// 11,920 published products hold an ingredient list that stops mid-sentence.
// Open Food Facts truncates `ingredients_text` at 255 characters for these
// records — this was measured, not assumed: 39 of 40 sampled barcodes have
// text of exactly 255 characters in OFF's own export, against a control group
// of 40 that matched our stored length exactly. OUR IMPORT IS FAITHFUL. The
// data does not exist upstream to recover.
//
// The length distribution is the proof. Neighbouring lengths hold ~380
// products each; 255 holds 10,072. And 87.3% of the 255s end mid-word against
// an 18% baseline at other lengths. The 254 bulge (1,848 against ~400) is the
// same cut after trailing whitespace was trimmed.
//
// WHY THIS MATTERED MORE THAN IT LOOKED. The truncated lists parse to 12.7
// ingredients on average against 13.0 for untruncated text of similar length,
// so they look completely normal — Frito-Lay's "1 ingredient: corn" is the
// rare visible case. 11,197 of these products asserted `no hydrogenated
// ingredient`, 3,038 showed "None flagged", and 1,685 showed no allergens,
// all derived from a list that stops partway through.
//
// AND THE TRUNCATION IS BIASED AGAINST THE WORST THING TO LOSE: an allergen
// statement is the LAST line of an ingredient list, so a cut at a fixed
// character count destroys "CONTAINS: MILK, SOY" preferentially.
//
// This is the negation bug class — the backlog has five prior instances — at
// scale, on the one axis where being wrong reaches someone physically.

export const INGREDIENT_DISCLOSURE_STATUSES = [
  // We hold the list as printed.
  'disclosed',
  // We hold PART of the list. The source record is cut off, so we can report
  // what is in the part we have and must not report what is absent.
  'partial',
  // No list found in any source we check. Never "the product has no
  // ingredients" — the schema is explicit about that wording.
  'not_disclosed',
  // No lookup attempted. The UI must say nothing about disclosure.
  'unchecked',
] as const

export type IngredientDisclosureStatus = (typeof INGREDIENT_DISCLOSURE_STATUSES)[number]

/**
 * MAY WE MAKE A CLAIM ABOUT WHAT IS *ABSENT* FROM THIS PRODUCT?
 *
 * The one question that matters, and the reason this is a function rather
 * than `=== 'disclosed'` written out in eight places. Every "None flagged",
 * "no hydrogenated oil", "no seed oils", free-from filter and ingredient
 * count is a statement about absence, and absence cannot be read off a list
 * that stops partway through.
 *
 * Presence is different and still reportable: an ingredient we can SEE in the
 * part we hold is really in the product. "At least 3 flagged" is true of a
 * partial list; "None flagged" is not.
 */
export function canAssertAbsence(status: string | null | undefined): boolean {
  return status === 'disclosed'
}

/** Do we hold any of the list at all, complete or not? */
export function hasAnyIngredientList(status: string | null | undefined): boolean {
  return status === 'disclosed' || status === 'partial'
}

// THE DETECTOR.
//
// Length alone, deliberately. The statistical case is overwhelming — ~380
// products would land on each of these lengths naturally, against 10,072 and
// 1,848 observed — so roughly 780 complete lists get marked `partial` along
// with ~11,100 genuinely truncated ones, a false-positive rate near 6%.
//
// THAT ERROR IS THE SAFE ONE AND IT IS CHOSEN ON PURPOSE. Marking a complete
// list "we cannot be sure this is all of it" understates what we know.
// Marking a cut-off list `disclosed` publishes a false claim about absence.
// Those costs are not symmetrical, and this is the same reasoning that put
// `imageKind` null on the display side rather than the hide side.
//
// A tighter rule — length AND ends-mid-word — would reach ~98% precision but
// miss every list cut at a space or a comma, which are just as truncated.
// Precision is not the thing to optimise when the cost of a miss is a false
// negative about an allergen.
export const OFF_TRUNCATION_LENGTHS = [254, 255] as const

export function looksTruncatedAtSource(text: string | null | undefined): boolean {
  if (!text) return false
  return (OFF_TRUNCATION_LENGTHS as readonly number[]).includes(text.length)
}

// What the page says about a partial list. One wording, so the product page,
// the search row and the sources page cannot drift apart on a claim this
// sensitive.
export const PARTIAL_LIST_NOTE =
  'Open Food Facts records this ingredient list cut off at 255 characters, so the list below is incomplete. We show the part we hold and make no claim about what is missing.'

export const PARTIAL_LIST_SHORT = 'Ingredient list is cut off at the source'

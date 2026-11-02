// WHAT A PRODUCT PHOTOGRAPH ACTUALLY SHOWS.
//
// Michael, 2026-10-23: "some of the photos of our products simply have a
// nutrition label without a photo of the product. we would rather have no
// photo than a picture of the nutrition label."
//
// Open Food Facts photographs are contributed, and contributors photograph
// whatever answers their question — often the back of the pack. We hold
// 184,099 of them and have never known which is which, so a product page can
// show a nutrition panel where a reader expects the thing they are holding.
//
// THIS IS A DISPLAY DECISION, NOT A PUBLISHED CLAIM, and that is what makes
// it safe to decide with a model. Both failure modes are quality misses: a
// package shot wrongly hidden, or a label shot wrongly shown. Neither asserts
// anything false about the product. The same exception does NOT extend to
// reading a product's NAME off a photograph — a name is a claim, and round 28
// recorded that the human-review rule applies there. Do not borrow this
// exemption for that.
//
// A MODEL'S VERDICT IS A MATERIALISED COLUMN LIKE ANY OTHER: it needs the
// model identity and a timestamp stored beside it, re-judgement when the
// source image changes, and a hand-scored sample before it gates anything.
// Unlike every other materialised column on Product, it CANNOT be re-derived
// from the source tables — so the hand-scored sample is the only ground truth
// there will ever be. That is why the pilot exists.

export const IMAGE_KINDS = [
  // The product or its packaging AS A PHYSICAL OBJECT — front, back, side, or
  // the food itself out of its wrapper. The only kind worth showing as "this
  // is the product".
  //
  // "as you would see it on a shelf" used to be part of this definition and
  // was removed: it excluded a photograph of the actual food, unwrapped or
  // plated, which is if anything MORE use to a reader than a package shot.
  // The model applied that definition correctly and the definition was wrong.
  'package',
  // A nutrition facts table. Useful data, wrong picture.
  'nutrition_panel',
  // An ingredient list or allergen statement. Kept separate from
  // nutrition_panel because backlog item 2b wants to surface these
  // deliberately, in their own place, rather than as the product photo.
  'ingredients_panel',
  // Predominantly a barcode.
  'barcode',
  // A logo, a shelf, a person, a blank frame, a screenshot — anything that
  // identifies nothing.
  'other',
  // WE LOOKED AND COULD NOT: the image would not load, or the model declined
  // to classify it. The third state, kept distinct from "not yet judged"
  // (null) so a later pass can retry exactly these and not everything.
  'unreadable',
] as const

export type ImageKind = (typeof IMAGE_KINDS)[number]

// What may be shown as the product's photograph.
//
// NULL IS NOT IN THIS LIST AND MUST STILL DISPLAY. 184,099 photographs are
// unjudged today; treating unjudged as unusable would strip every photo off
// the site the moment this column lands. The display rule is therefore
// "hide only what we have judged and found wanting":
//
//   const show = imageKind === null || USABLE_IMAGE_KINDS.includes(imageKind)
//
// Same shape as the publication gate's default of 'published': a column that
// starts hiding rows the moment it exists cannot be reviewed.
export const USABLE_IMAGE_KINDS: readonly ImageKind[] = ['package']

export function imageIsShowable(kind: string | null | undefined): boolean {
  if (kind === null || kind === undefined) return true
  return (USABLE_IMAGE_KINDS as readonly string[]).includes(kind)
}

// THE PROMPT.
//
// Kept here rather than in the script because the prompt IS the measurement
// instrument: a hand-scored sample is only evidence for the exact wording it
// was scored against. Changing this text invalidates the scoring, so it lives
// beside the taxonomy where that is obvious, and any change means re-running
// the pilot.
//
// It asks for one word and nothing else. A model that explains itself costs
// output tokens on 184,099 calls and gives a string that has to be parsed
// loosely, which is how a wrong label becomes a silent default.
//
// REVISED 2026-10-29 after the 500-image pilot was hand-scored. Of 19
// non-package verdicts, 6 were wrong, and FIVE OF THOSE SIX WERE THIS
// PROMPT'S FAULT rather than the model's:
//
//   - Three photographs of the whole BACK of a package were called
//     nutrition_panel. The old prompt covered "front of package with a panel
//     partly visible" and "close-up of a panel with packaging at the edges" —
//     a full shot of the back is neither, so the model had to guess.
//   - Two photographs of the OPENED product were called other, because the
//     old definition said "as it would look on a shelf". The model obeyed
//     that clause; the clause should not have been there.
//   - One close-up of a brand name was called other, when packaging bearing
//     the product's own name is exactly what a shopper matches against.
//
// Only one was a real model error: a whole-product photograph called barcode.
//
// THE REWRITE IS BUILT ON ONE TEST — could you hand this photograph to a
// shopper and have them recognise what they are holding? — because that is
// what the photograph is FOR. Every label below is a consequence of that
// question rather than a separate judgement, which is what the first version
// lacked.
//
// IT ALSO ERRS TOWARD `package`, deliberately. A wrong `package` leaves a
// thin page up, which is the status quo. A wrong panel label removes a
// working photograph from a product page. Those costs are not symmetrical.
//
// A DEAD END, MEASURED AND REVERTED — DO NOT RETRY IT.
//
// One case survived the rewrite above: a photograph of 75% of the back of a
// soup-mix box, called nutrition_panel. The operative test was "only when
// that text FILLS THE FRAME", and on the back of a box the panel genuinely
// does. So the test was replaced with one the model can see rather than
// estimate — "if you can see the EDGES or OUTLINE of the package anywhere in
// the picture, answer package".
//
// It fixed that one case and broke three others. Of the four panel verdicts
// confirmed correct by hand, THREE flipped to package: Premier protein,
// Nutella and Stack'd. Non-package verdicts fell from 8 to 4 and the headline
// rate rose from 98.0% to 99.2% — while the error count TRIPLED.
//
//   round 2 (this prompt): 1 error in 500 — one back-of-box called a panel
//   round 3 (edges test):  3 errors in 500 — three real panels called package
//
// AND THE THREE ARE THE WORSE KIND. The reasoning for preferring `package`
// was that a wrong `package` only leaves a thin page up, which is the status
// quo. That is true of the publication GATE and false of the DISPLAY: a real
// nutrition panel labelled `package` is a nutrition panel shown as the
// product photograph, which is the complaint this whole column exists to fix
// ("we would rather have no photo than a picture of the nutrition label",
// 2026-10-23). Both directions cost something, so neither gets a blanket
// preference.
//
// THE STANDING LESSON: a rule tuned until the headline number improves can be
// losing on the measure that matters. The only reason this was caught is that
// four hand-confirmed verdicts were nominated as a control group BEFORE the
// change, with "if any of these move, revert" written down in advance.
//
// CHANGING THIS TEXT INVALIDATES ANY EXISTING HAND-SCORING. The sample is
// deterministic (ORDER BY md5), so re-running the same 500 after a change is
// a controlled comparison — do that rather than scoring a fresh draw. Name
// the control group first.
export const CLASSIFY_PROMPT = `You are shown one photograph taken from a grocery product database.

Decide whether it shows the PRODUCT AS AN OBJECT, or a CLOSE-UP OF LABEL TEXT.

Reply with EXACTLY ONE of these words and nothing else:

package - you can see the product, or its packaging, as a physical object. This includes:
  - the front of the package
  - the back or the side of the package, even though a nutrition or ingredients panel is printed on it
  - the food itself, unwrapped, plated or served
  - a close-up of part of the packaging showing the brand name or the product name
nutrition_panel - a close-up in which a nutrition facts table fills most of the frame
ingredients_panel - a close-up in which an ingredient list or allergen statement fills most of the frame
barcode - a close-up in which a barcode fills most of the frame
other - none of the above: a shelf, a sign, a person, a screenshot, or a blank or unreadable frame

The test is whether you could hand this photograph to a shopper and have them recognise what they are holding.

If you can see the product or its packaging as an object, answer package - even if a panel or a barcode is also visible somewhere in the frame.
Answer a panel type or barcode ONLY when that text fills the frame and the product is not otherwise visible.
If more than one kind of panel fills the frame, answer nutrition_panel.
Answer with one word from the list. Do not explain.`

// STRICT PARSING. An answer that is not exactly one of the labels is a parse
// failure, recorded as such — never coerced to the nearest label and never
// defaulted to 'other'. A default here would be indistinguishable from a real
// judgement in the stored column, and 'other' is the value that hides a photo.
export function parseKind(reply: string): ImageKind | null {
  const word = reply.trim().toLowerCase().replace(/[^a-z_]/g, '')
  const known = (IMAGE_KINDS as readonly string[]).filter((k) => k !== 'unreadable')
  return known.includes(word) ? (word as ImageKind) : null
}

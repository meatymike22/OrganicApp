// The Rootify visual system, in one place.
//
// WHY THIS IS A TS FILE AND NOT TAILWIND CLASSES
// The existing pages in this app style with inline `style={{ ... }}` objects.
// Keeping to that means every colour in the UI comes from this file, so a
// shade can never drift between two pages, and there is no second place
// (a Tailwind config) where the same value is written slightly differently.
//
// THE ONE RULE THAT MATTERS
// Colour never means "good" or "bad", and there is NO RED and no traffic
// light anywhere in this palette. That is not a styling preference: Rootify
// publishes records, not verdicts, and a red badge is a verdict. Grey is not
// a mark against a product; it means we looked and there was nothing on file.
//
// Which AISLE a product is in still has no colour of its own — it is carried
// by a glyph and a plain label. See CategoryGlyph.tsx.
//
// THIS RULE WAS AMENDED 2026-10-13, and the amendment is written here rather
// than worked around quietly. It used to read "colour means STATUS", full
// stop. It now has a second, deliberately narrow job: the `additive` scale
// below names which CLASS OF ADDITIVE an ingredient is, on the ingredient
// list of a product page. Michael asked for it twice in one round — "we
// should categorize ingredients based on color", "preservatives and
// emulsifiers should get their own text highlight color" — and chose, from
// three options, a hue per class with NO ordering between them rather than a
// concern ramp.
//
// What keeps that inside the rule rather than outside it:
//   - "This is a dye" is a fact read off the label. The hues are unordered,
//     so no family reads as worse than another, and none of them is red or
//     green.
//   - The two scales never meet on one element. `status` is chips, rules and
//     tiles; `additive` appears only on an ingredient row's left rule and in
//     the legend directly above that list.
//   - Amber (openResearch) stays out of the additive scale entirely, because
//     it already means "there is research to read" on these same rows.
// If a later round wants to order these hues by concern, that is the scoring
// system this project refuses to build, and it needs a different argument
// than this comment.

export const colors = {
  // Surfaces and text
  paper: '#FAF8F3', // page background
  card: '#FFFFFF',
  panel: '#F0ECE1', // quieter panel inside the page
  aisleBar: '#F1ECE0',
  line: '#E6E1D6', // hairline borders
  lineStrong: '#E2DCCC',
  dark: '#222d27', // the nav / brand bar
  ink: '#16201B', // primary text
  ink2: '#4F5A52', // secondary text
  ink3: '#656F67', // tertiary text
  ink4: '#8A9089', // faintest text, column headers
  link: '#B0502F', // links and primary buttons
  linkHover: '#8E3E22',
} as const

// The five status colours, plus ownership (deliberately outside the scale)
// and "not applicable" (deliberately not a status at all).
//
// Each entry is a text colour and the tint it sits on. They are paired: never
// use a `fg` on a background other than its own `bg`, or the contrast is no
// longer the one that was checked.
export const status = {
  // Checked, and the record confirms it.
  confirmed: { fg: '#1D4D3C', bg: '#E2EDE7', border: '#C3D8CB' },
  // Checked, and there is nothing on file. NOT a mark against the product.
  //
  // This has to be a TRUE NEUTRAL grey — equal red, green and blue. It used
  // to be #656F67, which has more green in it than red or blue, and as a
  // solid swatch in the legend it read as a second, paler version of the
  // confirmed green. A grey that leans green says "sort of confirmed", which
  // is not what "nothing on file" means.
  nothingOnFile: { fg: '#6A6A6A', bg: '#F4F2EC', border: '#E6E1D6' },
  // Research is still open, or studies disagree. Worth reading about.
  openResearch: { fg: '#8A5A0B', bg: '#F6EBD6', border: '#EBDBBE' },
  // A recall is on the public record.
  recall: { fg: '#B0502F', bg: '#FBF2ED', border: '#EFD9CE' },
  // We could not check, or the manufacturer does not publish it.
  unchecked: { fg: '#2B4C7E', bg: '#E3E9F2', border: '#B9C7DC' },
  // Who owns a brand is a fact, not a verdict, so it sits off the scale.
  ownership: { fg: '#6B3F6E', bg: '#EFE5F0', border: '#DED0E0' },
  // The question cannot apply to this kind of product (organic on a baby
  // bottle). Deliberately NOT the same grey as nothingOnFile: grey means
  // "we checked and found nothing", which is a different and wrong
  // statement. It is a warm stone instead — no green in it either, for the
  // same reason as above — and it is set lighter and unbolded in the chip,
  // so it reads as the quietest mark in the set. The label does the real
  // work: "Doesn't apply" cannot be mistaken for "Not on file".
  notApplicable: { fg: '#7A776F', bg: '#F1EEE6', border: '#E6E1D6' },
} as const

export type StatusKey = keyof typeof status

// WHICH CLASS OF ADDITIVE AN INGREDIENT IS. Read the amended rule at the top
// of this file before adding to this.
//
// UNORDERED BY CONSTRUCTION. There is no red and no green in here, so the
// set cannot be read as a ramp from bad to good: red would mark a verdict,
// and green would mark the uncoloured rows as the bad ones by contrast.
// Amber is absent because it means "research to read" on these same rows.
// `fg` is the row's left rule and the legend's text; `bg` is the legend
// swatch, and the pairing is what was contrast-checked.
//
// `label` is the legend wording and it is a description, never a warning.
// "Colour added" says what the ingredient does. "Artificial colour" would
// smuggle in a judgement about artificial things that the record does not
// make.
// EIGHT FAMILIES, AND COLOUR IS NO LONGER THE ONLY THING THAT CARRIES THEM.
//
// Round 18 shipped six, round 19 split preservative from emulsifier and
// flavour from fragrance, round 21 added hydrogenated fat to the oil family.
// Then Michael, 2026-10-13: "colors are too close together and its hard to
// see the colors when the text is highlighted. we have to take colorblind
// people into consideration here."
//
// HE WAS RIGHT, AND IT WAS WORSE THAN THAT. Measured with CIEDE2000 on the
// Machado 2009 colour-vision-deficiency simulations, the palette he was
// looking at scored:
//
//     normal vision      deltaE  4.7   dye vs fragrance
//     deuteranopia       deltaE  3.6   flavour vs oil
//     protanopia         deltaE  1.4   flavour vs preservative
//     tritanopia         deltaE  4.0   sweetener vs oil
//
// A deltaE of 1.4 is not "close", it is the same colour. And the 4.7 was for
// NORMAL vision, which makes it a plain bug rather than an accessibility
// gap. The rule of thumb for marks this small is deltaE 15 to 20.
//
// THE THING THAT CAME OUT OF MEASURING IT: eight categorical hues cannot be
// made colour-blind-safe inside this file’s own no-red, no-green, no-amber
// rule. A search over every in-gamut colour that rule permits tops out at
// about deltaE 11 for eight, and only reaches 16 for six by using hues that
// break the rule (it wanted a green and a brown-red). Protanopia and
// deuteranopia collapse the red-green axis, and banning amber removes the
// yellow end, so what is left is one blue-violet arc, one teal arc, and
// lightness. That is four or five colours, not eight.
//
// SO COLOUR STOPPED BEING THE ONLY CHANNEL. Every classified row now carries
// a two-letter code as well — `code` below, rendered by AdditiveMark.tsx.
// The code is the first two letters of the family’s own legend word, which is
// what makes it learnable from the legend sitting directly above the list.
// It reads in greyscale, it reads under every kind of colour blindness, and
// it survives the thing he reported second: a text selection over a coloured
// word hides the colour, and it cannot hide a letter.
//
// The hues below are now a SECONDARY cue — fast grouping when you scan a
// list, not the thing that tells you which family a row is in. They were
// re-tuned anyway, within 8 degrees of where each family already sat, so
// dye is still magenta, flavour violet, preservative indigo, oil blue,
// sweetener teal, emulsifier brown. The lever was LIGHTNESS, which is the
// one channel every kind of colour blindness leaves intact: the ladder now
// runs L 24, 24, 28, 36, 42, 46 where it used to sit between 34 and 45.
//
//     worst co-occurring pair, all four vision types:  1.4  ->  9.3
//
// 9.3 is still under the 15 a colour-only mark would need. That is the point
// of the letters, and it is why this comment does not claim the palette was
// fixed.
//
// WHY "CO-OCCURRING" IS THE RIGHT MEASURE, and this is the part worth
// keeping: a hue only has to be told apart from the hues ON THE SAME PAGE.
// Counted over the 179,391 products that carry any classified ingredient:
//
//     families on one product’s list:   1: 66,609   2: 54,225   3: 35,901
//                                     4: 16,960   5:  5,280   6:    416
//
// Never seven, never eight, and four or fewer on 96.8% of products. Better:
// every pair involving `fragrance` or `other` co-occurs on at most 37
// products, and flavour and fragrance NEVER co-occur — zero products hold
// both, because an undisclosed fragrance only appears on things that are not
// eaten. So fragrance takes flavour’s hue outright, below, and the two codes
// Fl and Fr are what separate them. There is no page where that is ambiguous.
//
// HUE ORDER IS STILL NOT LEGEND ORDER, on purpose: a spectrum printed in
// spectrum order reads as a ramp from mild to severe, which is the scoring
// system this project refuses to build.
//
// `bg` WAS REMOVED in this pass. It held a pale tint per family and was read
// by nothing — every call site used `fg`. A documented "never use a fg on
// a background other than its own bg" pairing that no code honours is worse
// than no pairing, because the next person to add a tint will trust it.
const FLAVOUR_HUE = '#462A6E'

export const additive = {
  dye: { label: 'Colour added', code: 'Co', fg: '#88517B' },
  flavour: { label: 'Flavour added', code: 'Fl', fg: FLAVOUR_HUE },
  // SAME HUE AS FLAVOUR, DELIBERATELY. Zero products in the database carry
  // both an undisclosed flavouring and an undisclosed fragrance, so no
  // legend ever prints these two swatches together. Written as a shared
  // constant rather than a repeated literal so the two cannot drift apart
  // and quietly become a confusable pair.
  fragrance: { label: 'Fragrance added', code: 'Fr', fg: FLAVOUR_HUE },
  sweetener: { label: 'Sweetener added', code: 'Sw', fg: '#004A4F' },
  preservative: { label: 'Preservative', code: 'Pr', fg: '#144CBD' },
  emulsifier: { label: 'Emulsifier', code: 'Em', fg: '#56300C' },
  // RELABELLED 2026-10-13 from "Seed oil". The family holds two stored
  // categories, `seed oil` and `hydrogenated fat`, and "Seed oil" would be a
  // false label on hydrogenated palm, which is not pressed from a seed.
  oil: { label: 'Oil or fat added', code: 'Oi', fg: '#2E72A1' },
  // Categories too rare to earn a hue, and any category a later
  // classification pass invents. Deliberately NOT the same grey as
  // status.nothingOnFile: this one means "an additive we have classified",
  // which is the opposite of nothing on file. Code is Ad, not Ot, because
  // the reader is being told what the row IS, not which bucket it fell in.
  other: { label: 'Other additive', code: 'Ad', fg: '#5A5F62' },
} as const

export type AdditiveKey = keyof typeof additive

// The three thumbnail tints. Category gets no status colour, but a food
// product and a dish brush should not look identical at a glance.
export const thumbTint = {
  ambient: '#F3EEE3', // shelf-stable food
  chilled: '#EDF1F1', // chilled and frozen
  nonFood: '#F1EEF3', // everything that isn't eaten
} as const

// Type stacks. The CSS variables are set on <html> in app/layout.tsx by
// next/font, so these strings work anywhere in the app.
export const font = {
  display: "var(--font-display), Georgia, 'Times New Roman', serif",
  sans: "var(--font-sans), system-ui, -apple-system, sans-serif",
  mono: "var(--font-mono), ui-monospace, 'Courier New', monospace",
} as const

// Page furniture used by more than one screen.
export const layout = {
  pageWidth: 1280,
  gutter: 40,
  radius: 9,
} as const

// A date, written the one way the whole app writes dates: ISO, so there is
// no ambiguity about whether 03/04 is March or April, and so a reader can
// see at a glance how old a record is.
//
// Every fact Rootify shows carries the date it was read. This is the function
// that prints it, so that rule is enforced in one place.
export function isoDate(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

// Just the year, for a chip too narrow to carry a full date ("Recalled 2021").
export function isoYear(d: Date | string | null | undefined): string | null {
  return isoDate(d)?.slice(0, 4) ?? null
}

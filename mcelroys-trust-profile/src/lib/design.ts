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
export const additive = {
  dye: { label: 'Colour added', fg: '#A0357A', bg: '#F6E8F1' },
  flavour: { label: 'Flavour or fragrance added', fg: '#6B3FA0', bg: '#EFE8F7' },
  sweetener: { label: 'Sweetener added', fg: '#0F6E7A', bg: '#E2EFF1' },
  // One hue for the pair, at Michael's wording: "preservatives and
  // emulsifiers ... are add ons". The exact category is still on the row's
  // tooltip.
  shelfLife: { label: 'Preservative or emulsifier', fg: '#6B4A2A', bg: '#F2EAE1' },
  oil: { label: 'Seed oil', fg: '#2F5EA8', bg: '#E4EAF4' },
  // Categories too rare to earn a hue, and any category a later
  // classification pass invents. Deliberately NOT the same grey as
  // status.nothingOnFile: this one means "an additive we have classified",
  // which is the opposite of nothing on file.
  other: { label: 'Other additive', fg: '#5A5F62', bg: '#ECEDEE' },
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

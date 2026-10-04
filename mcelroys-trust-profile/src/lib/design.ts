// The Rootify visual system, in one place.
//
// WHY THIS IS A TS FILE AND NOT TAILWIND CLASSES
// The existing pages in this app style with inline `style={{ ... }}` objects.
// Keeping to that means every colour in the UI comes from this file, so a
// shade can never drift between two pages, and there is no second place
// (a Tailwind config) where the same value is written slightly differently.
//
// THE ONE RULE THAT MATTERS
// Colour means STATUS — what the public record says. It never means "good"
// or "bad", and there is NO RED anywhere in this palette. That is not a
// styling preference: Rootify publishes records, not verdicts, and a red
// badge is a verdict. Grey is not a mark against a product; it means we
// looked and there was nothing on file.
//
// Category (which aisle a product is in) has no colour of its own — it is
// carried by a glyph and a plain label. See CategoryGlyph.tsx.

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

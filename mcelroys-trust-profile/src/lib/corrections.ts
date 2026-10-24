// THE CORRECTIONS LOG — the data behind /corrections.
//
// WHY THIS IS A FILE AND NOT A DATABASE TABLE.
// Three reasons, in order of how much they matter:
//
//   1. GIT IS THE AUDIT TRAIL. A corrections log that can be silently
//      rewritten is worth very little — the whole value of the page is that
//      the old wording is still visible after we changed it. In a file,
//      every entry and every edit to an entry is attributable and dated in
//      version control for free. In a table, a correction can be quietly
//      updated by whoever holds the credentials, which is the exact
//      behaviour this page exists to rule out.
//   2. HOUSE PRECEDENT. `src/lib/authorities.ts` holds the canonical
//      authority list "so a wording correction never requires a re-ingest",
//      and `src/lib/additives.ts` holds the e-number table for the same
//      reason. Editorial reference data lives in the repository here.
//   3. VOLUME. Each entry is hand-written prose about one incident. At this
//      rate a table buys a migration and an admin screen and saves nothing.
//
// Revisit if this ever passes a few hundred entries, or if someone other
// than Michael needs to add one without a deploy.
//
// WHAT COUNTS AS A CORRECTION — the rule the page states publicly, kept
// here so the two cannot drift:
//
//   LOGGED: anything that changed a FACT about a named company or product.
//   A wrong company, a wrong ingredient list, a recall attached to the wrong
//   maker, a misread register entry, a date, a number.
//
//   NOT LOGGED: typos, wording, layout, a tooltip reworded for clarity, a
//   section moved. Those change how a fact reads, not what it says.
//
// The line matters in both directions. Log too little and the page is a
// fiction; log every tooltip edit and the real corrections are buried, which
// is the same failure wearing a different hat.
//
// ADDING ONE:
//   - `said` is not optional. An entry without the old wording is a
//     changelog line, not a correction.
//   - `correctedOn` is the day the page changed, not the day it was
//     reported. The gap between those is not something to hide, but this
//     field is about when the public record became right.
//   - `id` is a stable slug and becomes the anchor (/corrections#<id>), so
//     it can be linked from the page that was corrected. Never reuse or
//     renumber one.

export type Correction = {
  /** Stable slug; becomes the #anchor. Never reuse or renumber. */
  id: string
  /** ISO date the public page was corrected. */
  correctedOn: string
  /** Human description of what was affected, e.g. "Clover Sonoma — company record". */
  where: string
  /** Path to the affected page, when it is a single page. */
  href?: string
  /** What the page said before. REQUIRED — this is what makes it a correction. */
  said: string
  /** What it says now. */
  saysNow: string
  /** Where the error came from. Our reading, a source's own error, a stale cache. */
  why: string
  /** Who found it. 'us' means we found it ourselves. */
  reportedBy: 'the company' | 'a reader' | 'us'
}

// Empty is the correct state today, and the page says so explicitly rather
// than rendering a bare heading. The site has been public since 2026-10-11;
// nothing has been reported and nothing has been found. The page must not
// let a reader infer "never been wrong" from "nothing listed" — that is the
// same three-state discipline the rest of the site runs on, applied to
// ourselves: confirmed, nothing on file, or not checked.
export const CORRECTIONS: Correction[] = []

/** Newest first. Entries may be added in any order. */
export function correctionsNewestFirst(): Correction[] {
  return [...CORRECTIONS].sort((a, b) => b.correctedOn.localeCompare(a.correctedOn))
}

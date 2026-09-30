// Shared rules for matching a product's free-text brand to a Company.
// Used by discover-products.ts and bulk-import-off.ts.

// Loose comparison form: uppercase, no leading "THE", no corporate
// suffixes, and then NOTHING but letters and digits. "The Honest Company,
// Inc." and "HONEST COMPANY" both become "HONEST"; "H-E-B", "H.E.B",
// "H E B" and "H•E•B" all become "HEB".
//
// Squashing spaces and punctuation was added after the 2026-09-28 data
// review found 2,260 groups of companies that differed only in spacing or
// punctuation (Trader Joe's had 6 spellings, one with a curly apostrophe;
// Shoprite / Shop Rite; Good & Gather had 7). Accented and non-Latin letters
// are KEPT, so "Pom" and "Pomì" (different brands) stay apart.
//
// The same rules exist in SQL as review_backup.brand_key(), which was used
// for the one-time merge — keep the two in step.
export function normalizeBrandName(name: string): string {
  const key = squashBrand(name)
  // Very short keys are mostly initials, where "&" matters: "S&W" (canned
  // vegetables) and "SW", "A&B" and "AB", "M&S" and "Ms" are different
  // brands. For those, only spacing, dots, dashes and similar are ignored.
  if (key.length <= 3) {
    return name.toUpperCase().replace(/[\s.\-\u2011\u2022/\\'\u2019\u2018`\u00b4\u2122\u00ae\u00a9]/g, '')
  }
  return key
}

function squashBrand(name: string): string {
  return name
    .toUpperCase()
    // Parenthetical notes: "Lindt & Sprungli (Schweiz) AG"
    .replace(/\([^)]*\)/g, ' ')
    // Straight and curly apostrophes, backticks, dots, commas — removed
    // BEFORE the suffix check so "U.S.A." is recognised as USA.
    .replace(/[.,'’‘`´]/g, '')
    .replace(/^\s*THE\s+/, '')
    // Corporate suffixes, US and international, plus country tags that
    // brand owners append ("Ferrero U.S.A. Incorporated" → "FERRERO").
    // Only AFTER the first word — "US Foods" and "AG Organics" keep their names.
    .replace(/(?<=\S)\s+(LLC|LLP|LP|INC|INCORPORATED|CO|CORP|CORPORATION|LTD|LIMITED|COMPANY|PBC|PLC|GMBH|AG|SA|SAS|SPA|SRL|BV|NV|USA|US)\b/g, '')
    // Everything that isn't a letter or digit, in any script.
    .replace(/[^\p{L}\p{N}]/gu, '')
}

// Brand strings known to belong to a DIFFERENT business than the company
// they appear to match. Brand names genuinely collide across unrelated
// businesses and no automated signal reliably separates them, so these are
// recorded as they're discovered — same reactive approach as the ingredient
// classification rules. Keyed by Company.legalName.
export const BRAND_EXCLUSIONS: Record<string, string[]> = {
  // "Boon" is also a Dutch canned-bean brand — searching it returns
  // Kikkererwten, Zwarte Boon, kidneyboon etc., none of which are TOMY's
  // baby-bottle products.
  'TOMY International, Inc.': ['Boon'],
  // "Honest" also matches Coca-Cola's Honest Kids / Honest Tea line, which
  // has no connection to The Honest Company. Note this one shares a country
  // and a plausible name, so no automated check catches it.
  'The Honest Company, Inc.': ['Honest'],
  // "Dr. Brown's" is also a line of sodas (celery soda, cream soda) with no
  // connection to Handi-Craft's Dr. Brown's baby bottles. Found by the first
  // bulk-import dry run: 9 sodas would have been filed under the bottle maker.
  'Handi-Craft Company': ["Dr. Brown's"],
}

export function isExcludedBrand(companyLegalName: string, brand: string): boolean {
  const excluded = BRAND_EXCLUSIONS[companyLegalName] ?? []
  const b = normalizeBrandName(brand)
  return excluded.some((e) => normalizeBrandName(e) === b)
}

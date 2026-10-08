// Turns the database rows for one product into the five things a shopper is
// shown about it, in a fixed order, every time:
//
//   Flagged · Recalls · Organic · Non-GMO · Owner
//
// Both the search results page and the product page use this, which is the
// point: the same product can never be described two different ways on two
// different screens.
//
// EVERY FUNCTION HERE OBEYS THE THREE-STATE RULE
// For each question there are three possible answers, and they are NOT the
// same answer:
//   confirmed      — we looked, and the record says yes
//   nothingOnFile  — we looked, and there is nothing on file
//   unchecked      — we have not been able to look
// Collapsing the third into the second is the most tempting mistake in this
// whole app and the one that would turn a gap in our data into a false claim
// about somebody's product.
//
// ONE REFINEMENT, 2026-10-07. Michael: "if the product isn't in a public
// database, it is NOT certified organic or non gmo. So instead of 'not on
// file' let's simply say 'no'."
//
// He is right, and the reason is worth writing down because it looks like it
// breaks the rule above and does not. Certification is not a property of food
// that a register happens to record — it is a thing that EXISTS ONLY BY BEING
// IN THE REGISTER. There is no such thing as a USDA-certified organic product
// that is absent from the USDA register, and none of the words "certified" or
// "verified" can be true of a product no programme has certified or verified.
// So for these two questions, absence from a complete register IS the answer,
// and "Not on file" was hedging about something we actually know.
//
// What does NOT change:
//   - `unchecked` still says "Not checked". Michael's sentence begins "if the
//     product isn't in a public database", which presupposes we looked. Where
//     we could not look, we have no answer and must not print one.
//   - The negative is about the CERTIFICATE, never about the food. "Not
//     certified" is a fact; "not organic" is a claim about how something was
//     grown, which no register can tell us and we never make.

import type { StatusKey } from '@/lib/design'
import { isoDate, isoYear } from '@/lib/design'
import { RELEVANT_DOMAINS_BY_TYPE, type ProductType } from '@/lib/productTypes'
import type { RecallItem } from '@/lib/recalls'
import { companyDisplayName } from '@/lib/productName'

// One cell in the five-column strip.
export type Signal = {
  // Which of the five questions this answers.
  column: 'flagged' | 'recalls' | 'organic' | 'nonGmo' | 'owner'
  // Which status colour it takes. Drives the chip, nothing else.
  state: StatusKey
  // The short label that goes in the chip (fits ~13 characters).
  label: string
  // A longer, plain-English version. This is the glossary text: it lives on
  // /sourcing now rather than on the product page, because six of these in a
  // column is a wall. Michael, 2026-10-07: "this is too much. the
  // description text here can go into a document that includes a glossary of
  // terms... this description causes too much clutter."
  detail?: string
  // The one-line version the signal table prints. Where this is absent the
  // table falls back to `detail`, so a signal whose detail is already short
  // needs nothing extra.
  short?: string
  // The date the underlying record was read, when there is one.
  asOf?: string | null
  // Where to click through to.
  href?: string
}

// The shape this module needs from Prisma. Written as a structural type rather
// than a Prisma payload type so a page can pass any query that happens to
// select these fields, without having to match an exact `include` block.
export type ProductForSignals = {
  id: string
  productType: string
  ingredientDisclosureStatus: string
  ingredientCheckedAt: Date | null
  productIngredients: { ingredient: { flaggedForResearch: boolean } }[]
  certifications: {
    certificationStatus: string
    lastVerifiedDate: Date | null
  }[]
  productCertifications: {
    scheme: string
    status: string
    lastVerifiedDate: Date | null
  }[]
  company: {
    id: string
    legalName: string
    vettingStatus: string
    parentCompany: { id: string; legalName: string } | null
  }
}

// Whether a question can even be asked of this kind of product. The repo
// already answers this in productTypes.ts — a baby bottle
// ("baby_child") has no `organicCertification` domain — so we use that
// rather than inventing a second list that could disagree with it.
function domainApplies(productType: string, domain: string): boolean {
  const domains = RELEVANT_DOMAINS_BY_TYPE[productType as ProductType]
  // An unknown productType is a data problem, not a licence to guess. Treat
  // the question as askable and let the status come out as "unchecked".
  return domains ? domains.includes(domain) : true
}

// A name-matched source (USDA organic, the Non-GMO Project, recalls) is only
// run against companies a person or a barcode has confirmed — see
// src/lib/vetting.ts. So for an unvetted company, the absence of a record
// means NOBODY LOOKED, not that there is nothing there. This is the single
// most important line in this file.
function wasCheckable(company: ProductForSignals['company']): boolean {
  return company.vettingStatus === 'vetted'
}

// ---------------------------------------------------------------- flagged

export function flaggedSignal(p: ProductForSignals): Signal {
  const asOf = isoDate(p.ingredientCheckedAt)

  // "unchecked" is the column default in the schema and means no lookup has
  // been attempted. The schema comment is explicit that the UI must say
  // NOTHING about disclosure in this case.
  if (p.ingredientDisclosureStatus === 'unchecked') {
    return {
      column: 'flagged',
      state: 'unchecked',
      label: 'Not checked',
      detail: 'We have not looked up an ingredient list for this product yet.',
      asOf: null,
    }
  }

  if (p.ingredientDisclosureStatus === 'not_disclosed') {
    return {
      column: 'flagged',
      state: 'unchecked',
      label: 'Not disclosed',
      // Worded as the schema asks: "not found in the sources we check",
      // never "does not exist anywhere".
      detail: `No ingredient list was found in any source we check${asOf ? `, as of ${asOf}` : ''}.`,
      asOf,
    }
  }

  const flagged = p.productIngredients.filter((pi) => pi.ingredient.flaggedForResearch).length

  if (flagged === 0) {
    return {
      column: 'flagged',
      state: 'confirmed',
      label: 'None flagged',
      detail: 'No ingredient on this product currently has open or conflicting research on file.',
      short: 'Nothing on the label is an additive we track',
      asOf,
    }
  }

  return {
    column: 'flagged',
    state: 'openResearch',
    label: `${flagged} flagged`,
    // WORDING. This used to read "N ingredients have conflicting health
    // research on file", which is false for almost every product that shows
    // it: 6,250 ingredients carry the flag and 16 have a study on file. The
    // same sentence was fixed in the product page's own section on 2026-10-07
    // and survived here, where the hero table prints it.
    //
    // This signal cannot say how much we hold without a per-ingredient study
    // and classification count, which the search page would have to pay for
    // on every row. So it says what the flag IS — a classification, not a
    // finding — and the product page's section, which does have the counts,
    // gives the breakdown.
    detail:
      flagged === 1
        ? 'One ingredient is flagged as worth researching: an additive or processing ingredient rather than a whole food. What we hold on it — studies, authority classifications, or nothing yet — is on the product page.'
        : `${flagged} ingredients are flagged as worth researching: additives or processing ingredients rather than whole foods. What we hold on each — studies, authority classifications, or nothing yet — is on the product page.`,
    short: 'Additives and processing ingredients, not whole foods',
    asOf,
    href: `/products/${p.id}#flagged`,
  }
}

// ---------------------------------------------------------------- recalls

// `listed` is what getRecallsListingProducts() returned for this product:
// notices whose own text lists this product's barcode. Nothing weaker counts
// as a recall OF this product — a brand-level notice is a recall of the
// brand, and it is shown separately on the product page.
export function recallSignal(p: ProductForSignals, listed: RecallItem[] | undefined): Signal {
  if (listed && listed.length > 0) {
    const newest = listed[0]
    const year = isoYear(newest.actionDate)
    return {
      column: 'recalls',
      state: 'recall',
      label: year ? `Recalled ${year}` : 'Recalled',
      detail:
        listed.length === 1
          ? `A ${newest.sourceAgency} notice lists this product's barcode.`
          : `${listed.length} ${newest.sourceAgency} and other notices list this product's barcode.`,
      asOf: isoDate(newest.actionDate),
      href: `/products/${p.id}#recalls`,
    }
  }

  if (!wasCheckable(p.company)) {
    return {
      column: 'recalls',
      state: 'unchecked',
      label: 'Not checked',
      detail:
        'Recall notices are matched by company name, and this brand has not been confirmed as a company yet, so no notices have been matched to it.',
      short: 'We have not been able to match notices to this brand',
      asOf: null,
    }
  }

  return {
    column: 'recalls',
    state: 'confirmed',
    label: 'No recalls',
    detail: 'No government notice we hold lists this product.',
    asOf: null,
  }
}

// ----------------------------------------------------- organic / non-GMO

// USDA organic has its own table because its scope semantics are unique;
// every other mark (Non-GMO Project and so on) is a ProductCertification.
// See the comments on both models in schema.prisma.
export function organicSignal(p: ProductForSignals): Signal {
  if (!domainApplies(p.productType, 'organicCertification')) {
    return {
      column: 'organic',
      state: 'notApplicable',
      label: "Doesn't apply",
      detail: 'Organic certification does not apply to this kind of product.',
      asOf: null,
    }
  }

  const current = p.certifications.find((c) => c.certificationStatus === 'Certified')
  if (current) {
    return {
      column: 'organic',
      state: 'confirmed',
      // NOT "Organic". The USDA Organic Integrity Database is a register of
      // certified OPERATIONS, not of retail products, and this row was
      // created by matching the product's COMPANY to an operation in that
      // register. Calling the product organic on that basis produced at
      // least two false statements in the live data — Campbell Soup Supply
      // Co.'s "Chicken Broth Low Sodium" and Kellanova's "Twisted Fruit
      // Bites" both wore a green "Organic" chip purely because their makers
      // hold handler certificates.
      //
      // "Maker certified" is the most this record supports. Decided
      // 2026-10-06; the alternative was to drop the row to "Not on file"
      // entirely, which is stricter but empties the column the organic MVP
      // was built around. A product-level source (the Non-GMO Project sheet
      // is per-barcode) is the real answer and is still to come.
      label: 'Maker certified',
      short: 'The maker holds a certificate; the register does not certify products',
      // WHAT THIS ROW ACTUALLY IS, and why the wording is careful.
      //
      // The USDA Organic Integrity Database is a register of certified
      // OPERATIONS, not of retail products. A row here was created by
      // matching this product's company to an operation in the register, and
      // the certificate is then attached to every product that company has
      // in our database.
      //
      // So this cannot say "this product is certified organic". It said
      // exactly that until 2026-10-04, and in the live data that produced at
      // least two false statements: Campbell Soup Supply Co.'s "Chicken
      // Broth Low Sodium" and Kellanova's "Twisted Fruit Bites" both carry a
      // green "Organic" chip purely because their makers hold handler
      // certificates. Neither product is organic.
      //
      // The label itself ("Organic", green) is still overstating this and is
      // waiting on a decision — see the note in the review log. Until then
      // the detail text at least tells the truth about what the record is.
      detail:
        'The USDA Organic Integrity Database lists this product\'s company as a certified organic operation. The register certifies operations, not individual products, so this is not confirmation that this item is organic.',
      asOf: isoDate(current.lastVerifiedDate),
    }
  }

  // A surrendered, revoked or suspended certificate is a real finding and
  // must not be flattened into "nothing on file".
  const lapsed = p.certifications[0]
  if (lapsed) {
    return {
      column: 'organic',
      state: 'nothingOnFile',
      label: 'Not current',
      detail: `The USDA record for this product shows a certificate marked "${lapsed.certificationStatus}".`,
      short: `Certificate marked "${lapsed.certificationStatus}"`,
      asOf: isoDate(lapsed.lastVerifiedDate),
    }
  }

  if (!wasCheckable(p.company)) {
    return {
      column: 'organic',
      state: 'unchecked',
      label: 'Not checked',
      detail: 'The organic register is searched by company name, and this brand has not been confirmed as a company yet, so we have not been able to look. This is the one case where we cannot answer the question.',
      short: 'We have not been able to search the register',
      asOf: null,
    }
  }

  return {
    column: 'organic',
    state: 'nothingOnFile',
    // "Not certified", not "Not on file" and not "No". See the note at the top
    // of this file: certification exists only by being in the register, so
    // absence from it settles the question of certification. It settles
    // nothing about the food, which is why the word is "certified".
    label: 'Not certified',
    detail: 'This product is not in the USDA Organic Integrity Database, and US organic certification exists only by being in that register — so it is not certified organic. That is a fact about the certificate, not about how the food was grown.',
    short: 'Not in the USDA organic register',
    asOf: null,
  }
}

export function nonGmoSignal(p: ProductForSignals): Signal {
  const match = /non-?gmo/i
  const rows = p.productCertifications.filter((c) => match.test(c.scheme))

  const verified = rows.find((c) => c.status === 'verified')
  if (verified) {
    return {
      column: 'nonGmo',
      state: 'confirmed',
      label: 'Non-GMO',
      detail: `Verified under "${verified.scheme}".`,
      short: `Verified under "${verified.scheme}"`,
      asOf: isoDate(verified.lastVerifiedDate),
    }
  }

  const lapsed = rows[0]
  if (lapsed) {
    return {
      column: 'nonGmo',
      state: 'nothingOnFile',
      label: 'Not current',
      detail: `The record for "${lapsed.scheme}" is marked "${lapsed.status}".`,
      short: `"${lapsed.scheme}" is marked "${lapsed.status}"`,
      asOf: isoDate(lapsed.lastVerifiedDate),
    }
  }

  if (!wasCheckable(p.company)) {
    return {
      column: 'nonGmo',
      state: 'unchecked',
      label: 'Not checked',
      detail: 'Verification registers are searched by company name, and this brand has not been confirmed as a company yet, so we have not been able to look.',
      short: 'We have not been able to search the registers',
      asOf: null,
    }
  }

  return {
    column: 'nonGmo',
    state: 'nothingOnFile',
    // Michael, 2026-10-07: 'Just say "Not verified by any public database"'.
    // Verification is a programme a maker opts into, so not being in one is
    // the whole answer. Note what this does NOT say: a product can contain no
    // GMOs and simply never have been submitted for verification. "Not
    // verified" is true either way; "not non-GMO" would not be.
    label: 'Not verified',
    detail: 'Not verified by any public database. Non-GMO verification is a programme a maker applies for, so this means no programme we check has verified it — not that the product contains GMOs.',
    short: 'Not verified by any public database',
    asOf: null,
  }
}

// ------------------------------------------------------------------ owner

export function ownerSignal(p: ProductForSignals): Signal {
  const parent = p.company.parentCompany
  return {
    column: 'owner',
    state: 'ownership',
    label: parent ? companyDisplayName(parent.legalName) : companyDisplayName(p.company.legalName),
    detail: parent
      ? `${companyDisplayName(p.company.legalName)} is owned by ${companyDisplayName(
          parent.legalName
        )}.`
      : `${companyDisplayName(
          p.company.legalName
        )}. We hold no record of a parent company above it.`,
    href: `/companies/${parent ? parent.id : p.company.id}`,
  }
}

// -------------------------------------------------------------- the strip

// All five, always, in the same order. A product with no answer for a column
// still gets a cell saying so — that is what makes the columns line up down
// the page and lets a shopper compare two products by eye.
export function productSignals(p: ProductForSignals, listedRecalls?: RecallItem[]): Signal[] {
  return [flaggedSignal(p), recallSignal(p, listedRecalls), organicSignal(p), nonGmoSignal(p), ownerSignal(p)]
}

// How many ingredients we can show, and whether we can show any. Used for the
// product page's signal row.
export function ingredientCount(p: ProductForSignals): number | null {
  return p.ingredientDisclosureStatus === 'disclosed' ? p.productIngredients.length : null
}

// Sort order for the search results: most to read about first. Not a ranking
// of how good a product is — it is a ranking of how much there is on file, so
// the rows a shopper most needs to open are not on page three.
const SORT_WEIGHT: Record<StatusKey, number> = {
  recall: 0,
  openResearch: 1,
  unchecked: 2,
  nothingOnFile: 3,
  confirmed: 4,
  notApplicable: 5,
  ownership: 6,
}

export function mostToReadAbout(a: Signal[], b: Signal[]): number {
  const weigh = (s: Signal[]) => Math.min(...s.filter((x) => x.column !== 'owner').map((x) => SORT_WEIGHT[x.state]))
  return weigh(a) - weigh(b)
}

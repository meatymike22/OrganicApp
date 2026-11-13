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
import { canAssertAbsence, PARTIAL_LIST_NOTE } from '@/lib/ingredientDisclosure'

// One cell in the five-column strip.
export type Signal = {
  // Which of the five questions this answers.
  column: 'flagged' | 'recalls' | 'organic' | 'nonGmo' | 'owner' | 'gluten'
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
  productIngredients: { isTrace: boolean; ingredient: { name: string; flaggedForResearch: boolean } }[]
  // What the PACKAGE says, as transcribed by an Open Food Facts contributor.
  // Not a register. See glutenSignal for why that distinction decides the
  // wording of every row built from it.
  labelClaims: string[]
  labelClaimsCheckedAt: Date | null
  // The label's OWN allergen statement and its cross-contact warning, as
  // transcribed from the package. The standing wording rule: the label's
  // "Contains:" statement is authoritative, and `traces` is the cross-contact
  // warning, which cannot be derived from anything -- it has to come off the
  // package or not at all.
  labelAllergens: string[]
  labelAllergenTraces: string[]
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

  // A PARTIAL LIST CANNOT CARRY A CLAIM ABOUT ABSENCE.
  //
  // 11,920 products hold a list Open Food Facts cut off at 255 characters.
  // Counting zero flagged ingredients in the part we hold says nothing about
  // the part we do not, and 3,038 of these products printed "Nothing on the
  // label is an additive we track" off exactly that reasoning. The cut is
  // biased against the worst thing to lose: an allergen statement is the LAST
  // line of a label, so a fixed-length truncation destroys it preferentially.
  //
  // `canAssertAbsence` rather than `=== 'partial'` ON PURPOSE. unchecked and
  // not_disclosed have already returned above, so this guard also catches any
  // status added later. The bug being fixed here IS a new status falling
  // through to the confident branch by default, and the shape of the guard is
  // what stops a fifth one doing it again.
  if (!canAssertAbsence(p.ingredientDisclosureStatus)) {
    if (flagged === 0) {
      return {
        column: 'flagged',
        state: 'unchecked',
        label: 'List cut off',
        detail: `${PARTIAL_LIST_NOTE} Nothing in the part we hold is an additive we track; we cannot speak for the rest.`,
        short: 'Ingredient list is cut off \u2014 we cannot speak for the rest',
        asOf,
      }
    }
    // Presence IS still reportable. An ingredient we can SEE is really in the
    // product; only the count is a floor, which is what the "+" carries.
    return {
      column: 'flagged',
      state: 'openResearch',
      label: `${flagged}+ flagged`,
      detail: `${PARTIAL_LIST_NOTE} At least ${flagged} ingredient${flagged === 1 ? '' : 's'} in the part we hold ${flagged === 1 ? 'is one' : 'are ones'} we are researching.`,
      asOf,
    }
  }

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
// `otherNotices` is how many notice EVENTS the product page's recalls section
// will list that do NOT list this product: notices naming the company, and
// process notices naming no product of ours. It is optional because the
// search rows have no section below them to disagree with.
//
// IT EXISTS BECAUSE THE CHIP AND THE SECTION CONTRADICTED EACH OTHER.
// Michael, 2026-10-12, on the Snickers page: "this says no recalls but below
// it says there are 3 recalls or notices. this is a bad discrepancy and needs
// to be fixed."
//
// Both numbers were right about different questions. Nothing lists that
// product's barcode, so this function said "No recalls"; three notices name
// Mars or its plants, so the section counted 3. A reader does not hold two
// questions in mind — they read the chip as the page's answer. So the chip
// now answers the narrow question in words that ADMIT it is narrow, and says
// out loud that there is more below.
export function recallSignal(
  p: ProductForSignals,
  listed: RecallItem[] | undefined,
  otherNotices = 0,
): Signal {
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

  // "NONE FOR THIS PRODUCT", NOT "NO RECALLS". The scope is in the label
  // because the label is what gets read, and the old one claimed the whole
  // page. Still `confirmed`: we did check, and the barcode is not on any
  // notice we hold — which is a fact, just a narrower one than it looked.
  return {
    column: 'recalls',
    state: 'confirmed',
    label: 'None for this product',
    detail:
      otherNotices > 0
        ? `No government notice we hold lists this product. ${otherNotices} ${
            otherNotices === 1 ? 'notice names' : 'notices name'
          } this company or its plants without naming this product; they are listed under recalls and government notices below.`
        : 'No government notice we hold lists this product.',
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

// ----------------------------------------------------------------- gluten

// IS IT GLUTEN FREE? The colours answer that question rather than describing
// the record.
//
// Michael, 2026-11-10: "Green in this case means certified or congruent with
// the positive of the column (in this case, is it gluten free? Yes = green,
// maybe = amber, no - gray)." And: "For context, I am gluten insensitive so I
// care about this section a lot."
//
// TWO SOURCES, AND THEY ARE NOT EQUALLY GOOD. This is the whole design.
//
//   The INGREDIENT LIST is hard evidence of PRESENCE. "Wheat flour" at
//   position 1 means the product contains gluten, and no label field can
//   argue with it.
//
//   Open Food Facts' `labelAllergens` is SOFT evidence. It is a contributor
//   field, and measuring it against the ingredient lists showed it fires for
//   two reasons that are not "this food contains gluten":
//
//     oats             281 of the 563 products that carry a gluten-free claim
//                      AND an en:gluten allergen tag mention oats and contain
//                      no gluten grain at all. Oats are not a gluten grain;
//                      they are cross-contamination-prone, and these products
//                      typically use certified gluten-free oats. Reading that
//                      as a contradiction is simply wrong.
//     cross-contact     47 more have the allergen tag only because the
//                      precautionary sentence was folded into it. See
//                      extractLabelStatements in ingredientParsing.ts.
//
//   Only 169 of the 563 have an actual gluten grain in the declaration.
//
// SO PRESENCE IS DECIDED BY THE INGREDIENT LIST, AND THE ALLERGEN FIELD ONLY
// EVER DOWNGRADES TO "MAYBE". An earlier version of this function trusted
// `labelAllergens` directly, which made "Label conflicts" fire on 563 products
// when it should fire on about 169 -- it turned a bag of certified
// gluten-free oats into a self-contradicting label.
//
// Reported by Michael, 2026-11-10, which is what exposed it: "for the
// everything bagel why has it not been checked? You can look at the
// ingredients and clearly see 'Wheat flour' in the ingredients. If this is the
// case do a separate check against the ingredients and use that to determine
// whether it is gluten free by ingredient."
//
// THE DIRECTION OF THE INGREDIENT CHECK IS ONE-WAY, and that is the r32 rule.
// A gluten grain in the list proves gluten is PRESENT. An absence proves
// nothing, because an ingredient list cannot see CROSS-CONTACT: a product with
// no gluten ingredient, made on shared equipment, can exceed 20 ppm. That is
// the whole reason certification exists and the reason the federal rule is
// written in parts per million rather than in ingredients. It is also why the
// "Assumed" green state Michael first asked for is not built -- 290,112
// published products are silent, and turning all of them green on the strength
// of nobody having said anything would tell a coeliac reader that 72% of the
// catalogue is safe, on no evidence at all.
//
//   en:gluten in labelAllergens        53,834   soft: see above
//   en:gluten in labelAllergenTraces    1,562   the label warns of cross-contact
//   en:certified-gluten-free             1,298   audited; GFCO certifies at 10 ppm
//   en:no-gluten                        24,607   claimed; 21 CFR 101.91, <20 ppm
//
// PRECEDENCE IS THE SAFETY PROPERTY OF THIS FUNCTION. The contradiction is
// tested FIRST, before either green state, so a label that disagrees with
// itself can never read as safe.
//
// "Contains gluten" is GREY and not red on purpose: bread containing gluten is
// not a defect, it is bread. Grey answers the column's question -- no -- without
// marking an ordinary food as alarming.
const GLUTEN_CERTIFIED = 'en:certified-gluten-free'
const GLUTEN_CLAIMED = 'en:no-gluten'
const GLUTEN_ALLERGEN = 'en:gluten'

// The gluten grains, matched against a NORMALIZED ingredient name (lowercase,
// singularised -- see ingredientNormalization.ts).
//
// WORD BOUNDARIES ARE DOING REAL WORK HERE. \bwheat\b does not match
// "buckwheat", which is gluten free and would otherwise be flagged on every
// buckwheat product in the catalogue. Oats are deliberately absent: they are
// not a gluten grain.
const GLUTEN_GRAIN =
  /\b(wheat|barley|rye|spelt|farro|kamut|khorasan|einkorn|emmer|triticale|durum|semolina|bulgur|couscous|freekeh|seitan|graham|farina|matzo|matzah|atta|maida)\b/

// "malt" needs its own rule for two opposite reasons. \bmalt\b already misses
// "maltodextrin" and "maltitol" (both gluten free, both far more common than
// malt itself) because the following letter is a word character -- but it also
// misses "malted", which is the form that actually appears, as in the
// Everything Bagel's "malted barley flour". Hence malt(ed).
//
// The exclusion is the other direction: "rice malt syrup" and "corn malt" are
// gluten free. Malt means barley malt unless the name names another grain.
const MALT = /\bmalt(ed)?\b/
const NON_GLUTEN_MALT_SOURCE = /\b(rice|corn|maize|tapioca|sorghum|millet|buckwheat)\b/

export function nameIsGlutenGrain(name: string): boolean {
  if (GLUTEN_GRAIN.test(name)) return true
  if (MALT.test(name) && !NON_GLUTEN_MALT_SOURCE.test(name)) return true
  return false
}

// The ingredient names on this product that are gluten grains, in label order.
//
// isTrace rows are INCLUDED on purpose. isTrace marks a minor component --
// "contains 2% or less of: malted barley flour" -- not an absent one, and that
// barley is in the food. It is the cross-contact statement that is not in the
// food, and after the 2026-11-10 parser fix that is not an ingredient row at
// all.
export function glutenGrainsInIngredients(p: ProductForSignals): string[] {
  const rows = p.productIngredients ?? []
  return rows.map((pi) => pi.ingredient?.name ?? '').filter((n) => n.length > 0 && nameIsGlutenGrain(n))
}

// "wheat flour and malted barley flour", capped so a 40-ingredient bread does
// not print a paragraph.
function grainPhrase(grains: string[]): string {
  const shown = grains.slice(0, 3)
  const more = grains.length - shown.length
  const joined =
    shown.length === 1
      ? shown[0]
      : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
  return more > 0 ? `${joined} (and ${more} more)` : joined
}

export function glutenSignal(p: ProductForSignals): Signal {
  // Gated on the EXISTING domain list rather than a new one, per the note on
  // domainApplies: a second list could disagree with the first. `ingredients`
  // covers food_beverage, personal_care and baby_child and excludes
  // household_general.
  if (!domainApplies(p.productType, 'ingredients')) {
    return {
      column: 'gluten',
      state: 'notApplicable',
      label: "Doesn't apply",
      detail: 'Gluten claims do not apply to this kind of product.',
      asOf: null,
    }
  }

  // DEFENSIVE, because the type system does not reach here: the product page
  // passes `product as unknown as ProductForSignals`, a double cast, so a page
  // whose Prisma select omits a field arrives with it undefined and `.includes`
  // throws. Treating a missing field as "we could not check" is the honest
  // reading of not having the data.
  const claims = p.labelClaims ?? null
  const allergens = p.labelAllergens ?? []
  const traces = p.labelAllergenTraces ?? []
  const asOf = isoDate(p.labelClaimsCheckedAt ?? null)

  const claimChecked = claims !== null && p.labelClaimsCheckedAt != null
  const certified = claims !== null && claims.includes(GLUTEN_CERTIFIED)
  const claimed = claims !== null && claims.includes(GLUTEN_CLAIMED)
  const labelNamesGluten = allergens.includes(GLUTEN_ALLERGEN)
  const tracesGluten = traces.includes(GLUTEN_ALLERGEN)

  const grains = glutenGrainsInIngredients(p)
  const hasIngredientList = (p.productIngredients ?? []).length > 0


  // 1. THE CONTRADICTION, FIRST, and it now requires a gluten grain in the
  //    declaration rather than an allergen tag. About 169 products. This must
  //    outrank both green states or a self-contradicting label reads as safe,
  //    which is the worst thing this row could do.
  if ((certified || claimed) && grains.length > 0) {
    return {
      column: 'gluten',
      state: 'openResearch',
      label: 'Label conflicts',
      detail: `This label claims gluten free, and its own ingredient list names ${grainPhrase(
        grains
      )}. Those cannot both be right, and we do not know which is. We show the conflict rather than picking a side — read the package before relying on either.`,
      short: 'Claims gluten free, but the ingredient list names a gluten grain',
      asOf,
    }
  }

  // 1b. A CLAIM PLUS A CROSS-CONTACT WARNING ON THE SAME LABEL, and no gluten
  //     grain in the ingredient list. 74 products.
  //
  //     GREEN, DECIDED BY MICHAEL, 2026-11-10: "i think if it has no
  //     ingredients that are gluten but 'may contain' it should be green."
  //
  //     Built amber first, and the argument for amber was about who reads the
  //     row rather than about the facts. The facts support green: the two
  //     statements do not legally contradict each other, because under
  //     21 CFR 101.91 a food bearing "gluten free" must be under 20 ppm
  //     whatever else the package says, and the precautionary sentence is
  //     voluntary. The claim is the binding one, so the column's question --
  //     is it gluten free? -- is answered yes.
  //
  //     THE LABEL STILL CARRIES THE CAVEAT, which is the point. "Claimed,
  //     shared line" is green and says both things, so nothing is hidden
  //     behind the colour; the warning is also in the detail and, since
  //     2026-11-10, in its own subsection of the ingredients tab.
  //
  //     ⚠️ THIS DOES NOT EXTEND TO BRANCH 6, where there is a cross-contact
  //     warning and NO gluten-free claim. There the only evidence of
  //     gluten-freeness is the absence of a grain from the ingredient list,
  //     which cannot see cross-contact -- and the label is explicitly warning
  //     about exactly that. Green there would also force the 287,593 silent
  //     products green by the same reasoning, since they have no gluten
  //     ingredient either, and Michael already ruled that out this morning.
  //     What makes this branch green is the CLAIM, not the absent grain.
  if ((certified || claimed) && tracesGluten) {
    return {
      column: 'gluten',
      state: 'confirmed',
      label: certified ? 'Certified, shared line' : 'Claimed, shared line',
      detail: `${
        certified
          ? 'The label carries a gluten-free certification mark'
          : 'The package claims gluten free'
      }, and the same label also warns that the product is made on equipment that handles gluten. Both are the package speaking. The claim is the regulated one — 21 CFR 101.91 requires under 20 parts per million — and a voluntary cross-contact warning does not cancel it. We show both rather than resolving it, because which one matters depends on how sensitive you are.`,
      short: certified
        ? 'Certified gluten free, with a cross-contact warning'
        : 'Claims gluten free, with a cross-contact warning',
      asOf,
    }
  }

  // 2. Certified: a body audited it.
  if (certified) {
    return {
      column: 'gluten',
      state: 'confirmed',
      label: 'Certified',
      detail:
        'The label carries a gluten-free certification mark, meaning a certifying body audited the product rather than the maker simply asserting it. GFCO, the common US mark, certifies at 10 ppm against an audited standard — stricter than the federal 20 ppm. We record the mark as transcribed from the package; we do not hold the certificate itself.',
      short: 'Certified gluten free on the label',
      asOf,
    }
  }

  // 3. Claimed: the package asserts it, with no certifier named. NOT
  //    marketing -- a regulated claim with a numeric threshold.
  if (claimed) {
    return {
      column: 'gluten',
      state: 'confirmed',
      label: 'Claimed',
      detail:
        'The package claims gluten free, with no certifying body named. In the United States that claim is regulated: 21 CFR 101.91 requires under 20 parts per million, and a food bearing it that fails is deemed misbranded. No certification is required to make the claim. We record what the label says, not a test result.',
      short: 'The package claims gluten free',
      asOf,
    }
  }

  // 4. A GLUTEN GRAIN IS IN THE INGREDIENT LIST. The Everything Bagel: wheat
  //    flour at position 1, no claim ever read off the label, and this row
  //    used to say "Not checked" while the ingredient list sat on the same
  //    page naming it. Presence is reportable and this is the reportable case.
  if (grains.length > 0) {
    return {
      column: 'gluten',
      state: 'nothingOnFile',
      label: 'Contains gluten',
      detail: labelNamesGluten
        ? `The ingredient list names ${grainPhrase(
            grains
          )}, and the label's own allergen statement names gluten. Both agree.`
        : `The ingredient list names ${grainPhrase(
            grains
          )}, which is a gluten grain. This is our reading of the declaration the maker published, not a test result.`,
      short: 'The ingredient list names a gluten grain',
      asOf: isoDate(p.ingredientCheckedAt ?? null),
    }
  }

  // 5. THE ALLERGEN FIELD NAMES GLUTEN BUT NO GRAIN IS IN THE DECLARATION.
  //    This is the oat case, 281 products of it, plus whatever cross-contact
  //    text was folded into the allergen field before the parser separated
  //    it. Amber, not grey: "maybe" is the honest answer when the two sources
  //    disagree and the weaker one is the only one saying yes.
  if (labelNamesGluten) {
    return {
      column: 'gluten',
      state: 'openResearch',
      label: 'May contain',
      detail: hasIngredientList
        ? 'The allergen data recorded for this label names gluten, but no gluten grain appears in its ingredient list. That usually means one of two things: the product contains oats, which are not a gluten grain but are often handled alongside them, or a cross-contact warning was recorded as an allergen. We show both rather than resolving it — read the package.'
        : 'The allergen data recorded for this label names gluten. We have no ingredient list for this product to check it against.',
      short: 'Allergen data names gluten; no gluten grain in the ingredient list',
      asOf,
    }
  }

  // 6. Cross-contact only. The one gluten fact that cannot be derived from
  //    anything -- it is on the package or it is nowhere.
  if (tracesGluten) {
    return {
      column: 'gluten',
      state: 'openResearch',
      label: 'May contain',
      detail:
        'The label carries a cross-contact warning for gluten — made on equipment that also handles it. The product makes no gluten-free claim. A cross-contact warning cannot be derived from an ingredient list, so this comes from the package itself.',
      short: 'The label warns of gluten cross-contact',
      asOf,
    }
  }

  // 7. Nothing read off the label, and no ingredient list to fall back on.
  if (!claimChecked) {
    return {
      column: 'gluten',
      state: 'unchecked',
      label: 'Not checked',
      detail:
        'We have not been able to read this label, and we have no ingredient list for this product either, so we do not know whether it carries a gluten claim or contains a gluten grain. This says nothing about the product.',
      short: 'We have not been able to check the label',
      asOf: null,
    }
  }

  // 8. Silent. We looked and the label says nothing about gluten either way.
  //    THIS IS NOT "GLUTEN FREE", and the detail says so in as many words,
  //    because this is the state a reader is most likely to over-read. Where
  //    there IS an ingredient list, saying that no gluten grain appears in it
  //    is reportable and useful -- it is the absence of a CLAIM that we
  //    decline to read as gluten free, not the absence of a grain.
  return {
    column: 'gluten',
    state: 'nothingOnFile',
    label: 'Not declared',
    detail: hasIngredientList
      ? 'This label makes no gluten-free claim, and no gluten grain appears in its ingredient list. That is not the same as gluten free: an ingredient list cannot see cross-contact, and a product with no gluten ingredient made on shared equipment can still exceed the 20 ppm the claim requires. It is the missing claim we decline to read as gluten free.'
      : 'This label makes no gluten-free claim and its allergen statement does not name gluten. That is not the same as gluten free: a maker can leave the claim off a product that would qualify, and a product with no gluten ingredient can still be made on shared equipment.',
    short: 'No gluten claim and no gluten grain declared',
    asOf,
  }
}

// ------------------------------------------------------------------ owner

export function ownerSignal(p: ProductForSignals): Signal {
  const parent = p.company.parentCompany
  return {
    column: 'owner',
    state: 'ownership',
    label: parent ? companyDisplayName(parent.legalName) : companyDisplayName(p.company.legalName),
    // Michael, 2026-10-08: "no need to explain that we dont have a parent
    // company. this is TMI."
    //
    // He is right, and this is not the three-state rule losing a state. The
    // tile's VALUE already states who owns the product: with a parent it
    // names the parent, without one it names the company itself. The sentence
    // explaining the absence was explaining the absence of a second name the
    // reader had not asked about and could not see was missing.
    //
    // Where the ownership chain genuinely is unknown rather than absent, that
    // is a different statement and it is on the company page, which is where
    // someone reading about ownership has gone.
    detail: parent
      ? `${companyDisplayName(p.company.legalName)} is owned by ${companyDisplayName(
          parent.legalName
        )}.`
      : `${companyDisplayName(p.company.legalName)}.`,
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

// ===================== SELFTEST =====================
//
// `npx tsx src/lib/productSignals.ts --selftest`
//
// WHY THIS FILE HAS TESTS NOW AND DID NOT BEFORE. glutenSignal has nine
// branches whose ORDER is the safety property: the label-conflict case has to
// be tested before either green state, or a label that contradicts itself
// reads as safe. A reader relies on that row to decide what to eat.
//
// The cases below also pin the 2026-11-10 change of SOURCE. Presence is now
// decided by the ingredient list and Open Food Facts' allergen field can only
// downgrade to "maybe", because measuring the two against each other showed
// the allergen field fires on oats and on cross-contact text. Several
// expectations here were REVERSED by that change -- a bag of certified
// gluten-free oats used to read "Label conflicts" -- so they are the record
// of a deliberate decision, not incidental coverage.
// Precedence is exactly the kind of thing that survives a careless edit and
// fails silently, so it gets cases.
if (process.argv[1]?.endsWith('productSignals.ts') && process.argv.includes('--selftest')) {
  let bad = 0
  const bare: ProductForSignals = {
    id: 'p1',
    productType: 'food_beverage',
    ingredientDisclosureStatus: 'disclosed',
    ingredientCheckedAt: new Date('2026-10-15'),
    productIngredients: [],
    labelClaims: [],
    labelClaimsCheckedAt: new Date('2026-10-15'),
    labelAllergens: [],
    labelAllergenTraces: [],
    certifications: [],
    productCertifications: [],
    company: {
      id: 'c1', legalName: 'Example Foods Inc.', vettingStatus: 'vetted', parentCompany: null,
    },
  }
  const gl = (over: Partial<ProductForSignals>, wantLabel: string, wantState: string) => {
    const got = glutenSignal({ ...bare, ...over })
    const ok = got.label === wantLabel && got.state === wantState
    if (!ok) bad++
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} gluten ${JSON.stringify({ ...over })} -> ${got.label} / ${got.state}` +
        (ok ? '' : `  want ${wantLabel} / ${wantState}`)
    )
  }

  const ing = (...names: string[]): ProductForSignals['productIngredients'] =>
    names.map((name) => ({ isTrace: false, ingredient: { name, flaggedForResearch: false } }))

  // The states a label alone can produce, with no ingredient list.
  gl({ labelClaims: ['en:certified-gluten-free'] }, 'Certified', 'confirmed')
  gl({ labelClaims: ['en:no-gluten'] }, 'Claimed', 'confirmed')
  gl({ labelAllergenTraces: ['en:gluten'] }, 'May contain', 'openResearch')
  gl({}, 'Not declared', 'nothingOnFile')
  gl({ labelClaimsCheckedAt: null }, 'Not checked', 'unchecked')
  gl({ productType: 'household_general' }, "Doesn't apply", 'notApplicable')

  // THE INGREDIENT LIST DECIDES PRESENCE. The Everything Bagel, reported by
  // Michael on 2026-11-10: no gluten claim was ever read off its label, and
  // "wheat flour enriched" is at position 1. This row said "Not checked"
  // while the ingredient list naming wheat sat on the same page.
  gl({ labelClaims: null as unknown as string[], labelClaimsCheckedAt: null,
       productIngredients: ing('wheat flour enriched', 'malted barley flour', 'water') },
     'Contains gluten', 'nothingOnFile')
  gl({ productIngredients: ing('wheat flour') }, 'Contains gluten', 'nothingOnFile')

  // THE OAT CASE: 281 of the 563 products that used to read "Label conflicts".
  // The allergen field names gluten, the declaration holds no gluten grain,
  // and the product claims gluten free -- a bag of certified gluten-free oats.
  gl({ labelClaims: ['en:no-gluten'], labelAllergens: ['en:gluten'],
       productIngredients: ing('oat', 'cane sugar') }, 'Claimed', 'confirmed')
  // Same data without the claim: amber, because the two sources disagree and
  // the weaker one is the only one saying yes.
  gl({ labelAllergens: ['en:gluten'], productIngredients: ing('oat') },
     'May contain', 'openResearch')
  // No ingredient list to check it against: still amber, different wording.
  gl({ labelAllergens: ['en:gluten'] }, 'May contain', 'openResearch')

  // A REAL CONTRADICTION still outranks both green states. This is the
  // precedence property the whole function is ordered around.
  gl({ labelClaims: ['en:no-gluten'], productIngredients: ing('wheat flour') },
     'Label conflicts', 'openResearch')
  gl({ labelClaims: ['en:certified-gluten-free'], productIngredients: ing('barley malt') },
     'Label conflicts', 'openResearch')

  // A claim plus a cross-contact warning: green, with the warning still named.
  // GREEN since Michael's 2026-11-10 decision; it was amber for an hour.
  // The claim is what makes it green, not the absent grain -- see branch 1b.
  gl({ labelClaims: ['en:no-gluten'], labelAllergenTraces: ['en:gluten'] },
     'Claimed, shared line', 'confirmed')
  gl({ labelClaims: ['en:certified-gluten-free'], labelAllergenTraces: ['en:gluten'] },
     'Certified, shared line', 'confirmed')
  // ...and the same warning WITHOUT a claim stays amber. This is the pair
  // that pins down what the decision did and did not change.
  gl({ labelAllergenTraces: ['en:gluten'] }, 'May contain', 'openResearch')
  // ...and a grain in the declaration outranks even that.
  gl({ labelClaims: ['en:no-gluten'], labelAllergenTraces: ['en:gluten'],
       productIngredients: ing('wheat flour') }, 'Label conflicts', 'openResearch')

  // THE GRAIN LEXICON. Every false positive below is a real product in the
  // catalogue, and each one would be told it contains gluten by a looser
  // match. These are the cases that must stay NEGATIVE.
  gl({ productIngredients: ing('buckwheat flour') }, 'Not declared', 'nothingOnFile')
  gl({ productIngredients: ing('maltodextrin') }, 'Not declared', 'nothingOnFile')
  gl({ productIngredients: ing('maltitol') }, 'Not declared', 'nothingOnFile')
  gl({ productIngredients: ing('rice malt syrup') }, 'Not declared', 'nothingOnFile')
  gl({ productIngredients: ing('oat flour') }, 'Not declared', 'nothingOnFile')
  // ...and the ones it must still catch.
  gl({ productIngredients: ing('semolina') }, 'Contains gluten', 'nothingOnFile')
  gl({ productIngredients: ing('seitan') }, 'Contains gluten', 'nothingOnFile')
  gl({ productIngredients: ing('couscous') }, 'Contains gluten', 'nothingOnFile')
  gl({ productIngredients: ing('vital wheat gluten') }, 'Contains gluten', 'nothingOnFile')
  gl({ productIngredients: ing('malt vinegar') }, 'Contains gluten', 'nothingOnFile')
  gl({ productIngredients: ing('malted barley flour') }, 'Contains gluten', 'nothingOnFile')

  // THE CROSS-CONTACT LEAK, as it is stored TODAY on 'Dark chocolate coconut
  // almond bites': five phantom rows from the label's two trailing
  // statements. "gluten/wheat" is matched by \bwheat\b, so until
  // repair-allergen-statement-rows.ts runs, this product reads as a
  // self-contradicting label. That is the correct reading of the stored data
  // and the reason the backfill exists.
  gl({ labelClaims: ['en:no-gluten'],
       productIngredients: ing('coconut', 'almond', 'tree nut', 'milk', 'gluten/wheat') },
     'Label conflicts', 'openResearch')
  // After the backfill, the same product reads as its label actually says.
  gl({ labelClaims: ['en:no-gluten'], productIngredients: ing('coconut', 'almond') },
     'Claimed', 'confirmed')

  // Another allergen is not gluten. Guards against a substring or a loose
  // match creeping in -- `en:gluten` must match exactly.
  gl({ labelAllergens: ['en:milk', 'en:soybeans'] }, 'Not declared', 'nothingOnFile')

  // THE DOUBLE CAST ON THE PRODUCT PAGE MEANS THESE CAN ARRIVE UNDEFINED.
  // `product as unknown as ProductForSignals` type-checks whatever it is
  // given, so a page that forgets a field in its Prisma select reaches here
  // with it missing. It must not throw on a live product page.
  gl({ labelClaims: undefined as unknown as string[] }, 'Not checked', 'unchecked')
  gl({ labelAllergens: undefined as unknown as string[], labelClaims: ['en:no-gluten'] },
     'Claimed', 'confirmed')
  gl({ labelAllergenTraces: undefined as unknown as string[] }, 'Not declared', 'nothingOnFile')
  gl({ productIngredients: undefined as unknown as ProductForSignals['productIngredients'] },
     'Not declared', 'nothingOnFile')

  console.log(bad === 0 ? 'glutenSignal: all cases pass' : `glutenSignal: ${bad} FAILURES`)
}

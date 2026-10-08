// Reading recalls and other regulatory actions for pages.
//
// HOW RECALLS ARE STORED (see RegulatoryAction and RegulatoryActionLink in
// prisma/schema.prisma, and scripts/match-recalls.ts):
//   - RegulatoryAction.companyId is the firm the notice NAMES (a brand, a
//     subsidiary or a parent). The action lives on that company's page.
//   - RegulatoryActionLink ties an action to the BRAND it concerns, and to the
//     exact PRODUCT when the notice lists its barcode:
//       productId set  → this product is listed in the notice
//       productId null → the notice concerns this brand; which of its products
//                        is only known from the action's productDescription,
//                        so that text must always be shown with it
//   - An action with no links (e.g. a parent's recall that names none of its
//     brands) belongs on the issuing company's page only.
//
// Use these helpers rather than querying the tables directly, so every page
// applies the same display rule.
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { companyDisplayName } from '@/lib/productName'

// Which actions are shown. Every recall the firm is named on appears on its
// company page, whatever the product category (food, drug, device, consumer
// product): a company page is the record of that firm's recalls. Whether a
// recall appears next to a PRODUCT is decided only by RegulatoryActionLink.
// (productRelevance is kept as a note, e.g. "unrelated_line" marks a
// different business line of the same company, but no longer hides anything.)
export const SHOWN_ACTIONS = {} satisfies Prisma.RegulatoryActionWhereInput

const ACTION_FIELDS = {
  id: true,
  sourceAgency: true,
  referenceNumber: true,
  actionType: true,
  classification: true,
  reason: true,
  productDescription: true,
  status: true,
  actionDate: true,
  sourceUrl: true,
  productRelevance: true,
  company: { select: { id: true, legalName: true, businessRole: true } },
} satisfies Prisma.RegulatoryActionSelect

// Newest first; actions without a date last.
const NEWEST_FIRST = [{ actionDate: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }] satisfies Prisma.RegulatoryActionOrderByWithRelationInput[]

export type RecallItem = Prisma.RegulatoryActionGetPayload<{ select: typeof ACTION_FIELDS }> & {
  // How this recall is tied to the company/product being viewed, when it is
  // (see evidenceNote()). `matchedText` is the string in the notice that
  // produced the match — a barcode, or a brand name. It is shown to the
  // reader for brand-level links, because "this notice named LIFE SAVERS"
  // is the difference between a useful row and a misleading one.
  link?: { matchMethod: string; productId: string | null; matchedText: string | null }
}
export type RecallList = { count: number; items: RecallItem[] }

async function list(where: Prisma.RegulatoryActionWhereInput, limit?: number): Promise<RecallList> {
  const [count, items] = await Promise.all([
    prisma.regulatoryAction.count({ where }),
    prisma.regulatoryAction.findMany({ where, select: ACTION_FIELDS, orderBy: NEWEST_FIRST, take: limit }),
  ])
  return { count, items }
}

// For a company page.
//   issued: actions this company is named on (its own recalls).
//   naming: actions issued by ANOTHER firm (its parent, or a co-packer) that
//           are tied to this company as a brand. Without this, a brand whose
//           recall was issued under its parent's name would show nothing.
// `limit` caps each list (newest first); `count` is always the full total.
export async function getCompanyRecalls(companyId: string, limit?: number) {
  const [issued, naming] = await Promise.all([
    list({ ...SHOWN_ACTIONS, companyId }, limit),
    list({ ...SHOWN_ACTIONS, companyId: { not: companyId }, links: { some: { companyId } } }, limit),
  ])
  await attachLinks(naming.items, companyId)
  return { issued, naming }
}

// Adds, to each action, how it is tied to `companyId` (strongest link first:
// a listed barcode beats a brand-level link).
async function attachLinks(items: RecallItem[], companyId: string) {
  if (!items.length) return
  const links = await prisma.regulatoryActionLink.findMany({
    where: { companyId, actionId: { in: items.map((i) => i.id) } },
    select: { actionId: true, matchMethod: true, productId: true, matchedText: true },
  })
  for (const item of items) {
    const mine = links.filter((l) => l.actionId === item.id)
    item.link = mine.find((l) => l.productId) ?? mine[0]
  }
}

// What the evidence does and doesn't show, in plain words, for a recall
// shown on a brand or product that did not issue it. Rootify reports what a
// notice says; it only states that a product was affected when the notice
// itself identifies that product (its barcode). Everything else is worded as
// "a notice names this brand", never as "this product was recalled".
export function evidenceNote(item: RecallItem): string | null {
  const issuer = companyDisplayName(item.company.legalName)
  const middleman =
    item.company.businessRole === 'supply_chain'
      ? ` ${issuer} makes, packs, imports or distributes products for other companies.`
      : item.company.businessRole === 'retailer'
        ? ` ${issuer} is a retailer.`
        : ''
  // NAME THE BRAND THE NOTICE ACTUALLY NAMED. Michael, 2026-10-07: "should
  // a skittles recall be included under M&Ms? this is too broad of a recall
  // to apply here."
  //
  // He is right that it reads as being about this product. The link already
  // records what matched — for that notice, "LIFE SAVERS" — so the row can
  // say which brand it was about instead of leaving the reader to assume it
  // was this one. Nothing is hidden; the notice is named more precisely.
  //
  // Skipped when the matched text is a barcode or other digits, where
  // repeating it back tells a reader nothing.
  const matched = item.link?.matchedText?.trim()
  const named = matched && /[A-Za-z]{2}/.test(matched) ? ` The notice named “${matched}”.` : ''

  switch (item.link?.matchMethod) {
    case 'barcode':
      return `The notice from ${issuer} lists this product's barcode.${middleman}`
    case 'owner_brand':
      return `Issued by ${issuer}, the company behind this brand.${named} It covers the product described, not necessarily every product of the brand.`
    case 'named_brand':
      return `Issued by ${issuer}, not by the owner of this brand.${middleman}${named} On its own it does not show which of this brand's products, if any on this page, were affected.`
    case undefined:
      return null
    default:
      return `Issued by ${issuer}.${named} It covers the product described, not necessarily every product of this brand.`
  }
}

// For a list of products (e.g. the products on a company page): the actions
// whose notice lists each product's barcode. Brand-wide links are not
// included here — they are the company's recalls, shown once per page.
export async function getRecallsListingProducts(productIds: string[]): Promise<Map<string, RecallItem[]>> {
  const out = new Map<string, RecallItem[]>()
  if (!productIds.length) return out
  const links = await prisma.regulatoryActionLink.findMany({
    where: { productId: { in: productIds }, action: SHOWN_ACTIONS },
    select: { productId: true, action: { select: ACTION_FIELDS } },
    orderBy: { action: { actionDate: { sort: 'desc', nulls: 'last' } } },
  })
  for (const l of links) {
    if (!l.productId) continue
    out.set(l.productId, [...(out.get(l.productId) ?? []), l.action])
  }
  return out
}

// Recalls about HOW FOOD WAS MADE OR HANDLED — contamination (Listeria,
// Salmonella...), unsanitary conditions or processing failures, foreign
// material — as opposed to a labeling or allergen error on one product.
// Used for the "process" hint: when such a recall names no product, a
// shopper can't tell whether a given product was affected, but should know
// the company (or its parent) had one. The same categories were checked
// against the database on 2026-09-30 (about 3,900 unlinked recalls).
const PROCESS_REASON =
  /(listeria|salmonella|e\.? ?coli|o157|stec|clostridium|botulinum|botulism|cronobacter|norovirus|hepatitis|cyclospora|staphylococc|bacillus|pathogen|microbial|mold|yeast|contaminat|insanitary|unsanitary|sanitation|rodent|insect|pest|filth|\bc?gmp\b|good manufacturing|under.?process|processing deviation|temperature abuse|not properly (cooked|pasteurized)|pasteuri|without (the )?benefit of (federal )?inspection|foreign (material|matter|object)|\bmetal\b|\bglass\b|hard plastic|pieces of plastic|\brubber\b)/i

export function isProcessRelated(reason: string | null | undefined): boolean {
  return !!reason && PROCESS_REASON.test(reason)
}

// WHAT COUNTS AS A FOOD RECALL, declared ONCE.
//
// FSIS, and FDA's food enforcement reports (recall numbers F-… and, from
// 2025, H-…). FDA drug (D-…) and device (Z-…) recalls and CPSC
// consumer-product recalls say nothing about how FOOD was made.
//
// Declared as data rather than written twice, because the rule is now needed
// both as a predicate (below) and as a Prisma where-clause. Writing the same
// rule in two places is exactly how the barcode-normalisation bug of round 6
// happened: a second implementation that quietly disagreed with the first.
const FSIS = 'FSIS'
const FDA_FOOD_PREFIXES = ['F-', 'H-'] as const

export function isFoodRecall(a: { sourceAgency: string; referenceNumber: string | null }): boolean {
  if (a.sourceAgency === FSIS) return true
  if (a.sourceAgency !== 'FDA') return false
  const ref = (a.referenceNumber ?? '').toUpperCase()
  return FDA_FOOD_PREFIXES.some((prefix) => ref.startsWith(prefix))
}

// The same rule as a query filter, built from the same two constants.
export const FOOD_RECALL_WHERE = {
  OR: [
    { sourceAgency: FSIS },
    ...FDA_FOOD_PREFIXES.map((prefix) => ({
      sourceAgency: 'FDA',
      referenceNumber: { startsWith: prefix, mode: 'insensitive' as const },
    })),
  ],
} satisfies Prisma.RegulatoryActionWhereInput

// Process-related FOOD recalls issued by these companies (typically a brand and
// its parents) that name no brand or product of ours. Shown as a hint, never
// as a recall of the product.
export async function getUnlinkedProcessRecalls(companyIds: string[]): Promise<RecallList> {
  if (!companyIds.length) return { count: 0, items: [] }
  const all = await prisma.regulatoryAction.findMany({
    where: { ...SHOWN_ACTIONS, companyId: { in: companyIds }, links: { none: {} } },
    select: ACTION_FIELDS,
    orderBy: NEWEST_FIRST,
  })
  const items = all.filter((a) => isFoodRecall(a) && isProcessRelated(a.reason))
  return { count: items.length, items }
}

// A company and its parents, nearest first (for the process hint).
export async function companyAndParents(companyId: string): Promise<{ id: string; legalName: string }[]> {
  const out: { id: string; legalName: string }[] = []
  let id: string | null = companyId
  for (let depth = 0; id && depth < 5; depth++) {
    const c: { id: string; legalName: string; parentCompanyId: string | null } | null = await prisma.company.findUnique({
      where: { id },
      select: { id: true, legalName: true, parentCompanyId: true },
    })
    if (!c) break
    out.push({ id: c.id, legalName: c.legalName })
    id = c.parentCompanyId
  }
  return out
}

// For a product page.
//   thisProduct: notices that list this product's barcode.
//   brand:       notices tied to the product's brand as a whole, not
//                naming a barcode. Show each with its productDescription,
//                worded as "a recall for this brand", never as a recall of
//                this product.
//   process:     the hint — process-related recalls by the brand or its
//                parents that name no product (see getUnlinkedProcessRecalls).
export async function getProductRecalls(productId: string, limit?: number) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { companyId: true, productType: true },
  })
  if (!product) return null
  const family = await companyAndParents(product.companyId)

  // THE AGENCY FILTER, AND WHY IT APPLIES TO ONLY SOME OF THESE BUCKETS.
  //
  // Michael, 2026-10-07, on an M&M’s page: "what does jewelry have to do
  // with the actual M&Ms? We need to check the database for recalls that may
  // be attached to a product that doesnt make sense like this."
  //
  // He was right, and the audit was worse than the comment. 607 non-food
  // notices reach product pages through company-level links, across 139
  // companies and 26,372 product pages: Roman blinds on every Meijer
  // product, a space-heater recall on Amazon’s, "Letters to Santa Mailbox"
  // on Target’s, Hot Wheels on Kellogg’s.
  //
  // BUT A BLANKET AGENCY FILTER WOULD BE WORSE. Read this before changing
  // it. The links split cleanly by strength, verified 2026-10-07:
  //
  //   product-level links: 2,969 — EVERY ONE matched by barcode
  //   company-level links: 10,918 — every one matched on a brand or firm name
  //
  // A barcode-matched notice printed THIS PRODUCT'S OWN BARCODE. That is the
  // strongest evidence we ever have, and filtering it by agency would hide 13
  // genuinely correct recalls of the exact product being viewed — including
  // an Advil recall on the Advil page and an Orajel recall on the Orajel
  // page. (Those are products our classifier wrongly calls food_beverage,
  // which is a separate problem; the recall match itself is right.)
  //
  // So `thisProduct` is never filtered. The brand bucket, which rests on a
  // name match, is food-only when the product is food. A CPSC recall still
  // belongs on a baby bottle, so the filter is keyed to the product’s own
  // type rather than applied unconditionally.
  //
  // Nothing is deleted and nothing becomes unreachable: every one of these
  // notices still appears in full on the issuing company’s own page, which
  // is the record of that firm’s recalls whatever the product category.
  const agencyFilter = product.productType === 'food_beverage' ? FOOD_RECALL_WHERE : {}

  const [thisProduct, brand, process] = await Promise.all([
    // Barcode links only. Deliberately unfiltered — see above.
    list({ ...SHOWN_ACTIONS, links: { some: { productId } } }, limit),
    list(
      {
        ...SHOWN_ACTIONS,
        ...agencyFilter,
        links: { some: { companyId: product.companyId, productId: null } },
        NOT: { links: { some: { productId } } },
      },
      limit
    ),
    getUnlinkedProcessRecalls(family.map((c) => c.id)),
  ])
  await Promise.all([attachLinks(thisProduct.items, product.companyId), attachLinks(brand.items, product.companyId)])
  return { thisProduct, brand, process, family }
}

// ---------------------------------------------- one notice, said once

// GROUPING THE SAME RECALL EVENT.
//
// The FDA enforcement database issues ONE RECORD PER AFFECTED PRODUCT LINE.
// Dole's wash-system recall of 2022-11-28 is sixteen records — F-0229-2023
// through F-0244-2023 — identical in agency, date, classification and
// reason, differing only in which product each one lists. The 2024 Listeria
// recall is five more. Rendered one-per-row, a product page repeats the same
// sentence sixteen times, which is exactly the overwhelm Michael flagged:
// "I know the same recall covered multiple products, but this display needs
// to be better."
//
// WHY THIS IS NOT A DATA CLEANUP. Each reference number is a real, separately
// citable government record. Merging or deleting them in the database would
// destroy the citation, and the citation is the whole basis on which Rootify
// says anything about a named company. So every reference number is kept and
// every one stays reachable — they are listed on the product's sources page.
// Only the DISPLAY collapses them.
//
// The grouping key is deliberately conservative: same agency, same date, same
// classification, same reason text. Two genuinely different recalls that
// happen to share all four are indistinguishable to a reader anyway, and a
// difference in any one of them keeps them apart.
export type RecallGroup = {
  // The record shown as the group's representative: the first, which is the
  // newest since the list arrives sorted.
  lead: RecallItem
  // Every record in the group, including the lead. Length 1 is the normal case.
  items: RecallItem[]
  // The reference numbers, in the order the records came.
  references: string[]
}

function groupKey(a: RecallItem): string {
  return [
    a.sourceAgency ?? '',
    a.actionDate ? a.actionDate.toISOString().slice(0, 10) : '',
    a.classification ?? '',
    (a.reason ?? '').trim().toLowerCase(),
  ].join('\u0000')
}

export function groupRecalls(items: RecallItem[]): RecallGroup[] {
  const byKey = new Map<string, RecallGroup>()
  const order: string[] = []

  for (const item of items) {
    const key = groupKey(item)
    const existing = byKey.get(key)
    if (existing) {
      existing.items.push(item)
      if (item.referenceNumber) existing.references.push(item.referenceNumber)
    } else {
      byKey.set(key, {
        lead: item,
        items: [item],
        references: item.referenceNumber ? [item.referenceNumber] : [],
      })
      order.push(key)
    }
  }

  return order.map((k) => byKey.get(k)!)
}

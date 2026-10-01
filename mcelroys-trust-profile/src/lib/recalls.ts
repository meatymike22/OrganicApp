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
  // (see evidenceNote()).
  link?: { matchMethod: string; productId: string | null }
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
    select: { actionId: true, matchMethod: true, productId: true },
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
  const issuer = item.company.legalName
  const middleman =
    item.company.businessRole === 'supply_chain'
      ? ` ${issuer} makes, packs, imports or distributes products for other companies.`
      : item.company.businessRole === 'retailer'
        ? ` ${issuer} is a retailer.`
        : ''
  switch (item.link?.matchMethod) {
    case 'barcode':
      return `The notice from ${issuer} lists this product's barcode.${middleman}`
    case 'owner_brand':
      return `Issued by ${issuer}, the company behind this brand. The notice names the brand; it covers the product described, not necessarily every product of the brand.`
    case 'named_brand':
      return `Issued by ${issuer}, not by the owner of this brand.${middleman} The notice names this brand as the product's label, but on its own it does not show which of this brand's products, if any on this page, were affected.`
    case undefined:
      return null
    default:
      return `Issued by ${issuer}. The notice covers the product described, not necessarily every product of this brand.`
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

// Food recalls only: FSIS, and FDA's food enforcement reports (recall numbers
// F-… and, from 2025, H-…). FDA drug (D-…) and device (Z-…) recalls and CPSC
// consumer-product recalls say nothing about how FOOD was made.
export function isFoodRecall(a: { sourceAgency: string; referenceNumber: string | null }): boolean {
  if (a.sourceAgency === 'FSIS') return true
  return a.sourceAgency === 'FDA' && /^[FH]-/i.test(a.referenceNumber ?? '')
}

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
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { companyId: true } })
  if (!product) return null
  const family = await companyAndParents(product.companyId)
  const [thisProduct, brand, process] = await Promise.all([
    list({ ...SHOWN_ACTIONS, links: { some: { productId } } }, limit),
    list(
      {
        ...SHOWN_ACTIONS,
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

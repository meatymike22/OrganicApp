// Shared filter for "companies confirmed to be real and correctly identified"
// — by a person, by USDA barcode records, or by an AI review; the
// Company.vettingMethod column records which. See the vettingStatus comment on the Company model in
// prisma/schema.prisma for the full reasoning.
//
// USE THIS in any script or page that MATCHES COMPANIES BY NAME against an
// outside source (recalls, warning letters, SEC, USDA organic, CBP). Unvetted
// companies were created from free-text brand fields, so their names are not
// reliable enough to attach a government record to — a false match would
// publish one company's recall on another company's page.
//
// Scripts that look products up BY UPC (Open Food Facts, Open Beauty Facts,
// USDA FoodData Central) don't need it: a barcode identifies the exact
// product, so those facts are safe to attach whatever the company's status.
//
// Usage:
//   prisma.company.findMany({ where: VETTED_COMPANIES })
//   prisma.company.findMany({ where: { ...VETTED_COMPANIES, legalName: x } })
import type { Prisma } from '@prisma/client'

export const VETTED_COMPANIES = {
  vettingStatus: 'vetted',
} satisfies Prisma.CompanyWhereInput

// The three allowed values, kept in one place so a typo like "vetted " can't
// silently create a fourth state.
export const VETTING_STATUSES = ['vetted', 'unvetted', 'rejected'] as const
export type VettingStatus = (typeof VETTING_STATUSES)[number]

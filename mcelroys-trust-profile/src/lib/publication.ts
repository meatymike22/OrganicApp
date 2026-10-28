// Shared filter for "this product record is fit to publish".
//
// Michael, 2026-10-25, looking at a search row whose title was the company
// name: "if the title is the same as the product without any additional
// information then it shouldnt go into the database because its not a real
// product unless the photo or barcode gives us more information about it in
// which case we should try to research to get the product name. If we cant
// in the end then it should be in a part of the database that has a 'missing
// info' category and doesnt get displayed on the website."
//
// This is the three-state rule applied to the product's own identity. The
// site's entire claim is that every page reports a record. A page that cannot
// name the product it describes reports nothing — and dressing it up with a
// category we guessed at would be worse than withholding it, because then the
// guess reads as the product's name.
//
// USE THIS in any query whose results a READER will see: search, browse, a
// company's product list, related products, a scan result, the sitemap.
// Written as a spread so it composes:
//
//   prisma.product.findMany({ where: PUBLISHED_PRODUCTS })
//   prisma.product.findMany({ where: { ...PUBLISHED_PRODUCTS, companyId: x } })
//
// DO NOT use it in ingestion, backfills or measurement scripts. A withheld
// record is still a record: the barcode and the company are real, later
// passes are expected to recover the name and promote it back, and a backfill
// that skipped withheld rows could never fix them. The same split VETTED_COMPANIES
// makes — a visibility rule, not a data rule.
//
// WHY A SHARED CONSTANT AND NOT A CONDITION PER QUERY. There are eight
// product query sites today. A gate copied into eight places is a gate that
// leaks the first time someone adds a ninth, and the failure is silent: a
// withheld record simply reappears. Item 20 in the backlog is the same bug
// seven times over, and the answer has been the same every time — make it one
// thing.
//
// findUnique CANNOT USE THIS. publicationStatus is not unique, so a product
// page has to select the column and check it after the fetch, the way the
// rejected-company check already works there:
//
//   if (!product || product.publicationStatus !== 'published') notFound()
//
// PERFORMANCE. Unlike the rejected-company exclusion in search/page.tsx —
// which had to be rewritten as an id list because the relation form cost
// 1.03 s — this is a plain column on Product itself. No join, no subquery.
// Measure before adding an index: with ~99.4% of rows 'published', a btree on
// two values is one the planner will ignore. If plans regress, the fix is a
// partial index on the existing sort key, noted in the migration.
import type { Prisma } from '@prisma/client'

export const PUBLISHED_PRODUCTS = {
  publicationStatus: 'published',
} satisfies Prisma.ProductWhereInput

// THE COMPLEMENT, for the one query that must find what the gate hides.
//
// A barcode we hold but have withheld is not "no results". Searching it has
// to say so, or the site tells a shopper we have nothing on a product whose
// barcode is sitting in our database — see the EmptyState in search/page.tsx.
//
// `not: 'published'` rather than `equals: 'missing_info'` ON PURPOSE. With two
// states they are the same query, but if a third state is ever added this one
// keeps catching it, and the note above about a third state being "neither
// shown nor findable" is exactly the failure that would cause. A record we
// are not publishing should always be explainable to the person who asked
// for it by barcode.
//
// This is NOT a general-purpose "show me the hidden ones" filter. It answers
// one question — did we withhold the exact thing you just asked for — and any
// other reader-facing query still uses PUBLISHED_PRODUCTS.
export const WITHHELD_PRODUCTS = {
  publicationStatus: { not: 'published' },
} satisfies Prisma.ProductWhereInput

// The allowed values, kept in one place so a typo like "published " cannot
// silently create a third state — and a third state here means a record that
// is neither shown nor findable by the pass meant to fix it.
export const PUBLICATION_STATUSES = ['published', 'missing_info'] as const
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number]

// Why a record was withheld, for the publicationNote column. Free text would
// drift, and this note is the only thing telling a human reading the row six
// months from now what to try next.
export const PUBLICATION_NOTES = {
  nameIsCompanyName:
    'Product name duplicates the company name and the record carries nothing else that identifies the product.',
  nameNotRecovered:
    'Product name duplicates the company name; USDA FoodData Central and the package photograph were both checked and neither yielded a name.',
} as const

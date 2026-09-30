// How a product's category should be described to a shopper, based on
// Product.categorySource (see schema.prisma).
//
// Categories from USDA (manufacturer-supplied), Open Food Facts' tags or a
// person are shown as-is. Categories estimated from the product NAME
// (scripts/categorize-products.ts) are right about 4 times in 5 when checked
// against USDA, so they are labelled as estimates rather than stated as fact.
//
// Text only — no styling here, so presentation stays with the page.

export type CategoryDisplay = {
  label: string | null // e.g. "Snack (estimated)"; null when there is no category
  note: string | null // longer explanation, e.g. for a tooltip; null when not needed
  isEstimate: boolean
}

export function describeCategory(category: string | null, categorySource: string | null | undefined): CategoryDisplay {
  if (!category) return { label: null, note: null, isEstimate: false }
  if (categorySource === 'name_estimate') {
    return {
      label: `${category} (estimated)`,
      note: 'Estimated from the product name. No official category was available for this product.',
      isEstimate: true,
    }
  }
  return { label: category, note: null, isEstimate: false }
}

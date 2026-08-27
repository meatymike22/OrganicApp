// Defines the fixed set of valid productType values, and which categories
// are valid under each one. Enforced in application code (forms, ingestion
// scripts) rather than the database — consistent with how sourceType,
// certificationStatus, etc. are handled elsewhere in this schema: a plain
// string with a documented, centrally-maintained set of allowed values,
// so adding a new category is a one-line code change, not a migration.

export const PRODUCT_TYPES = [
  'food_beverage',
  'personal_care',
  'baby_child',
  'household_general',
] as const

export type ProductType = (typeof PRODUCT_TYPES)[number]

// Which categories are valid under each productType. "category" on Product
// should always be one of the values listed for its productType.
export const PRODUCT_CATEGORIES_BY_TYPE: Record<ProductType, string[]> = {
  food_beverage: [
    'Snack',
    'Beverage',
    'Cereal',
    'Dairy',
    'Frozen Fruit',
    'Baby Food',
    'Cookies',
    'Oil',
    'Broth',
    'Baking Ingredient',
    'Flour',
    'Syrup',
    'Prepared Meal',
    'Ice Cream',
    'Fruit bar',
    'Cooking Fat',
  ],
  personal_care: [
    'Toothpaste',
    'Toothbrush',
    'Shampoo',
    'Soap',
    'Lotion',
    'Sunscreen',
  ],
  baby_child: [
    'Baby Bottle',
    'Pacifier',
    'Teether',
    'Toy',
    'Car Seat',
    'Formula',
    'Diaper',
    'Baby Wipes',
  ],
  household_general: [
    'Cookware',
    'Food Storage Container',
    'Cleaning Product',
    'Furniture',
  ],
}

// Which data domains are relevant for each productType — used to decide
// which sections of the product page should render at all.
export const RELEVANT_DOMAINS_BY_TYPE: Record<ProductType, string[]> = {
  food_beverage: ['organicCertification', 'nutritionFacts', 'ingredients', 'regulatoryActions'],
  personal_care: ['ingredients', 'regulatoryActions'],
  baby_child: ['ingredients', 'regulatoryActions', 'materialComposition'],
  household_general: ['regulatoryActions', 'materialComposition'],
}

// Quick validation helper — use when creating/editing a Product to catch
// a mismatched type/category pairing before it hits the database
export function isValidCategoryForType(productType: string, category: string): boolean {
  const validCategories = PRODUCT_CATEGORIES_BY_TYPE[productType as ProductType]
  return validCategories ? validCategories.includes(category) : false
}
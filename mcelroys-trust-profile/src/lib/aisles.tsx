// THE AISLE MAP, and the two pure functions that read it.
//
// Moved out of SiteChrome.tsx on 2026-10-16. It is data and two pure
// lookups, so it never belonged in a component file -- and the client-side
// back link needs `aisleLabel`, which through SiteChrome would have dragged
// TopNav, AisleBar, SiteFooter and SignalTile into the client bundle to get
// at a nine-line function. SiteChrome re-exports all three, so every
// existing import of them keeps working unchanged.

// WHY THERE IS A MAP AT ALL. This used to be a substring match: ?aisle=drink
// ran `category contains 'drink'`. Our categories are words like "Beverage",
// "Juice" and "Coffee & Tea", so the Drinks tab returned ZERO products while
// the database held 40,840 of them. Pantry returned zero as well, with about
// 120,000 products that belong in it. Three of ten tabs were dead and the
// bar is the main navigation on the site.
//
// So each aisle now names the categories it contains, explicitly. It is more
// typing and it is the only version that can be checked: if a category is
// missing from every aisle, it is unreachable from the bar, and that is now
// a visible fact about this list rather than an accident of string matching.
//
// RULES FOR CHANGING THIS
//   - `categories` must hold EXACT `Product.category` values. A typo here is
//     a silently empty aisle, which is the bug this replaced.
//   - An aisle with no products in the database does not belong in the bar.
//     "Cookware" was removed for this reason: we hold one cleaning product
//     and no cookware, and a tab that can never return anything is worse
//     than no tab.
//   - Products with a null category (1,900 today) are reachable by search
//     and by no aisle. That is correct: we do not know what they are.
export const AISLES: { label: string; q: string; categories: string[]; path: React.ReactNode }[] = [
  {
    label: 'Produce',
    q: 'produce',
    categories: ['Fresh Produce'],
    path: (<><path d="M5 19c0-7.5 5.5-13.5 15-14.5C21 15 14.5 19.5 6.5 19.5H5z" /><path d="M5 19c3.5-3.5 7.5-6.5 11.5-8.5" /></>),
  },
  {
    label: 'Meat & fish',
    q: 'meat',
    // Plant-based meat sits beside meat in a shop, so it sits here too.
    categories: ['Meat', 'Canned Meat', 'Seafood', 'Meat Alternative'],
    path: (<><path d="M20.5 12c-2.5 3.4-6 5-9 5-4 0-6.5-2.4-8-5 1.5-2.6 4-5 8-5 3 0 6.5 1.6 9 5z" /><path d="M3.5 7.5L6.5 12l-3 4.5" /></>),
  },
  {
    label: 'Dairy & eggs',
    q: 'dairy',
    // Cheese and Eggs are their own categories. The old substring match on
    // "dairy" found neither, so the Dairy & eggs aisle had no eggs in it.
    categories: ['Dairy', 'Cheese', 'Eggs', 'Dairy Alternative'],
    path: (<><path d="M7 9.5h10V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9.5z" /><path d="M7 9.5L9.5 4h5L17 9.5" /></>),
  },
  {
    label: 'Bakery',
    q: 'bakery',
    categories: ['Bread & Bakery'],
    path: (<><path d="M4 13c0-3.3 3.6-6 8-6s8 2.7 8 6v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4z" /><path d="M9.5 19v-6M14.5 19v-6" /></>),
  },
  {
    label: 'Frozen',
    q: 'frozen',
    // Ice cream is frozen and was not in the Frozen aisle.
    categories: ['Frozen Vegetable', 'Frozen Fruit', 'Ice Cream'],
    path: <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" />,
  },
  {
    label: 'Pantry',
    q: 'pantry',
    // No category contains the word "pantry", so this aisle returned nothing
    // at all while being the largest one in the shop.
    categories: [
      'Sauce', 'Condiment', 'Pasta', 'Cereal', 'Spread', 'Spices & Seasoning',
      'Canned Vegetable', 'Canned Fruit', 'Grains & Rice', 'Soup', 'Broth',
      'Oil', 'Cooking Fat', 'Baking Ingredient', 'Beans & Legumes',
      'Sweetener', 'Syrup', 'Flour',
    ],
    path: (<><path d="M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3v10c0 1.7-3.1 3-7 3s-7-1.3-7-3V7z" /><path d="M5 7c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>),
  },
  {
    label: 'Snacks',
    q: 'snack',
    categories: ['Snack', 'Candy', 'Cookies', 'Chocolate', 'Nuts & Seeds', 'Dessert', 'Toaster Pastry', 'Fruit bar'],
    path: (<><rect x="3" y="8" width="18" height="8" rx="2" /><path d="M8 8v8M13 8v8M18 8v8" /></>),
  },
  {
    label: 'Drinks',
    q: 'drink',
    // The category is "Beverage". `contains 'drink'` matched none of these.
    categories: ['Beverage', 'Juice', 'Coffee & Tea', 'Alcoholic Beverage'],
    path: (<><path d="M6 4h12l-1.2 15.1a2 2 0 0 1-2 1.9H9.2a2 2 0 0 1-2-1.9L6 4z" /><path d="M6.7 10h10.6" /></>),
  },
  {
    label: 'Prepared meals',
    q: 'prepared',
    // 19,920 products that belonged to no aisle under the old matching.
    categories: ['Prepared Meal'],
    path: (<><path d="M3.5 14.5h17" /><path d="M5 14.5a7 7 0 0 1 14 0" /><path d="M12 7.5V5" /><path d="M4 18h16" /></>),
  },
  {
    label: 'Supplements',
    q: 'supplement',
    // Also homeless before: 12,009 products.
    categories: ['Supplement'],
    path: (<><rect x="3.5" y="8.5" width="17" height="7" rx="3.5" /><path d="M12 8.5v7" /></>),
  },
  {
    label: 'Baby',
    q: 'baby',
    categories: ['Baby Food', 'Infant Formula', 'Baby Wipes', 'Baby Bottle', 'Diaper'],
    path: (<><path d="M9 3h6M10 3v2.8A4 4 0 0 0 8 9.2V19a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V9.2A4 4 0 0 0 14 5.8V3" /><path d="M8 12h8" /></>),
  },
]

// The exact Product.category values an aisle covers, or null for an aisle we
// do not recognise. Returning null rather than [] matters: an unknown aisle
// must not silently become "no filter" and show the whole catalogue.
export function aisleCategories(q: string | undefined): string[] | null {
  if (!q) return null
  const aisle = AISLES.find((a) => a.q === q)
  return aisle ? aisle.categories : null
}

// The aisle's display name, for headings and breadcrumbs. Falls back to the
// raw slug so an unknown aisle still reads as something.
export function aisleLabel(q: string | undefined): string | undefined {
  if (!q) return undefined
  return AISLES.find((a) => a.q === q)?.label ?? q
}

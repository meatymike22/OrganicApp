import Link from 'next/link'
import { colors, font, layout } from '@/lib/design'

// The furniture that sits at the top of every page: the dark brand bar with
// the search field, and the aisle bar under it.
//
// EVERY page, as of 2026-10-08, the landing page and /faq included. Those two
// used to hand-write their own dark bar; see TopNav below for what changed
// and what moved out of the header to make one header possible.

// The aisles, in the order a shopper walks a store: the perimeter first
// (produce, meat, dairy, bakery), then the centre aisles, then the non-food
// end. Not alphabetical and not the order the database happens to return —
// a grocery list is a physical route.
// Exported so the Search page's start screen can lay the same aisles out as
// a grid. One list, one order, one set of glyphs — an aisle that reads
// "Meat & fish" in the bar must not read "Meat" in the grid.
// THE AISLE BAR, and the category map behind it.
//
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

// THE HEADER, AND THERE IS ONLY ONE OF IT.
//
// Michael, on the FAQ page, 2026-10-08: "this should be the same despite
// which page we are on."
//
// He was looking at two headers that had grown apart. Every page that holds
// data — search, a product, a company, an ingredient, a recall — used this
// component: wordmark, search box, Companies. The landing page and /faq each
// hand-wrote a different dark bar instead, with anchor links to the landing
// page's own sections and a coloured call-to-action button. Those two had
// even drifted from each other: the same button read "Search products" on
// one and "Browse the database" on the other.
//
// So there is now one header, it is this one, and the two marketing pages
// use it like everything else. Two consequences worth stating, because both
// were decisions:
//
//   1. THE SEARCH BOX IS ON EVERY PAGE NOW, including the landing page. That
//      is the right trade: search is what the site is for, and a visitor who
//      has just read what Rootify does should not have to find a button.
//
//   2. THE LANDING PAGE'S SECTION LINKS LEFT THE HEADER. "What you get",
//      "How it works", "Who we are" and "Pricing" are navigation within one
//      page, not navigation around the site, so putting them in a site-wide
//      header would have printed four dead-ish links on every product page.
//      They moved to a chip row under the hero — which is the pattern /faq
//      already used for its own sections, so this is the site's own idiom
//      rather than a new one.
//
// `active` draws the current page's link as current, for a reader and for a
// screen reader both. It is deliberately not a pathname check: this is a
// server component and knowing the route here would mean making it a client
// one, for an underline.
export function TopNav({
  query,
  active,
}: {
  query?: string
  active?: 'companies' | 'faq'
}) {
  return (
    <div
      style={{
        minHeight: 72,
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: `0 ${layout.gutter}px`,
        background: colors.dark,
        display: 'flex',
        alignItems: 'center',
        gap: 28,
        // Wraps rather than overflows: wordmark, a search box and two links
        // do not fit on a 390px phone in one row, and a header that scrolls
        // sideways is worse than a header two rows tall.
        flexWrap: 'wrap',
        rowGap: 12,
      }}
    >
      <Link
        href="/"
        style={{
          fontFamily: font.display,
          fontSize: 25,
          fontWeight: 700,
          color: colors.paper,
          letterSpacing: '-0.01em',
          textDecoration: 'none',
        }}
      >
        Rootify
      </Link>

      {/* A plain GET form, so a search is a URL a shopper can bookmark,
          share or hit back on. No client-side JavaScript is involved. */}
      <form action="/search" style={{ flexGrow: 1, display: 'flex', maxWidth: 620 }}>
        <label htmlFor="q" className="sr-only">
          Search a product, brand, or barcode
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query ?? ''}
          placeholder="Search a product, brand, or barcode"
          style={{
            flexGrow: 1,
            height: 42,
            boxSizing: 'border-box',
            padding: '0 16px',
            fontFamily: 'inherit',
            fontSize: 15,
            color: colors.ink,
            background: '#FFFFFF',
            border: `1px solid ${colors.dark}`,
            borderRight: 0,
            borderRadius: '6px 0 0 6px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          style={{
            height: 42,
            padding: '0 20px',
            fontSize: 15,
            fontWeight: 600,
            color: '#FFFFFF',
            background: colors.link,
            border: `1px solid ${colors.link}`,
            borderRadius: '0 6px 6px 0',
            cursor: 'pointer',
          }}
        >
          Search
        </button>
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexShrink: 0 }}>
        <HeaderLink href="/companies" current={active === 'companies'}>
          Companies
        </HeaderLink>
        <HeaderLink href="/faq" current={active === 'faq'}>
          FAQ
        </HeaderLink>
      </div>
    </div>
  )
}

function HeaderLink({
  href,
  current,
  children,
}: {
  href: string
  current: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      style={{
        fontSize: 14,
        fontWeight: 600,
        // The current page is brighter rather than underlined: an underline
        // in a 14px dark bar reads as a hover state.
        color: current ? '#FFFFFF' : '#D3D9D4',
        textDecoration: 'none',
        flexShrink: 0,
      }}
    >
      {children}
    </Link>
  )
}

export function AisleBar({ active }: { active?: string }) {
  return (
    <nav
      aria-label="Grocery aisles"
      style={{
        height: 48,
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: `0 ${layout.gutter}px`,
        background: colors.aisleBar,
        borderBottom: `1px solid ${colors.lineStrong}`,
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        overflowX: 'auto',
      }}
    >
      <Link
        href="/search"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          height: 34,
          padding: '0 11px',
          fontSize: 13,
          fontWeight: 700,
          color: colors.ink,
          borderRadius: 6,
          textDecoration: 'none',
          flexShrink: 0,
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        All aisles
      </Link>
      <span style={{ width: 1, height: 20, background: '#D8D1BF', margin: '0 7px', flexShrink: 0 }} aria-hidden />
      {AISLES.map((a) => {
        const isActive = active === a.q
        return (
          <Link
            key={a.q}
            href={`/search?aisle=${a.q}`}
            aria-current={isActive ? 'page' : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 34,
              padding: '0 10px',
              fontSize: 13,
              fontWeight: isActive ? 700 : 400,
              color: isActive ? colors.ink : '#3F4A42',
              background: isActive ? '#E4DCC8' : undefined,
              borderRadius: 6,
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8A8271" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {a.path}
            </svg>
            {a.label}
          </Link>
        )
      })}
    </nav>
  )
}

// The breadcrumb strip. Kept as its own component so the separator and the
// colour of the current page are identical on every screen.
export function Breadcrumb({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <div
      style={{
        height: 44,
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: `0 ${layout.gutter}px`,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        fontSize: 12.5,
        color: colors.ink3,
        borderBottom: `1px solid #EBE6DA`,
      }}
    >
      {trail.map((t, i) => (
        <span key={`${t.label}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          {i > 0 && (
            <span aria-hidden style={{ color: '#C9C2B2' }}>
              /
            </span>
          )}
          {t.href ? <Link href={t.href}>{t.label}</Link> : <span style={{ color: colors.ink }}>{t.label}</span>}
        </span>
      ))}
    </div>
  )
}

// One tile in the signal row at the top of a product or company page: a label,
// a big value, and a line of context under it.
export function SignalTile({
  label,
  value,
  note,
  accent,
  href,
  mono,
}: {
  label: string
  value: React.ReactNode
  note?: string
  // The status colour for the value, when the value carries one.
  accent?: string
  href?: string
  // Numbers and counts are set in the monospace; words are not.
  mono?: boolean
}) {
  const body = (
    <>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: colors.ink2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: mono ? font.mono : font.display,
          fontSize: mono ? 27 : 20,
          fontWeight: mono ? 500 : 600,
          lineHeight: 1.1,
          marginTop: mono ? 9 : 11,
          color: accent ?? colors.ink,
        }}
      >
        {value}
      </div>
      {note && (
        <div style={{ fontSize: 12, lineHeight: 1.4, color: colors.ink3, marginTop: 6 }}>{note}</div>
      )}
    </>
  )

  const style: React.CSSProperties = {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    boxSizing: 'border-box',
    padding: '14px 16px',
    background: colors.card,
    border: `1px solid ${colors.line}`,
    borderRadius: layout.radius,
    textDecoration: 'none',
    color: 'inherit',
    display: 'flex',
    flexDirection: 'column',
  }

  return href ? (
    <Link href={href} style={style}>
      {body}
    </Link>
  ) : (
    <div style={style}>{body}</div>
  )
}

// The footer. Two sentences and a row of links — the legal and sourcing pages
// a reader needs, and nothing written to reassure a brand.
// Attribution required by Open Food Facts' licence (ODbL for the database,
// DbCL for its contents): credit Open Food Facts, link to it, and name the
// licence wherever its data is shown. See compliance/ in the repo.
export function OpenFoodFactsNotice({ style }: { style?: React.CSSProperties }) {
  return (
    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: colors.ink3, ...style }}>
      Product names, ingredients, nutrition and brand text include data from{' '}
      <a href="https://openfoodfacts.org" target="_blank" rel="noopener noreferrer">
        Open Food Facts
      </a>
      , made available under the{' '}
      <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">
        Open Database License (ODbL)
      </a>
      ; individual entries under the{' '}
      <a href="https://opendatacommons.org/licenses/dbcl/1-0/" target="_blank" rel="noopener noreferrer">
        Database Contents License
      </a>
      . Product photographs come from the same source and are used under{' '}
      <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">
        CC BY-SA 3.0
      </a>
      ; each product&rsquo;s own sources page names the photograph it uses.
    </p>
  )
}

export function SiteFooter() {
  const links = [
    { label: 'How we source', href: '/sourcing' },
    { label: 'Corrections', href: '/corrections' },
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
  ]
  return (
    <footer
      style={{
        flexShrink: 0,
        boxSizing: 'border-box',
        marginTop: 40,
        padding: `22px ${layout.gutter}px`,
        borderTop: `1px solid ${colors.line}`,
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 20,
        flexWrap: 'wrap',
        fontSize: 12.5,
        color: colors.ink3,
      }}
    >
      <div>
        <span style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700, color: colors.ink }}>Rootify</span>
        <span style={{ marginLeft: 10 }}>We report public records — not health advice.</span>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            {l.label}
          </Link>
        ))}
      </div>
      <OpenFoodFactsNotice style={{ flexBasis: '100%' }} />
    </footer>
  )
}

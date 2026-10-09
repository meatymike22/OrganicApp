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

// THE BREADCRUMB IS GONE. Michael, across rounds 12, 14 and 15:
// "why is it that if i click on a product in search, the company page shows
// up as history when it was never clicked on?", "why am i getting the
// campbells company in the tab history bar here? i never clicked on the
// campbells page", "again i never clicked on the ingredients page. why is
// this present in the tab history?", and — on the same bar — "this doesnt go
// back to the dairy and eggs filter i applied, it just generally goes back to
// the generic search".
//
// Four complaints, one diagnosis. A breadcrumb shows where a page SITS in a
// hierarchy; he has read it as where he has BEEN every single time. Round 14
// trimmed one entry out of the product trail and the complaint came straight
// back on the next page that had one. The component was not mislabelled or
// mis-ordered — it was answering a question nobody asked, on nine pages.
//
// What he actually wants is the last line: take me back to the list I came
// from, with my filters still on. That is knowable, but not from the current
// URL — a server component cannot see where the reader has been. So the
// origin travels in the link: a search result row links to
// /products/<id>?from=<its own querystring>, and the product page renders
// BackLink from that. No `from`, no link, because arriving from a bookmark
// means there is genuinely nowhere to go back to.
//
// This is deliberately NOT a trail. One link, one destination, and it is the
// destination he asked for.
export function BackLink({ from, fallbackLabel }: { from?: string; fallbackLabel?: string }) {
  if (!from) return null

  // `from` is a querystring we minted ourselves on the originating page, but
  // it arrives through the URL where anyone can retype it, so it is treated
  // as untrusted: parsed, filtered to the parameters Search actually reads,
  // and rebuilt. That makes an open-redirect or a javascript: href
  // impossible — the href is always /search plus known keys.
  let params: URLSearchParams
  try {
    params = new URLSearchParams(from.startsWith('?') ? from.slice(1) : from)
  } catch {
    return null
  }

  // Exactly the keys /search reads, and no others: q, aisle, free (category
  // filters), without (typed exclusions), no (allergens), per, page. Anything
  // else in `from` is dropped rather than forwarded.
  const ALLOWED = ['q', 'aisle', 'free', 'without', 'no', 'per', 'page'] as const
  const FILTER_KEYS = ['free', 'without', 'no'] as const
  const clean = new URLSearchParams()
  for (const key of ALLOWED) {
    const v = params.get(key)
    if (v) clean.set(key, v)
  }

  const qs = clean.toString()
  const href = qs ? `/search?${qs}` : '/search'

  // The label names the list rather than the action, so it reads as a place
  // instead of a browser button.
  const q = clean.get('q') ?? ''
  const aisleName = aisleLabel(clean.get('aisle') ?? undefined)
  const filters = FILTER_KEYS.reduce((n, k) => n + (clean.get(k) ? 1 : 0), 0)
  const label = q
    ? `Back to \u201c${q}\u201d`
    : aisleName
      ? `Back to ${aisleName}`
      : filters > 0
        ? 'Back to your filtered results'
        : (fallbackLabel ?? 'Back to results')

  return (
    <div
      style={{
        height: 44,
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: `0 ${layout.gutter}px`,
        display: 'flex',
        alignItems: 'center',
        fontSize: 12.5,
        borderBottom: `1px solid #EBE6DA`,
      }}
    >
      <Link href={href} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        <svg
          aria-hidden
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 2L3 6l5 4" />
        </svg>
        {label}
      </Link>
    </div>
  )
}

// The other half of the breadcrumb's job, kept because it is the half that
// was never wrong.
//
// Two pages have exactly ONE way in: /products/<id>/sources is reached from
// that product, and /ingredients/<id>/research is reached from that
// ingredient. For those, "where this page sits" and "where you came from"
// are the same answer, so a back link there is honest page history rather
// than a guess — which is what the trail was on every other page.
//
// Same chrome as BackLink so the bar does not change height or style between
// pages; different component because the two carry different guarantees and
// collapsing them would invite someone to use this one where the parent is
// not actually deterministic.
export function BackTo({ href, label }: { href: string; label: string }) {
  return (
    <div
      style={{
        height: 44,
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: `0 ${layout.gutter}px`,
        display: 'flex',
        alignItems: 'center',
        fontSize: 12.5,
        borderBottom: `1px solid #EBE6DA`,
      }}
    >
      <Link href={href} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        <svg
          aria-hidden
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 2L3 6l5 4" />
        </svg>
        {label}
      </Link>
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
// NOT A DISCLAIMER. DO NOT MOVE THIS TO /disclaimer.
//
// The 2026-10-08 sweep took every caveat off the browsing pages at Michael's
// request. This text survived it and has to keep surviving it, because it is
// not a statement about what our records mean — it is the attribution clause
// of two licences we rely on:
//
//   ODbL / DbCL  — the Open Food Facts data: names, ingredients, nutrition.
//   CC BY-SA 3.0 — the product photographs.
//
// Both require the credit to accompany the material. A credit on a separate
// page that the material does not link to is not attribution, so relocating
// this would put the site in breach of the licence on roughly 180,000 product
// photographs and the entire product catalogue. Removing the photographs
// instead is the only alternative.
//
// ProductThumb already refuses to render an image whose source it cannot
// name, for the same reason. Flag the arrangement at legal review; do not
// quietly tidy it away.
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
    // Added 2026-10-08. Every caveat swept off the browsing pages this round
    // landed here, so the link has to be on every page or the sweep would
    // have simply deleted things.
    { label: 'Disclaimer', href: '/disclaimer' },
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
        {/* Michael, 2026-10-08: "please take all disclaimers out everywhere
            that isnt the specific disclaimer page." This said "We report
            public records — not health advice", which is a disclaimer in the
            furniture of every page. The first half is what Rootify IS and is
            worth saying; the second half is now one of the headings on
            /disclaimer, linked to the right. */}
        <span style={{ marginLeft: 10 }}>We report public records.</span>
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

import Link from 'next/link'
import { colors, font, layout } from '@/lib/design'
import { BackBar } from './BackBar'
import { AISLES } from '@/lib/aisles'
// Re-exported so the many existing `from '@/components/SiteChrome'` imports
// of these keep working; they now live in @/lib/aisles. See that file.
export { AISLES, aisleCategories, aisleLabel } from '@/lib/aisles'

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

// CLICKING AN AISLE NO LONGER THROWS YOUR FILTERS AWAY.
//
// Michael, 2026-10-09, twice in one round, once on each filter panel:
// "if i click an aisle filter, this filter is cleared. this also needs to
// be fixed."
//
// He was right and the cause was one line: every aisle link was built as
// `/search?aisle=<x>`, a brand-new URL with nothing else on it. So picking
// an aisle silently discarded the search term, the six ingredient filters,
// any typed exclusions, the allergen selections and the page size. A
// shopper who had set up "no seed oils, no peanuts" and then tapped Pantry
// got plain Pantry and no indication anything had been dropped.
//
// `keep` is the current query state, which only the search page has. It is
// optional because this bar is also on product, company and ingredient
// pages, where there are no filters to preserve and the aisle link should
// start a fresh search.
//
// `page` is deliberately NOT carried over: a different aisle is a different
// result set, and page 7 of the old one means nothing. Same reasoning as
// linkTo() in the search page's rail.
export function AisleBar({ active, keep }: { active?: string; keep?: string }) {
  // Built once per render rather than per link. Returns "/search" with the
  // kept parameters plus this aisle, or without one for "All aisles".
  const aisleHref = (q?: string) => {
    const params = new URLSearchParams(keep ?? '')
    params.delete('aisle')
    params.delete('page')
    if (q) params.set('aisle', q)
    const qs = params.toString()
    return qs ? `/search?${qs}` : '/search'
  }

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
        href={aisleHref()}
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
            href={aisleHref(a.q)}
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

// BackLink MOVED on 2026-10-16 to BackFromUrl.tsx as
// `BackToResultsFromUrl`, where it reads the query string on the client so
// that the pages rendering it can be cached. Its long note on why the
// breadcrumb was removed moved with it. The shared 44px chrome both it and
// BackTo draw is now BackBar.tsx.

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
  return <BackBar href={href} label={label} />
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
    // WHY THIS IS 132 AND NOT 0. Measured on the live company page at 375px
    // on 2026-10-11: with `min-width: 0` the four tiles each took about
    // **31 pixels** and their text was clipped — "Products we list" needed
    // 68px, the number 565 needed 49px.
    //
    // `flex-basis: 0` asks every tile to start from zero width and share
    // the row equally, which is right on a desktop. But a flex item can
    // only wrap once it refuses to shrink any further, and `min-width: 0`
    // told it to shrink indefinitely — so the parent's `flex-wrap: wrap`
    // never engaged and four tiles stayed on one unreadable line.
    //
    // 132px is a floor, not a width: wide enough for the longest label and
    // a five-digit count, narrow enough that two sit side by side on a
    // 375px phone. On a desktop nothing changes, because flex-grow still
    // divides the row equally well above this.
    minWidth: 132,
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
        {/* Michael, 2026-10-20 (_zWAJNVt0JSn): "change this to 'Grounded in
            research.'" The long-form "We report public records -- not health
            advice" is still the wording on the home page and the FAQ, where
            there is room for the second clause. */}
        <span style={{ marginLeft: 10 }}>Grounded in research.</span>
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

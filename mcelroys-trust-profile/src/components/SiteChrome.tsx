import Link from 'next/link'
import { colors, font, layout } from '@/lib/design'

// The furniture that sits at the top of every page inside the app: the dark
// brand bar with the search field, and the aisle bar under it.
//
// The marketing home page does NOT use this — it has a plain nav with no
// search field and no aisles, because someone who has not downloaded the app
// has nothing to search yet.

// The aisles, in the order a shopper walks a store: the perimeter first
// (produce, meat, dairy, bakery), then the centre aisles, then the non-food
// end. Not alphabetical and not the order the database happens to return —
// a grocery list is a physical route.
const AISLES: { label: string; q: string; path: React.ReactNode }[] = [
  { label: 'Produce', q: 'produce', path: (<><path d="M5 19c0-7.5 5.5-13.5 15-14.5C21 15 14.5 19.5 6.5 19.5H5z" /><path d="M5 19c3.5-3.5 7.5-6.5 11.5-8.5" /></>) },
  { label: 'Meat & fish', q: 'meat', path: (<><path d="M20.5 12c-2.5 3.4-6 5-9 5-4 0-6.5-2.4-8-5 1.5-2.6 4-5 8-5 3 0 6.5 1.6 9 5z" /><path d="M3.5 7.5L6.5 12l-3 4.5" /></>) },
  { label: 'Dairy & eggs', q: 'dairy', path: (<><path d="M7 9.5h10V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9.5z" /><path d="M7 9.5L9.5 4h5L17 9.5" /></>) },
  { label: 'Bakery', q: 'bakery', path: (<><path d="M4 13c0-3.3 3.6-6 8-6s8 2.7 8 6v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4z" /><path d="M9.5 19v-6M14.5 19v-6" /></>) },
  { label: 'Frozen', q: 'frozen', path: <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" /> },
  { label: 'Pantry', q: 'pantry', path: (<><path d="M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3v10c0 1.7-3.1 3-7 3s-7-1.3-7-3V7z" /><path d="M5 7c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>) },
  { label: 'Snacks', q: 'snack', path: (<><rect x="3" y="8" width="18" height="8" rx="2" /><path d="M8 8v8M13 8v8M18 8v8" /></>) },
  { label: 'Drinks', q: 'drink', path: (<><path d="M6 4h12l-1.2 15.1a2 2 0 0 1-2 1.9H9.2a2 2 0 0 1-2-1.9L6 4z" /><path d="M6.7 10h10.6" /></>) },
  { label: 'Baby', q: 'baby', path: (<><path d="M9 3h6M10 3v2.8A4 4 0 0 0 8 9.2V19a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V9.2A4 4 0 0 0 14 5.8V3" /><path d="M8 12h8" /></>) },
  { label: 'Cookware', q: 'cookware', path: (<><path d="M3 12h13v1a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-1z" /><path d="M16 12.4l5-1.6" /></>) },
]

export function TopNav({ query }: { query?: string }) {
  return (
    <div
      style={{
        height: 72,
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: `0 ${layout.gutter}px`,
        background: colors.dark,
        display: 'flex',
        alignItems: 'center',
        gap: 28,
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

      <Link
        href="/companies"
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: '#D3D9D4',
          textDecoration: 'none',
          flexShrink: 0,
        }}
      >
        Companies
      </Link>
    </div>
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
      .
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

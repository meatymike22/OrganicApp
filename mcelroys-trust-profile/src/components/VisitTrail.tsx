'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { colors, layout } from '@/lib/design'

// THE PAGES YOU HAVE ACTUALLY OPENED, IN THIS TAB.
//
// Michael, 2026-10-13, on a product page he had reached from a related-products
// shelf: "why isnt the tab history here? i should be able to know exactly what
// tabs i have clicked through this section."
//
// THIS IS NOT THE BREADCRUMB COMING BACK, and the distinction is the entire
// reason it can exist now. The breadcrumb was deleted in round 15 after he
// objected to it four separate times, always the same objection: "i never
// clicked on the ingredients page. why is this present in the tab history?"
// It showed where a page SAT in a hierarchy, and he read it as where he had
// BEEN. It was answering a question nobody asked.
//
// This answers the question he was actually asking. Every entry is a page he
// opened, in the order he opened it, and nothing else can get in.
//
// WHY IT HAS TO BE A CLIENT COMPONENT. A server component cannot see where a
// reader has been. Round 15's answer was to carry the origin in the URL
// (`?from=`), which gives exactly one step back and only when the link that
// got you there bothered to add it — which is why this page had no back link
// at all: it was reached from the related-products shelf, whose cards carry
// no origin. A trail needs state that outlives one navigation, and
// sessionStorage is the only place that is per-tab, which is what "this tab"
// means.
//
// WHY sessionStorage AND NOT localStorage: a trail is a property of a
// browsing session in one tab. localStorage would show a reader the pages
// they opened yesterday, in a different tab, as though they had just clicked
// through them — which is the breadcrumb's mistake wearing different clothes.
//
// NOTHING ABOUT A READER LEAVES THE BROWSER. No cookie, no request, no
// server. The trail is read and written in this tab and dies with it, which
// is why it needs no consent banner and appears nowhere in our records. That
// is a deliberate constraint, not an accident of the implementation: the
// privacy position this project set is that no account is needed to search,
// and a history feature that phoned home would quietly break it.
const KEY = 'rt-trail'

// Five is enough to show the route and short enough to fit one line. A trail
// that wraps to two lines is a navigation element that costs more space than
// the page it sits on.
const MAX = 5

type Stop = { href: string; label: string }

function read(): Stop[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    // Written by this component, but it arrives from storage a reader can
    // edit, so every field is checked before it reaches an href.
    return parsed.filter(
      (s): s is Stop =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as Stop).href === 'string' &&
        typeof (s as Stop).label === 'string' &&
        // Our own paths only. A stored value starting with anything else —
        // "//evil.example", "javascript:" — must never become a link.
        (s as Stop).href.startsWith('/') &&
        !(s as Stop).href.startsWith('//')
    )
  } catch {
    // Private browsing, blocked storage, or a quota error. A missing trail is
    // not a broken page.
    return []
  }
}

export function VisitTrail({ label, children }: { label: string; children?: React.ReactNode }) {
  // `null` means "not yet decided", which is what keeps the server HTML and
  // the first client render identical: both show `children`, the server-side
  // fallback, and the trail replaces it only after the effect has run.
  const [trail, setTrail] = useState<Stop[] | null>(null)

  useEffect(() => {
    const here = `${window.location.pathname}${window.location.search}`
    const prior = read()

    // GOING BACK SHORTENS THE TRAIL, it does not extend it. If this page is
    // already in the trail, the reader has returned to it, so the trail is
    // cut to end here. Without this, clicking back and forth twice produces
    // "Search, Snickers, Sorbitol, Snickers, Sorbitol", which is a log rather
    // than a route.
    const seen = prior.findIndex((s) => s.href === here)
    const next =
      seen >= 0
        ? [...prior.slice(0, seen), { href: here, label }]
        : [...prior, { href: here, label }].slice(-MAX)

    try {
      sessionStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // Storage full or blocked. The trail still renders for this page view.
    }
    setTrail(next)
  }, [label])

  // One stop is not a route — it is just the page you are on. Fall back to
  // whatever the server rendered, which is the `?from=` back link.
  if (!trail || trail.length < 2) return <>{children}</>

  return (
    <nav
      aria-label="Pages you have opened in this tab"
      style={{
        height: 44,
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: `0 ${layout.gutter}px`,
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        fontSize: 12.5,
        borderBottom: `1px solid #EBE6DA`,
      }}
    >
      <svg
        aria-hidden
        width="11"
        height="11"
        viewBox="0 0 12 12"
        fill="none"
        stroke={colors.ink4}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <path d="M8 2L3 6l5 4" />
      </svg>

      {trail.map((stop, i) => {
        const last = i === trail.length - 1
        return (
          <span key={`${stop.href}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            {/* The page you are on is not a link to itself. */}
            {last ? (
              <span style={{ color: colors.ink3, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {stop.label}
              </span>
            ) : (
              <Link
                href={stop.href}
                style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {stop.label}
              </Link>
            )}
            {!last && (
              <span aria-hidden style={{ color: colors.ink4 }}>
                {'›'}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}

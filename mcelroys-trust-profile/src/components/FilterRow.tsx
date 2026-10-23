'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useOptimistic, useTransition, type MouseEvent } from 'react'
import { colors, status } from '@/lib/design'

// ONE FILTER ROW, used by both the ingredient filters and the allergens.
//
// It was written inline in the ingredient list and copied into the allergen
// list in a first draft, which is how the two would have drifted: the drawn
// checkbox, the hover explainer and the on/off weight are presentation and
// have no business being stated twice.
//
// WHY THIS IS NOW A CLIENT COMPONENT, and what that did NOT change.
//
// Michael, 2026-10-21: "when applying the filter the page takes half a second
// to check the box and apply the filter... which seems quite slow."
//
// Measured on the live site: the database query behind a three-filter search
// is 0.341 ms, the server's first byte arrives at 143 ms, and the remaining
// ~500 ms is transferring a 226 KB RSC payload. So the box was not waiting on
// a slow query -- it was waiting on the whole page. Two different defects sit
// inside that half second and they need different fixes:
//
//   1. THE PAYLOAD is the real cost, and shrinking the per-card markup is the
//      fix. Still open; see features-to-add.md.
//   2. THE BOX NOT MOVING is a separate defect, and it is the one that was
//      actually noticed. A control that does not respond until a round trip
//      completes reads as broken even at 200 ms, so no amount of payload work
//      alone would fix the complaint.
//
// This file fixes (2). `useOptimistic` flips the tick immediately, the
// navigation runs inside `useTransition`, and React reverts the optimistic
// value by itself once the server's `on` prop arrives -- including when the
// navigation fails, which is why this is not just local state.
//
// WHAT DELIBERATELY DID NOT CHANGE:
//
//   STILL A REAL <Link> WITH A REAL href. Every filter is still a URL you can
//   paste, bookmark or open in a new tab, and the rail still works with
//   JavaScript off, which is how it was built and is worth keeping. The click
//   handler is an ENHANCEMENT over the link, not a replacement for it --
//   modified clicks fall through untouched so cmd-click still opens a tab.
//
//   NO useSearchParams. `on` and `href` arrive as props from the server page,
//   so this component reads no request-time API. That matters: a client
//   component calling useSearchParams must sit inside <Suspense> or the
//   production build fails, and the de-opt would climb past this row and take
//   the prerender with it. See runbook-serving-and-caching.md section 4b.
export function FilterRow({
  href,
  label,
  what,
  on,
}: {
  href: string
  label: string
  what: string
  on: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [shown, setShown] = useOptimistic(on)

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    // Let the browser have the clicks that mean "somewhere else": new tab,
    // new window, download, middle-click. Intercepting those would be taking
    // something away in exchange for the speed.
    if (e.defaultPrevented) return
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

    e.preventDefault()
    startTransition(() => {
      // Must be inside the transition: React ties the optimistic value's
      // lifetime to it, and that is what reverts the tick if the navigation
      // never lands.
      setShown(!on)
      // `scroll: false` because toggling a filter is not navigating to a new
      // page -- it is changing the list you are already looking at, and
      // jumping to the top loses your place in it.
      router.push(href, { scroll: false })
    })
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      aria-busy={pending || undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 0',
        fontSize: 13,
        textDecoration: 'none',
        color: shown ? colors.ink : colors.ink2,
        fontWeight: shown ? 600 : 400,
      }}
    >
      {/* A drawn box rather than a real checkbox: these are links, so they
          work with JavaScript off and each one is a URL somebody can paste.
          A checkbox would need a form and a submit to do the same job less
          well.

          THE BOX NEVER FADES WHILE PENDING. It is the thing that has to feel
          instant, so it takes the optimistic value at full strength and the
          label beside it carries the "working on it" signal instead. */}
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          flexShrink: 0,
          borderRadius: 3,
          border: `1.5px solid ${shown ? status.confirmed.fg : '#C9C2B2'}`,
          background: shown ? status.confirmed.fg : colors.paper,
          color: colors.paper,
          fontSize: 10,
          lineHeight: 1,
        }}
      >
        {shown ? '✓' : ''}
      </span>
      <span
        style={{
          flexGrow: 1,
          minWidth: 0,
          // The only pending signal, and it is deliberately faint: the tick has
          // already answered "did my click register", so this one only answers
          // "are the results still coming". Anything louder turns every filter
          // click into a flash.
          opacity: pending ? 0.55 : 1,
          transition: 'opacity 120ms linear',
        }}
      >
        {label}
      </span>

      {/* Michael, 2026-10-07: "there needs to be a little hover over
          explainer to explain what each of these broad categories. a little
          'i' symbol would be perfect."
          One line only since r27 -- the long version is at /sourcing#filters,
          linked under each rail section. Native title: keyboard-reachable,
          no state, nothing to hydrate. */}
      <span
        title={what}
        aria-label={what}
        role="img"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          flexShrink: 0,
          borderRadius: '50%',
          border: `1px solid ${colors.ink4}`,
          fontSize: 9.5,
          fontWeight: 700,
          fontStyle: 'italic',
          lineHeight: 1,
          color: colors.ink3,
          cursor: 'help',
        }}
      >
        i
      </span>
    </Link>
  )
}

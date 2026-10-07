import type { ReactNode } from 'react'
import { colors, font, layout, status, type StatusKey } from '@/lib/design'

// A COLLAPSIBLE SECTION — the one expandable on this site.
//
// Built on the native <details> element, so it needs no JavaScript at all:
// no "use client", no hydration, and it still works in a browser with
// scripting off. That matters more here than usual, because the page it sits
// on may be read on a phone in a supermarket aisle.
//
// THE HEADING CARRIES THE COUNT, and the count comes first. Michael: 'Put
// "17 recalls and government notices" and intelligently highlight the number
// of recalls.' A collapsed section has to say how much it is hiding, and
// "Recalls and government notices — 17" makes you read four words before the
// one fact that decides whether to open it. The number leads.
//
// "Intelligently highlight" is `countState`: the number takes that status's
// colour, so 17 recalls is clay and a count of zero is grey. It is still not
// a grading system — the colour says what kind of record it is, not whether
// the product is good — which is why zero drops to neutral rather than going
// green. Nothing on this site is ever green for an absence.
export function Collapsible({
  id,
  title,
  count,
  countState,
  note,
  open = false,
  children,
}: {
  id?: string
  // A noun phrase that reads correctly AFTER a number: "recalls and
  // government notices", not "Recalls and government notices". When there is
  // no count it is capitalised here instead, so callers never have to think
  // about it.
  title: string
  // How many things are inside. `null`/undefined for a section whose
  // contents are not countable; 0 renders as "No <title>".
  count?: number | null
  // Which status colour the number takes. Omit for neutral ink.
  countState?: StatusKey
  // Secondary detail, right-aligned on a wide screen (see .rt-collapse-meta
  // in globals.css, which drops it under the heading on a phone).
  note?: string
  open?: boolean
  children: ReactNode
}) {
  const counted = typeof count === 'number'
  const numberColor = countState && count ? status[countState].fg : colors.ink

  return (
    <details
      id={id}
      className="rt-collapse"
      open={open}
      style={{
        boxSizing: 'border-box',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderRadius: layout.radius,
      }}
    >
      <summary
        style={{
          boxSizing: 'border-box',
          padding: '15px 18px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        {/* Our own chevron rather than the native marker, which cannot be
            positioned or coloured the same way across browsers. It rotates
            on open via .rt-collapse[open], which an inline style cannot do. */}
        <svg
          className="rt-chev"
          aria-hidden
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke={colors.ink3}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ alignSelf: 'center' }}
        >
          <path d="M4 2l5 4-5 4" />
        </svg>

        <span
          style={{
            fontFamily: font.display,
            fontSize: 19,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: colors.ink,
          }}
        >
          {counted ? (
            <>
              <span style={{ color: numberColor, fontWeight: 700 }}>
                {count === 0 ? 'No' : count!.toLocaleString()}
              </span>{' '}
              {title}
            </>
          ) : (
            capitalise(title)
          )}
        </span>

        {note && (
          <span className="rt-collapse-meta" style={{ fontSize: 12.5, color: colors.ink3 }}>
            {note}
          </span>
        )}
      </summary>

      <div style={{ padding: '0 18px 18px' }}>{children}</div>
    </details>
  )
}

// `title` is written to follow a number, so it needs a capital when it does
// not. Done here so no caller has to keep two spellings of the same heading.
function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

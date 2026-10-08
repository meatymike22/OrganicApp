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
  info,
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
  // THE EXPLANATION, BEHIND AN "i" RATHER THAN ABOVE THE CONTENT.
  //
  // Michael, on the flagged-ingredients section, 2026-10-08: "this info
  // should be in the 'i' next to the title. We do not need to show this
  // information it is simply causing text clutter and will turn off the
  // layman."
  //
  // The same control the search filters have carried since round 10, for the
  // same reason. A paragraph explaining what a section means is worth having
  // and is not worth three lines above every reader's first glance at the
  // section itself.
  //
  // It is a native `title`, so it needs no JavaScript and is reachable by
  // keyboard. Anything a reader MUST see to read the section correctly stays
  // in the body — a tooltip is for the explanation, never for the caveat.
  info?: string
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

        {info && <InfoDot text={info} />}

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

// A LIGHTER COLLAPSIBLE, for a row inside a card.
//
// Collapsible above is a section: a bordered card with a 19px serif heading
// and a count. Inside a research card, four of those stacked would be four
// cards inside a card. This is the same native <details>, the same chevron
// and the same CSS classes (which use `>` child selectors, so nesting one in
// the other is safe) with the weight of a list row instead.
//
// Michael, 2026-10-08: "this needs to be seriously condensed and a more fun
// read." This is the mechanism — a labelled paragraph becomes one line you
// can open, rather than a paragraph you have to scroll past. See
// studyOutline.ts for where the labels come from.
export function MiniCollapse({
  label,
  open = false,
  children,
}: {
  label: string
  open?: boolean
  children: ReactNode
}) {
  return (
    <details
      className="rt-collapse"
      open={open}
      style={{ boxSizing: 'border-box', borderTop: `1px solid ${colors.line}` }}
    >
      <summary
        style={{
          boxSizing: 'border-box',
          padding: '10px 0',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
        }}
      >
        <svg
          className="rt-chev"
          aria-hidden
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke={colors.ink3}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 2l5 4-5 4" />
        </svg>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: colors.ink, lineHeight: 1.4 }}>
          {label}
        </span>
      </summary>
      {/* Indented to the chevron's text, so an open row reads as belonging
          to the line that opened it. */}
      <div style={{ padding: '0 0 13px 19px' }}>{children}</div>
    </details>
  )
}

// The "i" circle. Same shape and size as the one on the search filter rail,
// deliberately: two different "more information" affordances on one site is
// one too many.
export function InfoDot({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      role="img"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 15,
        height: 15,
        flexShrink: 0,
        alignSelf: 'center',
        borderRadius: '50%',
        border: `1px solid ${colors.ink4}`,
        fontSize: 10,
        fontWeight: 700,
        fontStyle: 'italic',
        lineHeight: 1,
        color: colors.ink3,
        cursor: 'help',
      }}
    >
      i
    </span>
  )
}

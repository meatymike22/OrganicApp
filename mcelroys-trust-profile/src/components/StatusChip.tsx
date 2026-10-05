import Link from 'next/link'
import { colors, font, layout, status, type StatusKey } from '@/lib/design'
import type { Signal } from '@/lib/productSignals'

// The one component that paints a status colour.
//
// Nothing else in the app should reach into `status` from design.ts directly.
// Funnelling every coloured badge through here means the colour/icon pairing
// can only be wrong in one place, and a new status can't be added without
// deciding what its icon is.

// The icon is doing real work, not decoration: it is what makes the chips
// readable to someone who cannot distinguish the green from the grey. A
// status must never be carried by colour alone.
function Icon({ state }: { state: StatusKey }) {
  const common = {
    width: 11,
    height: 11,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    'aria-hidden': true,
    style: { flexShrink: 0 },
  }
  switch (state) {
    // A tick: we looked, and the record confirms it.
    case 'confirmed':
      return (
        <svg {...common} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      )
    // A dash: we looked, and there is nothing on file. Deliberately the
    // quietest mark in the set — an absence, not a cross.
    case 'nothingOnFile':
    case 'notApplicable':
      return (
        <svg {...common} strokeWidth={3.5} strokeLinecap="round">
          <path d="M6 12h12" />
        </svg>
      )
    // An exclamation in a circle: there is something here to read.
    case 'openResearch':
    case 'recall':
      return (
        <svg {...common} strokeWidth={2.6} strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5M12 16.5h.01" />
        </svg>
      )
    // A question mark: we could not look. Not a judgement on the product.
    case 'unchecked':
      return (
        <svg {...common} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.7 9.4a2.4 2.4 0 1 1 3.3 2.2c-.6.3-1 .9-1 1.6v.3M12 16.6h.01" />
        </svg>
      )
    // A building: who owns the brand.
    case 'ownership':
      return (
        <svg {...common} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20V9l5-3 5 3v11M14 20V13l6-3v10M3 20h18" />
        </svg>
      )
  }
}

export function StatusChip({
  state,
  children,
  title,
  href,
  bold,
}: {
  state: StatusKey
  children: React.ReactNode
  // Hover text. Used for the longer explanation when the chip itself is too
  // narrow to carry it.
  title?: string
  href?: string
  bold?: boolean
}) {
  const s = status[state]
  const inner = (
    <>
      <Icon state={state} />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </span>
    </>
  )

  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    // Without this a chip fills its whole grid column — which is why the
    // owner chip, whose column is 1fr, stretched the width of the row.
    justifySelf: 'start',
    maxWidth: '100%',
    boxSizing: 'border-box',
    padding: state === 'unchecked' ? '2px 8px' : '3px 8px',
    borderRadius: 5,
    border: state === 'unchecked' ? `1px dashed ${s.border}` : undefined,
    background: s.bg,
    color: s.fg,
    fontFamily: font.sans,
    fontSize: 11.5,
    fontWeight: (bold ?? true) ? 700 : 500,
    lineHeight: 1.35,
    textDecoration: 'none',
  }

  if (href) {
    return (
      <Link href={href} title={title} style={style}>
        {inner}
      </Link>
    )
  }
  return (
    <span title={title} style={style}>
      {inner}
    </span>
  )
}

// The five-column strip, used on a search row and again at the top of a
// product page.
//
// WHY THE COLUMNS ARE FIXED WIDTHS
// A shopper comparing two products reads down, not across. If the chips were
// laid out with flex-wrap, "Organic" would sit in a different place on every
// row and comparing two products would mean hunting for the same fact twice.
// Fixed columns mean the third chip is always the organic answer, whatever it
// says — which is also why every product gets all five cells even when the
// answer is "doesn't apply".
export const SIGNAL_COLUMNS = '118px 118px 118px 118px 1fr'

export function SignalStrip({ signals }: { signals: Signal[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: SIGNAL_COLUMNS,
        gap: 6,
        alignItems: 'center',
      }}
    >
      {signals.map((sig) => (
        <StatusChip
          key={sig.column}
          state={sig.state}
          href={sig.href}
          title={[sig.detail, sig.asOf ? `Read ${sig.asOf}` : null].filter(Boolean).join(' ')}
          bold={sig.state !== 'nothingOnFile' && sig.state !== 'notApplicable'}
        >
          {sig.label}
        </StatusChip>
      ))}
    </div>
  )
}

// The little column header that sits above a list of rows. Without it, a grey
// chip in the third slot is only meaningful if you already know the third
// slot is organic — the header is what makes the column self-describing.
export function SignalHeader() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 15,
        alignItems: 'center',
        boxSizing: 'border-box',
        // Lines the labels up with the chips below: 7px of coloured left
        // border plus 16px of card padding on the left, 1px hairline plus
        // 16px on the right. Change the row's border width and this moves.
        padding: '2px 17px 0 23px',
      }}
    >
      <div style={{ width: 66, flexShrink: 0 }} />
      <div
        style={{
          flexGrow: 1,
          minWidth: 0,
          display: 'grid',
          gridTemplateColumns: SIGNAL_COLUMNS,
          gap: 6,
          fontFamily: font.sans,
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: colors.ink4,
        }}
      >
        <span>Flagged</span>
        <span>Recalls</span>
        <span>Organic</span>
        <span>Non-GMO</span>
        <span>Owner</span>
      </div>
      <span style={{ width: 14, flexShrink: 0 }} />
    </div>
  )
}

// WHAT THE FIVE COLOURS MEAN — written once, used by both the compact inline
// legend and the full side key, so the two can never say different things.
//
// `term` is ONE WORD, and it is the same word the column header and the chip
// use: "Flagged" here is "Flagged" in the header and "6 flagged" on the chip.
// A key that paraphrases the thing it is keying makes the reader translate.
//
// The distinction between the last two is the one Rootify cannot afford to
// blur: "Not on file" means we looked and the record is empty, "Unknown"
// means we could not look. Collapsing those turns a gap in our data into a
// claim about the company.
export const STATUS_MEANINGS: { state: StatusKey; term: string; note: string }[] = [
  {
    state: 'confirmed',
    term: 'Confirmed',
    note: 'We checked the public record and it confirms this.',
  },
  {
    state: 'nothingOnFile',
    term: 'Not on file',
    note: 'We checked and found no record. Not a mark against the product.',
  },
  {
    state: 'openResearch',
    term: 'Flagged',
    note: 'There is open or conflicting research on file. Worth reading, not a verdict.',
  },
  {
    state: 'recall',
    term: 'Recalls',
    note: 'A government recall notice is on the public record.',
  },
  {
    state: 'unchecked',
    term: 'Unknown',
    note: 'We could not check, or nothing was published for us to read. This says nothing about the product.',
  },
]

// THE SIDE KEY. A standing panel in the rail, so the meanings are on screen
// the whole time a shopper is scrolling rows rather than scrolled off the top.
//
// Both the term and its explanation are set in the status colour, which is
// what makes the panel readable as a key rather than as five paragraphs. It
// sits on the white card and not the warm panel on purpose: on `colors.panel`
// the clay drops to a 4.41 contrast ratio and the grey to 4.58, and on white
// the worst of the five is 5.21 — all above the 4.5 threshold.
export function StatusKeyPanel() {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        padding: '14px 15px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderRadius: layout.radius,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: colors.ink2,
        }}
      >
        What the colors mean
      </div>

      <dl style={{ margin: '11px 0 0', display: 'flex', flexDirection: 'column', gap: 11 }}>
        {STATUS_MEANINGS.map((e) => (
          <div key={e.state}>
            <dt
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 12.5,
                fontWeight: 700,
                color: status[e.state].fg,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 3,
                  background: status[e.state].fg,
                  flexShrink: 0,
                }}
              />
              {e.term}
            </dt>
            <dd
              style={{
                margin: '3px 0 0 18px',
                fontSize: 12,
                lineHeight: 1.45,
                color: status[e.state].fg,
              }}
            >
              {e.note}
            </dd>
          </div>
        ))}
      </dl>

      <p style={{ margin: '12px 0 0', fontSize: 11.5, lineHeight: 1.45, color: colors.ink4 }}>
        Colors are not a grading system. They say what the record says, not
        whether a product is good.
      </p>
    </div>
  )
}

// The compact inline legend — one row of swatches, no explanations. Still used
// at the top of a product page, where there is no rail to put a panel in.
export function StatusLegend() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '7px 13px',
        fontFamily: font.sans,
        fontSize: 12,
        color: colors.ink2,
      }}
    >
      {STATUS_MEANINGS.map((e) => (
        <span
          key={e.state}
          title={e.note}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: status[e.state].fg,
              flexShrink: 0,
            }}
          />
          {e.term}
        </span>
      ))}
      <span style={{ color: colors.ink4 }}>Colors are not a grading system.</span>
    </div>
  )
}

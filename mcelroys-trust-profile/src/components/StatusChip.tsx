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
// 126px, not 118px: the organic chip now reads "Maker certified" rather than
// "Organic" (see organicSignal in productSignals.ts), and at 118px that
// ellipsised. A status chip that truncates is worse than a wide column.
export const SIGNAL_COLUMNS = '126px 126px 126px 126px 1fr'

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
export function SignalHeader({ thumbWidth = 66 }: { thumbWidth?: number | string }) {
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
      {/* A spacer the exact width of the row's thumbnail, so the column
          labels sit over their chips. It takes the SAME value the thumbnail
          does — including a clamp() — because a fluid thumbnail with a fixed
          spacer would drift out of alignment at every window size but one. */}
      <div style={{ width: thumbWidth, flexShrink: 0 }} />
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
// WHAT EACH COLOUR MEANS, in as few words as will carry it.
//
// Michael, 2026-10-07: "The descriptions of each color needs to be much more
// concise." The notes had grown into sentences, and a key made of sentences
// is not a key — you read it once and then stop looking at it, which is the
// opposite of what a standing panel is for.
//
// So `note` is now a phrase, and the full sentence moved to `title`, which
// the panel puts on hover. The precise meaning is one hover away and the
// scannable version is the one on screen.
//
// The wording of `unchecked` is the one to leave alone. It covers two facts —
// nobody looked, and nothing was published to look at — and any phrasing that
// picks one of them turns a gap in our data into a claim about a company.
export const STATUS_MEANINGS: { state: StatusKey; term: string; note: string; title: string }[] = [
  {
    state: 'confirmed',
    term: 'Confirmed',
    note: 'The record says so',
    title: 'We checked the public record and it confirms this.',
  },
  {
    state: 'nothingOnFile',
    term: 'Not on file',
    note: 'We looked, found nothing',
    title: 'We checked and found no record. Not a mark against the product.',
  },
  {
    state: 'openResearch',
    term: 'Flagged',
    note: 'Worth reading about',
    title: 'There is open or conflicting research on file. Worth reading, not a verdict.',
  },
  {
    state: 'recall',
    term: 'Recalls',
    note: 'A notice exists',
    title: 'A government recall notice is on the public record.',
  },
  {
    state: 'unchecked',
    term: 'Unknown',
    note: 'We could not check',
    title:
      'We could not check, or nothing was published for us to read. This says nothing about the product.',
  },
]

// THE SIDE KEY. A standing panel in the rail, so the meanings are on screen
// the whole time a shopper is scrolling rows rather than scrolled off the top.
//
// Both the term and its phrase are set in the status colour, which is what
// makes the panel readable as a key rather than as five paragraphs. It
// sits on the white card and not the warm panel on purpose: on `colors.panel`
// the clay drops to a 4.41 contrast ratio and the grey to 4.58, and on white
// the worst of the five is 5.21 — all above the 4.5 threshold.
export function StatusKeyPanel() {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        padding: '13px 15px',
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

      {/* ONE LINE PER COLOUR: swatch, term, phrase. It used to be a term on
          one line and a sentence indented under it — five stacked paragraphs,
          which is a thing you read once and then ignore. A key has to stay
          scannable at a glance or it stops being consulted at all.

          The full sentence is on `title`, so the precise meaning is a hover
          away. Nothing was removed; it stopped being in the way. */}
      <dl style={{ margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {STATUS_MEANINGS.map((e) => (
          // Michael, 2026-10-07, on the Recalls row: the phrase "should be
          // vertically under 'Recalls'. Right now it is placed to the right,
          // and it is incongruent with the other rows."
          //
          // He was looking at a wrapping bug. The row was one flex line with
          // flexWrap, so whether the phrase sat beside the term or under it
          // depended on how long the term happened to be: "Recalls" left room
          // and "Not on file" did not. Five rows, two different shapes, set by
          // string length. A grid fixes the shape for every row regardless of
          // what the words are.
          <div
            key={e.state}
            title={e.title}
            style={{
              display: 'grid',
              gridTemplateColumns: '10px 1fr',
              columnGap: 7,
              rowGap: 1,
              alignItems: 'baseline',
              fontSize: 12.5,
              lineHeight: 1.35,
              color: status[e.state].fg,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: status[e.state].fg,
                flexShrink: 0,
                // Nudged down so a square sits on the text baseline rather
                // than hanging off the cap height.
                transform: 'translateY(1px)',
              }}
            />
            <dt style={{ fontWeight: 700 }}>{e.term}</dt>
            {/* Column 2 of row 2: under the term, never under the swatch. */}
            <dd style={{ gridColumn: 2, margin: 0, opacity: 0.85 }}>{e.note}</dd>
          </div>
        ))}
      </dl>

      <p style={{ margin: '11px 0 0', fontSize: 11.5, lineHeight: 1.45, color: colors.ink4 }}>
        Not a grading system. These say what the record says, not whether a
        product is good.
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
          title={e.title}
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

// WHAT THE RECORD SAYS — the product page's signal table.
//
// Michael, 2026-10-07: "how are they supposed to know what isn't on file
// here? Nothing is labeled. There should be an aesthetic table for the layman
// so they can understand what all of this is."
//
// It replaces two things that used to sit on the product page: a bare
// `SignalStrip` of chips with no labels, and a row of `SignalTile`s below the
// hero showing the same five signals again. Two copies of one fact, the
// unlabelled one first.
//
// THREE RULES THIS TABLE EXISTS TO ENFORCE:
//
//   1. Every row names its question. A chip reading "Not on file" is unusable
//      on its own — not on file about WHAT?
//   2. Every row shows its state in words AND colour, never colour alone. The
//      colour is the glance; the words are the answer.
//   3. A row is present even when there is nothing on file. A missing row
//      would make "we checked and found nothing" indistinguishable from "we
//      never asked", which is the one distinction this site is built on.
//
// Rows link to the section that answers them, so the table is also the page's
// table of contents and its order has to match the section order.
export function SignalTable({
  rows,
}: {
  rows: { question: string; signal: Signal; href?: string }[]
}) {
  return (
    <dl
      style={{
        margin: 0,
        boxSizing: 'border-box',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderRadius: layout.radius,
        overflow: 'hidden',
        maxWidth: 620,
      }}
    >
      {rows.map((row, i) => {
        const body = (
          <>
            <dt
              style={{
                flexBasis: 150,
                flexShrink: 0,
                fontSize: 13,
                fontWeight: 600,
                color: colors.ink,
              }}
            >
              {row.question}
            </dt>
            <dd style={{ margin: 0, flexShrink: 0 }}>
              <StatusChip state={row.signal.state}>{row.signal.label}</StatusChip>
            </dd>
            {/* THE ONE-LINE REASON, which is where "not certified" stops
                being a verdict and becomes a statement about a register.
                It prints `short` and falls back to `detail`. Michael,
                2026-10-07: "this is too much... this description causes too
                much clutter. Add it to another page that is used for users to
                understand more about what we are doing." The long version is
                the glossary on /sourcing, linked under the table. */}
            <dd
              style={{
                margin: 0,
                flexGrow: 1,
                flexBasis: 220,
                minWidth: 0,
                fontSize: 12,
                lineHeight: 1.45,
                color: colors.ink3,
              }}
            >
              {row.signal.short ?? row.signal.detail ?? ''}
            </dd>
          </>
        )

        const style: React.CSSProperties = {
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
          padding: '10px 14px',
          borderTop: i === 0 ? undefined : `1px solid ${colors.line}`,
          textDecoration: 'none',
          color: 'inherit',
        }

        return row.href ? (
          <Link key={row.question} href={row.href} style={style}>
            {body}
          </Link>
        ) : (
          <div key={row.question} style={style}>
            {body}
          </div>
        )
      })}
    </dl>
  )
}

// The line under the table. One link, not six tooltips: the full wording for
// every row lives in one place a reader can actually read, and nothing on the
// product page has to carry a paragraph to be honest.
export function SignalTableNote() {
  return (
    <p style={{ margin: '9px 0 0', fontSize: 11.5, lineHeight: 1.5, color: colors.ink4, maxWidth: 620 }}>
      Each row says what a public record says, never whether a product is good.{' '}
      <Link href="/sourcing#glossary" style={{ color: colors.link }}>
        What each answer means
      </Link>
      .
    </p>
  )
}

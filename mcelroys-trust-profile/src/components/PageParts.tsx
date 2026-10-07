import { colors, font, isoDate, status } from '@/lib/design'

// Small building blocks shared by the detail pages (company, ingredient).
// They are the same pieces the product page draws, kept in one file so the
// pages can't drift apart. Colour still only comes from design.ts.

// A section heading: serif title, the source of the section on the right,
// and the heavy rule under both.
export function SectionHead({ title, source, id }: { title: string; source?: string; id?: string }) {
  return (
    <div
      id={id}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 16,
        borderBottom: `2px solid ${colors.ink}`,
        paddingBottom: 9,
        // So an anchor link doesn't tuck the heading under the top of the
        // viewport.
        scrollMarginTop: 16,
      }}
    >
      <h2 style={{ margin: 0, fontFamily: font.display, fontSize: 22, fontWeight: 600 }}>{title}</h2>
      {source && <span style={{ fontSize: 12, color: colors.ink3, textAlign: 'right' }}>{source}</span>}
    </div>
  )
}

// A tinted box for statements that aren't a record: an unverified notice,
// a "nobody looked yet" explanation.
export function Callout({ state, children }: { state: keyof typeof status; children: React.ReactNode }) {
  const s = status[state]
  return (
    <div
      style={{
        boxSizing: 'border-box',
        padding: '12px 15px',
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 7,
        fontSize: 13,
        lineHeight: 1.6,
        color: colors.ink2,
      }}
    >
      {children}
    </div>
  )
}

// A plain label for a description (a study's type, a filing's form). Neutral
// on purpose: descriptions are not statuses, so they get no status colour.
// `nested`: drawn on the panel tint, so it switches to white to stay visible.
export function Tag({ children, nested }: { children: React.ReactNode; nested?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 8px',
        background: nested ? colors.card : '#EFEADD',
        borderRadius: 5,
        fontSize: 11.5,
        fontWeight: 600,
        color: colors.ink2,
        lineHeight: 1.35,
      }}
    >
      {children}
    </span>
  )
}

// Where a fact came from and when we read it. Every fact on a detail page
// carries one; this is the one place that prints it.
// WHERE A RECORD CAME FROM, AND WHEN WE READ IT.
//
// This used to end with "checked by a person <date>" or, far more often,
// "not yet checked by a person". Michael, 2026-10-06: "we don't need to have
// the recall checked by a person, nor do we want to include this text here.
// Having it pulled from a database is good for now."
//
// He is right, and the substance matters more than the clutter: a review
// field is a promise, and across 416,382 products it was empty. Printing
// "not yet checked by a person" on every line advertised a review process
// that does not exist. The honest line is the one that is left — here is the
// record, here is the date we read it.
//
// The reviewDate columns stay in the schema for the day there IS a review
// step. Nothing reads them, so nothing can imply one already happened. Do
// not reintroduce a reviewedAt prop here without a real process behind it.
export function SourceLine({
  url,
  label,
  readAt,
}: {
  url?: string | null
  label: string
  readAt?: Date | string | null
}) {
  const read = isoDate(readAt)
  return (
    <div style={{ fontSize: 11.5, color: colors.ink4, marginTop: 7, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      ) : (
        <span>{label}</span>
      )}
      {read && <span style={{ fontFamily: font.mono }}>read {read}</span>}
    </div>
  )
}

// The small uppercase label at the top of a sidebar box or card.
export function Eyebrow({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: color ?? colors.ink2,
      }}
    >
      {children}
    </div>
  )
}

// A company's monogram tile — the company has no glyph of its own (category
// belongs to products), so its first letter stands in, quietly.
export function Monogram({ name, size = 92 }: { name: string; size?: number }) {
  const letter = (name.match(/[A-Za-z0-9]/)?.[0] ?? '·').toUpperCase()
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        boxSizing: 'border-box',
        background: '#F2EDE2',
        border: `1px solid ${colors.line}`,
        borderRadius: size >= 60 ? 10 : 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span style={{ fontFamily: font.display, fontSize: Math.round(size / 3), fontWeight: 700, color: '#A29A88' }}>
        {letter}
      </span>
    </div>
  )
}

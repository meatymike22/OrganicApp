import type { ReactNode } from 'react'
import { colors, font, layout } from '@/lib/design'

// A COLLAPSIBLE SECTION.
//
// Built on the native <details> element, so it needs no JavaScript at all —
// no "use client", no hydration, and it still works in a browser with
// scripting off. That matters more here than usual: the page it sits on is
// the one a shopper may be reading on a phone in a supermarket aisle.
//
// `count` goes in the summary because a collapsed section has to say how
// much it is hiding. "Recalls and government notices" tells you nothing
// about whether to open it; "Recalls and government notices — 3" does.
export function Collapsible({
  id,
  title,
  count,
  note,
  open = false,
  children,
}: {
  id?: string
  title: string
  // How many things are inside. `null` for a section whose contents are not
  // countable; 0 renders as a plain "none" and the section does not open.
  count?: number | null
  note?: string
  open?: boolean
  children: ReactNode
}) {
  return (
    <details
      id={id}
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
          listStyle: 'none',
        }}
      >
        <span style={{ fontFamily: font.display, fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>
          {title}
        </span>
        {typeof count === 'number' && (
          <span style={{ fontFamily: font.mono, fontSize: 13, color: colors.ink3 }}>{count}</span>
        )}
        {note && <span style={{ fontSize: 12.5, color: colors.ink3 }}>{note}</span>}
      </summary>
      <div style={{ padding: '0 18px 18px' }}>{children}</div>
    </details>
  )
}

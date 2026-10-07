'use client'

import { useState } from 'react'
import { colors, font } from '@/lib/design'

// THE BARCODE, HIDDEN UNTIL ASKED FOR.
//
// Michael, 2026-10-06: "Denote that this is a barcode number... Normal users
// will not care about this." Then, 2026-10-07: "please make the barcode
// number revealable or when you hover over 'barcode' it pops up and then give
// the user the ability to reveal it or copy it."
//
// So the number is no longer on the page by default. What shows is the word
// BARCODE and two small actions. Hovering shows the digits as a tooltip —
// which costs nothing and answers the idle question — and Show puts them on
// the page for someone who wants to select them by hand. Copy never needs the
// digits revealed at all, because the one person who wants a barcode usually
// wants it in their clipboard, not on their screen.
//
// WHY IT IS NOT JUST DELETED. It is the only string on the page that lets
// someone look this exact product up anywhere else, including on Open Food
// Facts to correct it. A transparency site that hides the identifier its own
// records are keyed by is being precious. Hidden by default, one click away,
// is the honest middle.
export function CopyBarcode({ value }: { value: string }) {
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {/* `title` is the hover-to-peek. A native tooltip rather than a custom
          popover on purpose: it works on the keyboard, it never covers
          anything on a phone because touch devices do not fire it, and it
          needs no state. */}
      <span
        title={`Barcode ${value}`}
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: colors.ink4,
          cursor: 'help',
          borderBottom: `1px dotted ${colors.line}`,
        }}
      >
        Barcode
      </span>

      {shown ? (
        <span style={{ fontFamily: font.mono, fontSize: 13, color: colors.ink3 }}>{value}</span>
      ) : (
        <button type="button" onClick={() => setShown(true)} style={linkButton}>
          Show
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          // clipboard is unavailable over plain http and in some embedded
          // browsers. Failing quietly is right: Show puts the digits on the
          // page where they can be selected by hand, so a broken copy button
          // must not throw.
          navigator.clipboard
            ?.writeText(value)
            .then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            })
            .catch(() => {})
        }}
        style={{ ...linkButton, color: copied ? colors.ink2 : colors.link }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}

const linkButton: React.CSSProperties = {
  padding: 0,
  fontFamily: 'inherit',
  fontSize: 11.5,
  fontWeight: 600,
  color: colors.link,
  background: 'transparent',
  border: 0,
  borderBottom: '1px solid currentColor',
  lineHeight: 1.2,
  cursor: 'pointer',
}

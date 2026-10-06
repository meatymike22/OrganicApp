'use client'

import { useState } from 'react'
import { colors, font } from '@/lib/design'

// COPY A BARCODE.
//
// The only client component on a product page, and it exists for a specific
// complaint: the bare 13-digit number under the product name reads as noise
// to a shopper who will never type it. It is genuinely useful to the one
// reader who wants to look the product up somewhere else — so it stays, but
// it says what it is and it is one click to take with you.
//
// Deliberately NOT a toast or an animation. It swaps its own label for two
// seconds and swaps back.
export function CopyBarcode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: colors.ink4,
        }}
      >
        Barcode
      </span>
      <span style={{ fontFamily: font.mono, fontSize: 13, color: colors.ink3 }}>{value}</span>
      <button
        type="button"
        onClick={() => {
          // clipboard is unavailable over plain http and in some embedded
          // browsers. Failing quietly is right: the number is on screen and
          // can be selected by hand, so a broken copy button must not throw.
          navigator.clipboard
            ?.writeText(value)
            .then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            })
            .catch(() => {})
        }}
        style={{
          padding: '2px 8px',
          fontFamily: 'inherit',
          fontSize: 11,
          fontWeight: 600,
          color: copied ? colors.ink2 : colors.link,
          background: 'transparent',
          border: `1px solid ${colors.line}`,
          borderRadius: 5,
          cursor: 'pointer',
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}

import Link from 'next/link'
import { layout } from '@/lib/design'

// THE BACK BAR, ONE DEFINITION.
//
// BackLink and BackTo each carried their own copy of this markup -- 742
// bytes, byte-for-byte identical, verified before they were collapsed. The
// comment on BackTo said "same chrome as BackLink so the bar does not change
// height or style between pages", which is a correctness requirement that
// depended on someone remembering to edit both.
//
// That is the bug class this project has now hit five times (Collapsible in
// r19, the duplicated grid template in r20, the legend/row swatch pair, the
// ingredients/[id] components in r20). The answer has been the same every
// time: make it one component.
//
// The DIFFERENT GUARANTEES the old comment wanted to keep apart are real,
// and they still are: they live in the callers, which is where they belong.
// BackTo is for a page with one deterministic parent. The FromUrl variants
// in BackFromUrl.tsx are for an origin carried in the URL and therefore
// untrusted. Only the 44px of chrome is shared.
export function BackBar({ href, label }: { href: string; label: string }) {
  return (
    <div
      style={{
        height: 44,
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: `0 ${layout.gutter}px`,
        display: 'flex',
        alignItems: 'center',
        fontSize: 12.5,
        borderBottom: `1px solid #EBE6DA`,
      }}
    >
      <Link href={href} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        <svg
          aria-hidden
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 2L3 6l5 4" />
        </svg>
        {label}
      </Link>
    </div>
  )
}

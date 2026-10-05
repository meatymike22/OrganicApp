import { colors, thumbTint } from '@/lib/design'

// The product thumbnail WHEN THERE IS NO PHOTOGRAPH.
//
// Products with a photo render through ProductThumb.tsx, which falls back to
// this component. That makes this the empty state, and it is a deliberate
// one rather than a placeholder to be embarrassed about: an aisle glyph on a
// tinted square tells a shopper at a glance whether they are looking at a
// cereal or a dish brush, which a grey box would not.
//
// It is also the state for a photo we cannot credit. Open Food Facts images
// are CC-BY-SA, and ProductThumb refuses to show an image whose source it
// cannot name — so a missing credit lands here rather than on the page.
//
// THE RULE THIS COMPONENT EXISTS TO KEEP
// Category never takes a status colour. Green means "we checked and the
// record confirms it" everywhere in this app, and a green thumbnail on a
// vegetable would quietly turn that into "healthy". So the aisle is carried
// by the glyph plus three near-neutral tints, and nothing more.

// Which of the three tints an aisle sits on.
type Tint = keyof typeof thumbTint

// Maps a Product.category (see PRODUCT_CATEGORIES_BY_TYPE in
// src/lib/productTypes.ts) onto a glyph. Matching is done on substrings
// rather than an exhaustive list so that a new category added to
// productTypes.ts gets a sensible glyph without a change here — and falls
// back to a plain package rather than to nothing.
const GLYPHS: { match: RegExp; tint: Tint; path: React.ReactNode }[] = [
  {
    match: /cereal|breakfast|granola|oat/i,
    tint: 'ambient',
    path: (
      <>
        <path d="M3 11h16v1a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7v-1z" />
        <path d="M15 8c0-2 2-2 2-4" />
      </>
    ),
  },
  {
    match: /snack|cracker|chip|bar|cookie|candy|confection/i,
    tint: 'ambient',
    path: (
      <>
        <rect x="3" y="8" width="18" height="8" rx="2" />
        <path d="M8 8v8M13 8v8M18 8v8" />
      </>
    ),
  },
  {
    match: /frozen|ice cream|dessert/i,
    tint: 'chilled',
    path: <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" />,
  },
  {
    match: /dairy|milk|cheese|yogurt|egg|butter/i,
    tint: 'chilled',
    path: (
      <>
        <path d="M7 9.5h10V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9.5z" />
        <path d="M7 9.5L9.5 4h5L17 9.5" />
      </>
    ),
  },
  {
    match: /soup|canned|pantry|sauce|condiment|jar|bean/i,
    tint: 'ambient',
    path: (
      <>
        <path d="M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3v10c0 1.7-3.1 3-7 3s-7-1.3-7-3V7z" />
        <path d="M5 7c0 1.7 3.1 3 7 3s7-1.3 7-3" />
      </>
    ),
  },
  {
    match: /pasta|rice|grain|noodle|flour/i,
    tint: 'ambient',
    path: <path d="M6 4v16M10 4v16M14 4v16M18 4v16" />,
  },
  {
    match: /oil|vinegar|dressing/i,
    tint: 'ambient',
    path: (
      <>
        <path d="M10 3h4v3l4 4v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V10l4-4V3z" />
        <path d="M6 13h12" />
      </>
    ),
  },
  {
    match: /drink|beverage|juice|water|soda|coffee|tea/i,
    tint: 'ambient',
    path: (
      <>
        <path d="M6 4h12l-1.2 15.1a2 2 0 0 1-2 1.9H9.2a2 2 0 0 1-2-1.9L6 4z" />
        <path d="M6.7 10h10.6" />
      </>
    ),
  },
  {
    match: /produce|fruit|vegetable|fresh/i,
    tint: 'chilled',
    path: (
      <>
        <path d="M5 19c0-7.5 5.5-13.5 15-14.5C21 15 14.5 19.5 6.5 19.5H5z" />
        <path d="M5 19c3.5-3.5 7.5-6.5 11.5-8.5" />
      </>
    ),
  },
  {
    match: /meat|fish|poultry|seafood|deli/i,
    tint: 'chilled',
    path: (
      <>
        <path d="M20.5 12c-2.5 3.4-6 5-9 5-4 0-6.5-2.4-8-5 1.5-2.6 4-5 8-5 3 0 6.5 1.6 9 5z" />
        <path d="M3.5 7.5L6.5 12l-3 4.5" />
      </>
    ),
  },
  {
    match: /bottle|baby|toddler|infant|formula|diaper|wipe/i,
    tint: 'nonFood',
    path: (
      <>
        <path d="M9 3h6M10 3v2.8A4 4 0 0 0 8 9.2V19a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V9.2A4 4 0 0 0 14 5.8V3" />
        <path d="M8 12h8" />
      </>
    ),
  },
  {
    match: /cookware|pan|pot|utensil|kitchen/i,
    tint: 'nonFood',
    path: (
      <>
        <path d="M3 12h13v1a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-1z" />
        <path d="M16 12.4l5-1.6" />
      </>
    ),
  },
  {
    match: /clean|detergent|soap|household/i,
    tint: 'nonFood',
    path: (
      <>
        <path d="M8 3h5l1 5H7l1-5z" />
        <path d="M6.5 8h8L16 21H5L6.5 8z" />
      </>
    ),
  },
  {
    match: /personal|shampoo|lotion|cosmetic|skin|hair|toothpaste/i,
    tint: 'nonFood',
    path: (
      <>
        <path d="M9 3h6v4l2 3v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V10l2-3V3z" />
        <path d="M7 14h10" />
      </>
    ),
  },
]

// The fallback: a plain package. Shown when a product has no category, or a
// category none of the patterns above recognise. An honest shrug beats
// guessing a glyph that would tell a shopper the wrong thing.
const FALLBACK = {
  tint: 'ambient' as Tint,
  path: (
    <>
      <path d="M4 8l8-4 8 4v8l-8 4-8-4V8z" />
      <path d="M4 8l8 4 8-4M12 12v8" />
    </>
  ),
}

function pick(category: string | null | undefined, productType: string | null | undefined) {
  const haystack = `${category ?? ''} ${productType ?? ''}`
  return GLYPHS.find((g) => g.match.test(haystack)) ?? FALLBACK
}

export function CategoryGlyph({
  category,
  productType,
  size = 66,
  // The accessible name. Passed the product's name by its caller so a screen
  // reader announces "Frosted Cherry Toaster Pastries", not "breakfast icon".
  label,
}: {
  category: string | null | undefined
  productType?: string | null
  // A number for a fixed square, or any CSS length for one that scales with
  // the window — "clamp(72px, 8vw, 104px)" and the like.
  //
  // WHY THE WHOLE THING IS SIZED IN em. Everything inside scales off the
  // square's own font-size, so one value sets the box, the icon and the
  // corner radius together. With a plain pixel number you can multiply; with
  // clamp() you cannot, and this component has to support both because a
  // search row wants a fluid thumbnail and a dense list wants a fixed one.
  size?: number | string
  label?: string
}) {
  const glyph = pick(category, productType)
  return (
    <div
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        // The square is 1em on a side, so `fontSize` IS the size.
        fontSize: typeof size === 'number' ? `${size}px` : size,
        width: '1em',
        height: '1em',
        flexShrink: 0,
        background: thumbTint[glyph.tint],
        border: `1px solid ${colors.line}`,
        borderRadius: 'max(6px, 0.09em)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        width="0.42em"
        height="0.42em"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#B0A894"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {glyph.path}
      </svg>
    </div>
  )
}

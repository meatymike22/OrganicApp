import Image from 'next/image'
import { colors } from '@/lib/design'
import { CategoryGlyph } from './CategoryGlyph'

// THE PRODUCT THUMBNAIL — a photograph when we have one, the aisle glyph when
// we don't.
//
// Every product image on this site is somebody else's photograph, taken by an
// Open Food Facts contributor and licensed CC-BY-SA 3.0. That is a different
// licence from the ODbL that covers their data, and it carries an obligation
// the data licence does not: the credit travels with the image.
//
// So this component never renders an image without a route to its credit:
//   - `credit` renders the attribution line directly under the photo. Used on
//     the product page, where there is one image and room to say it properly.
//   - without `credit`, the photo still carries the source in its alt text and
//     its title, and the LIST that contains it is responsible for showing
//     PhotoCredit once. SearchPhotoCredit below exists for exactly that.
//
// If you add a new surface that shows product photos, it needs one of those
// two. An uncredited image is a licence breach, not a styling gap.

export type ProductImageFields = {
  imageUrl: string | null
  imageSource: string | null
  imageSourceUrl: string | null
}

// Human-readable credit for a source key. Driven by the stored `imageSource`
// rather than hardcoded, so a second image source later cannot silently
// inherit Open Food Facts' attribution.
const SOURCES: Record<string, { label: string; licence: string }> = {
  open_food_facts: { label: 'Open Food Facts contributors', licence: 'CC BY-SA' },
}

function describeSource(source: string | null): { label: string; licence: string } | null {
  if (!source) return null
  return SOURCES[source] ?? null
}

export function ProductThumb({
  product,
  category,
  productType,
  size = 66,
  intrinsic = 160,
  label,
  credit = false,
  tall = false,
}: {
  product: ProductImageFields
  category: string | null | undefined
  productType?: string | null
  // A number for a fixed square, or a CSS length for one that scales with the
  // window. The glyph fallback takes the same value, which matters more than
  // it sounds: well over half our products have no photo, so if the two
  // disagreed, a list would have thumbnails of two different sizes.
  size?: number | string
  // PORTRAIT FRAME. Michael, 2026-10-08, on the product hero: "the entire
  // picture doesnt fit the profile here. make sure photos fit the frame and
  // are legible."
  //
  // The frame was a square and the image is `contain`, which is the right
  // combination for a list and the wrong one for the hero: almost every
  // front-of-pack photograph is portrait, so inside a square it shrank to fit
  // the HEIGHT and left empty bands down both sides. A 168px square showed a
  // package about 110px wide — the complaint exactly.
  //
  // `cover` would fill the frame and is not available to us: cropping a
  // package photo can cut off a seal, a flavour or a "no added sugar" claim,
  // and a cropped label is a misleading one. That rule is older than this
  // comment and it stands.
  //
  // So the frame changes shape instead of the image. 3:4 portrait, which is
  // roughly the shape of a grocery package, so a portrait photo now fills
  // most of it and a landscape one still letterboxes a little rather than
  // being cropped. Lists keep the square, because rows of equal height is
  // worth more there than a few extra pixels of package.
  //
  // The real fix is to store each image's dimensions and match the frame to
  // the photograph exactly — the Open Food Facts `images` object carries
  // width and height per revision, so it costs a column and a backfill
  // rather than a request. Logged as features-to-add item 32.
  tall?: boolean
  // What `next/image` is told to fetch, in pixels. Separate from `size`
  // because a fluid square has no single pixel width to hand the optimiser,
  // and because asking for a slightly larger image than the biggest rendered
  // size is what keeps it sharp on a 2x screen.
  intrinsic?: number
  label?: string
  // Show the attribution line under the image. Set on the product page; left
  // off in lists, which show one credit for the whole list instead.
  credit?: boolean
}) {
  const source = describeSource(product.imageSource)

  // No photo, or a photo whose source we cannot describe. The second case is
  // deliberate: an image we cannot credit is an image we do not show.
  if (!product.imageUrl || !source) {
    return (
      <CategoryGlyph category={category} productType={productType} size={size} label={label} tall={tall} />
    )
  }

  const attribution = `Photo: ${source.label}, ${source.licence}`

  const frame = (
    <div
      style={{
        // Sized in em for the same reason as CategoryGlyph: one value drives
        // the box and the corner radius, and it works whether `size` is a
        // number or a clamp().
        fontSize: typeof size === 'number' ? `${size}px` : size,
        width: '1em',
        // 4/3 of the width in `tall` mode; see the note on the prop.
        height: tall ? 'calc(1em * 4 / 3)' : '1em',
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        // White rather than one of the aisle tints: a package photograph is
        // shot on white, and a tint behind it reads as a coloured card.
        background: '#FFFFFF',
        border: `1px solid ${colors.line}`,
        borderRadius: 'max(6px, 0.09em)',
      }}
    >
      <Image
        src={product.imageUrl}
        alt={label ? `${label} — ${attribution}` : attribution}
        title={attribution}
        width={intrinsic}
        height={intrinsic}
        // `contain`, never `cover`. A cropped package photo can cut off the
        // very thing a shopper is checking — a certification seal, a flavour,
        // a "no added sugar" claim — and a cropped label is a misleading one.
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        // These are other people's uploads at unpredictable sizes, and there
        // are 25 of them on a search page. Letting Next optimise them keeps
        // the page weight sane.
        sizes={`${intrinsic}px`}
      />
    </div>
  )

  if (!credit) return frame

  return (
    <div style={{ flexShrink: 0 }}>
      {frame}
      <div style={{ fontSize: 10.5, lineHeight: 1.35, color: colors.ink4, marginTop: 6, maxWidth: '18ch' }}>
        Photo:{' '}
        {product.imageSourceUrl ? (
          <a href={product.imageSourceUrl} target="_blank" rel="noopener noreferrer nofollow">
            {source.label}
          </a>
        ) : (
          source.label
        )}
        , {source.licence}
      </div>
    </div>
  )
}

// The one credit line a LIST of photos needs. Render it once below the list,
// and only when the list actually contains a photo — a credit for images that
// aren't there is noise, and worse, it implies we have photos we don't.
export function PhotoCredit({ products }: { products: ProductImageFields[] }) {
  const sources = new Set<string>()
  for (const p of products) {
    const s = describeSource(p.imageSource)
    if (p.imageUrl && s) sources.add(`${s.label}, ${s.licence}`)
  }
  if (sources.size === 0) return null

  return (
    <div style={{ fontSize: 11.5, lineHeight: 1.45, color: colors.ink4, marginTop: 4 }}>
      Product photographs on this page by {[...sources].join('; ')}. Each photo links to its source
      on the product page.
    </div>
  )
}

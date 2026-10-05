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
  label,
  credit = false,
}: {
  product: ProductImageFields
  category: string | null | undefined
  productType?: string | null
  size?: number
  label?: string
  // Show the attribution line under the image. Set on the product page; left
  // off in lists, which show one credit for the whole list instead.
  credit?: boolean
}) {
  const source = describeSource(product.imageSource)

  // No photo, or a photo whose source we cannot describe. The second case is
  // deliberate: an image we cannot credit is an image we do not show.
  if (!product.imageUrl || !source) {
    return <CategoryGlyph category={category} productType={productType} size={size} label={label} />
  }

  const attribution = `Photo: ${source.label}, ${source.licence}`

  const frame = (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        // White rather than one of the aisle tints: a package photograph is
        // shot on white, and a tint behind it reads as a coloured card.
        background: '#FFFFFF',
        border: `1px solid ${colors.line}`,
        borderRadius: Math.max(6, Math.round(size * 0.09)),
      }}
    >
      <Image
        src={product.imageUrl}
        alt={label ? `${label} — ${attribution}` : attribution}
        title={attribution}
        width={size}
        height={size}
        // `contain`, never `cover`. A cropped package photo can cut off the
        // very thing a shopper is checking — a certification seal, a flavour,
        // a "no added sugar" claim — and a cropped label is a misleading one.
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        // These are other people's uploads at unpredictable sizes, and there
        // are 25 of them on a search page. Letting Next optimise them keeps
        // the page weight sane.
        sizes={`${size}px`}
      />
    </div>
  )

  if (!credit) return frame

  return (
    <div style={{ flexShrink: 0 }}>
      {frame}
      <div style={{ fontSize: 10.5, lineHeight: 1.35, color: colors.ink4, marginTop: 6, maxWidth: size * 2 }}>
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

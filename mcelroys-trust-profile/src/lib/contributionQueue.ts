// WHAT DOES THIS PRODUCT NEED FROM A HUMAN?
//
// Rounds 30, 32, 33 and 34 each produced a population of records needing a
// person. They were tracked as three separate lists. They are not three
// lists: they overlap, and one shelf visit closes several at once.
//
//   needs photo | needs label | needs name | products
//   ------------+-------------+------------+---------
//        yes    |             |            |  216,984
//        yes    |     yes     |            |    9,363
//        yes    |             |    yes     |    7,718
//               |             |    yes     |    6,326
//               |     yes     |            |    1,704
//        yes    |     yes     |    yes     |      391
//               |     yes     |    yes     |       45
//                                   total  |  242,531
//
// THE UNIT IS A PHOTOGRAPH, NOT A NEED. Michael, 2026-11-04, choosing how the
// reward counts: "count accepted photographs". That decides the model here.
// A product that needs both a photograph and a name needs ONE front-of-pack
// shot -- the name is printed on the package -- so it must earn once, not
// twice. A product that needs a package shot and an ingredient panel is two
// photographs and earns twice, which is right: it is two pieces of work.
//
// So this file is about SHOTS. The underlying needs are an implementation
// detail of working out which shots are required.
//
// IT IS DERIVED, NEVER STORED. Every input is already a column. A stored
// queue would need a sync job, and a stale queue sends people to a shelf for
// work already done. Same reasoning as round 34's category-word set, which is
// computed from the live catalogue rather than baked into a file.

import { USABLE_IMAGE_KINDS } from '@/lib/imageKind'

/** A photograph someone has to physically take, standing at the shelf. */
export type RequiredShot = 'front_of_package' | 'ingredient_panel'

/**
 * Work that is NOT a photograph.
 *
 * 6,326 products are withheld for want of a name and ALREADY have a usable
 * package photograph. We hold the picture and still cannot say what the
 * product is, so no amount of contributed photography helps them -- the
 * picture has to be READ.
 *
 * Michael, 2026-11-04: vision first, humans for the rest. The vision half is
 * the round-33 title pass, currently blocked on the Claude API failing to
 * fetch images.openfoodfacts.org -- which means that blocker is holding up
 * 6,326 products' only route back to publication, not merely a title
 * cosmetics issue.
 *
 * Kept separate from RequiredShot on purpose: it needs no shelf visit, no
 * camera, and is far easier to vandalise, so it cannot share the photography
 * acceptance rule.
 */
export type DeskTask = 'read_name_from_existing_photo'

export type ProductForQueue = {
  imageUrl: string | null
  imageKind: string | null
  ingredientDisclosureStatus: string | null
  publicationStatus: string | null
}

/**
 * Do we hold a photograph we are willing to show as this product?
 *
 * AN UNJUDGED IMAGE COUNTS AS COVERED. `imageKind === null` with a URL means
 * the classifier has not reached it, and round 30's display rule already
 * shows those. Asking someone to re-shoot a photograph the site is currently
 * displaying wastes the one resource this whole feature is short of.
 *
 * Today the two readings coincide -- all 184,099 images are judged and 0 are
 * unjudged -- so this choice changes no present count. It will matter the
 * first time an import adds images ahead of a classifier run.
 */
export function hasUsablePhoto(p: ProductForQueue): boolean {
  if (!p.imageUrl || p.imageUrl.trim() === '') return false
  if (p.imageKind === null) return true
  return (USABLE_IMAGE_KINDS as readonly string[]).includes(p.imageKind)
}

/**
 * The photographs this product needs. Empty for a product that is fine, and
 * empty for one whose only problem is a desk task.
 */
export function requiredShots(p: ProductForQueue): RequiredShot[] {
  const shots: RequiredShot[] = []

  // One shot serves two needs. A withheld product with no photograph needs a
  // front-of-pack shot for the photograph itself AND for the name printed on
  // it; listing the shot once is what makes the photograph-counted reward
  // pay once.
  if (!hasUsablePhoto(p)) shots.push('front_of_package')

  // Round 32: Open Food Facts truncates ingredients_text at 255 characters.
  // The panel on the package is the only way to recover the rest -- the data
  // does not exist upstream, verified by re-fetching 40 barcodes.
  if (p.ingredientDisclosureStatus === 'partial') shots.push('ingredient_panel')

  return shots
}

/** Work that needs a person but not a camera. */
export function deskTasks(p: ProductForQueue): DeskTask[] {
  const withheld = p.publicationStatus !== null && p.publicationStatus !== 'published'
  // Only when photography CANNOT help: withheld, but we already hold a
  // perfectly good picture of the package.
  if (withheld && hasUsablePhoto(p)) return ['read_name_from_existing_photo']
  return []
}

export function needsAnyContribution(p: ProductForQueue): boolean {
  return requiredShots(p).length > 0 || deskTasks(p).length > 0
}

/**
 * DOES THIS PHOTOGRAPH EARN CREDIT?
 *
 * The spec's acceptance gate, unchanged: credit only when the classifier
 * accepts the photograph AND the product actually needed that shot. Junk
 * earns nothing and duplicates of covered products earn nothing, so the
 * incentive and the quality gate are the same mechanism and the reward
 * points at the gap with no proximity logic or curated wanted-list.
 *
 * `shotTaken` is what the contributor photographed; `judged` is what the
 * classifier said it is. BOTH are required: a contributor claiming to have
 * shot an ingredient panel does not make it one.
 */
export function photoEarnsCredit(
  before: ProductForQueue,
  shotTaken: RequiredShot,
  judged: string
): boolean {
  if (!requiredShots(before).includes(shotTaken)) return false
  if (shotTaken === 'front_of_package') return judged === 'package'
  return judged === 'ingredients_panel'
}

// Where the prompt appears for a withheld product. Michael, 2026-11-04:
// prompt on it. A withheld product has no page, so the ONLY way a person
// reaches it is by scanning its barcode -- and a scan already proves they are
// holding the product, which the spec names as the ideal moment to ask.
// 14,480 products are reachable this way and no other.
export const PROMPT_ON_WITHHELD_BARCODE_LOOKUP = true

// ------------------------------------------------------------- selftests

export function selftest(log: (s?: string) => void): boolean {
  let pass = 0
  let total = 0
  const check = (what: string, got: unknown, want: unknown) => {
    total++
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (ok) pass++
    else log(`  FAIL ${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
  }
  const p = (o: Partial<ProductForQueue>): ProductForQueue => ({
    imageUrl: 'https://example.test/a.jpg',
    imageKind: 'package',
    ingredientDisclosureStatus: 'disclosed',
    publicationStatus: 'published',
    ...o,
  })

  check('a healthy product needs nothing', requiredShots(p({})), [])
  check('no image at all', requiredShots(p({ imageUrl: null, imageKind: null })), ['front_of_package'])
  check('blank image url', requiredShots(p({ imageUrl: '   ', imageKind: null })), ['front_of_package'])
  check('a nutrition panel is not a product photo',
    requiredShots(p({ imageKind: 'nutrition_panel' })), ['front_of_package'])
  check('truncated list needs the panel',
    requiredShots(p({ ingredientDisclosureStatus: 'partial' })), ['ingredient_panel'])
  check('both, in shelf order',
    requiredShots(p({ imageUrl: null, imageKind: null, ingredientDisclosureStatus: 'partial' })),
    ['front_of_package', 'ingredient_panel'])

  // THE CASE THE WHOLE MODEL TURNS ON: withheld + no photo is ONE shot, not
  // two, because the name is printed on the package.
  check('withheld with no photo is one shot',
    requiredShots(p({ imageUrl: null, imageKind: null, publicationStatus: 'missing_info' })),
    ['front_of_package'])

  // An unjudged image is covered, not re-shot.
  check('unjudged image counts as covered', requiredShots(p({ imageKind: null })), [])
  check('unjudged image is usable', hasUsablePhoto(p({ imageKind: null })), true)

  // Desk tasks
  check('withheld WITH a photo is a desk task',
    deskTasks(p({ publicationStatus: 'missing_info' })), ['read_name_from_existing_photo'])
  check('withheld with NO photo is not a desk task',
    deskTasks(p({ publicationStatus: 'missing_info', imageUrl: null, imageKind: null })), [])
  check('a published product has no desk task', deskTasks(p({})), [])

  // Credit
  check('right shot, right verdict earns',
    photoEarnsCredit(p({ imageUrl: null, imageKind: null }), 'front_of_package', 'package'), true)
  check('a photo of a product that did not need one earns nothing',
    photoEarnsCredit(p({}), 'front_of_package', 'package'), false)
  check('classifier disagreeing with the contributor earns nothing',
    photoEarnsCredit(p({ imageUrl: null, imageKind: null }), 'front_of_package', 'nutrition_panel'), false)
  check('panel shot on a product with a complete list earns nothing',
    photoEarnsCredit(p({}), 'ingredient_panel', 'ingredients_panel'), false)
  check('panel shot on a partial list earns',
    photoEarnsCredit(p({ ingredientDisclosureStatus: 'partial' }), 'ingredient_panel', 'ingredients_panel'),
    true)

  log(`contributionQueue selftest: ${pass}/${total} pass`)
  return pass === total
}

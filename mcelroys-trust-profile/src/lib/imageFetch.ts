// FETCH AN IMAGE HERE AND SEND THE BYTES, RATHER THAN ASKING THE API TO FETCH IT.
//
// WHY THIS EXISTS. Round 30 sent 184,099 images to the Claude API as URLs --
// `source: {type: 'url'}` -- and it worked. By 2026-11-03 every such call
// came back:
//
//   "The request timed out while trying to download the file."
//
// 10/10, then 20/20, then 10/10 again fifteen hours later. Not transient.
//
// IT IS NOT THE CDN. Measured from this machine 2026-11-04: five OFF images
// in 0.9-1.2 seconds each, 18-44 KB. The host is healthy and fast. Something
// between Anthropic's fetcher and images.openfoodfacts.org is not, and we
// cannot see or fix that side.
//
// (A single first sample read 20.4 seconds and briefly looked like CDN
// degradation. It was PowerShell's cold start. One sample is not a rate --
// the five that followed settled it.)
//
// So: fetch locally, base64 the bytes, send those. Same visual-token cost,
// because the API derives tokens from the image's dimensions either way; the
// only change is which machine does the download.

/** The four the API accepts. Anything else is refused rather than guessed at. */
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

export type FetchedImage =
  | { ok: true; mediaType: string; base64: string; bytes: number }
  | { ok: false; reason: string }

/**
 * Download one image and return it base64-encoded.
 *
 * Every failure is REPORTED, never guessed around. Round 30 shipped a
 * fetch-failure pattern that did not match the API's real wording, which made
 * "zero fetch failures in 183,146 images" an artifact of broken detection
 * rather than a measurement -- and round 33 repeated it. Here the fetch is
 * ours, so the reason is exact and there is no vendor string to pattern-match.
 */
export async function fetchImageAsBase64(url: string, timeoutMs = 20000): Promise<FetchedImage> {
  let res: Response
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      // Identify the client honestly. Never the user's email address.
      headers: { 'user-agent': 'Rootify/1.0 (+https://rootify.app)' },
    })
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return { ok: false, reason: `fetch_threw (${msg})` }
  }

  if (!res.ok) return { ok: false, reason: `http_${res.status}` }

  // Strip any `; charset=...` and lowercase before comparing.
  const mediaType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!(ALLOWED_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    // A 200 carrying an HTML error page is the classic case. Sending it as a
    // JPEG would be rejected by the API with a less informative message than
    // this one.
    return { ok: false, reason: `unsupported_media_type (${mediaType || 'none sent'})` }
  }

  let buf: Buffer
  try {
    buf = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    return { ok: false, reason: `body_read_failed (${e instanceof Error ? e.message : String(e)})` }
  }
  if (buf.length === 0) return { ok: false, reason: 'empty_body' }

  return { ok: true, mediaType, base64: buf.toString('base64'), bytes: buf.length }
}

/** The content block to put in a message, once the bytes are in hand. */
export function imageBlock(img: Extract<FetchedImage, { ok: true }>) {
  return {
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
  }
}

export function selftest(log: (s?: string) => void): boolean {
  let pass = 0
  let total = 0
  const check = (what: string, got: unknown, want: unknown) => {
    total++
    if (JSON.stringify(got) === JSON.stringify(want)) pass++
    else log(`  FAIL ${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
  }
  const img = { ok: true as const, mediaType: 'image/png', base64: 'QUJD', bytes: 3 }
  check('block shape', imageBlock(img), {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'QUJD' },
  })
  check('allowed types are the API\'s four', [...ALLOWED_MEDIA_TYPES],
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
  log(`imageFetch selftest: ${pass}/${total} pass`)
  return pass === total
}

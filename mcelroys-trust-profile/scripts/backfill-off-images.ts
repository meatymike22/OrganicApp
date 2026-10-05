// BACKFILL PRODUCT PHOTOGRAPHS from the Open Food Facts data export.
//
// Reads the same export bulk-import-off.ts uses, and for every product
// Rootify ALREADY HAS, records where its front-of-pack photograph lives.
//
// WHY THIS IS A SEPARATE SCRIPT. bulk-import-off.ts skips any barcode
// already in the database ("already in Rootify") because its job is to add
// products, and refreshing existing ones is somebody else's. Every product
// in Rootify is already in, so re-running the importer would photograph
// exactly zero of them. This script does the opposite: it only touches
// products we already hold, and only ever writes the four image columns.
//
// LICENCE — READ THIS BEFORE CHANGING ANYTHING HERE.
// Open Food Facts DATA is ODbL. Open Food Facts PHOTOGRAPHS are CC-BY-SA
// 3.0, which is a different licence with a different obligation: the credit
// travels with the image, wherever the image is shown. That is why this
// script stores imageSource and imageSourceUrl alongside the URL rather than
// just the URL — the renderer needs both to show a credit, and
// src/components/ProductThumb.tsx refuses to display an image it cannot
// credit. Do not "simplify" this to one column.
//
// WHAT IT WRITES
//   imageUrl        the front-of-pack photo, or null if OFF has none
//   imageSource     'open_food_facts'
//   imageSourceUrl  the OFF product page, which is what the credit links to
//   imageCheckedAt  always set for any product found in the export
//
// THE THREE STATES, which this script exists to keep straight:
//   imageUrl set,  imageCheckedAt set  -> we have a photo
//   imageUrl null, imageCheckedAt set  -> we looked, OFF has no photo
//   imageUrl null, imageCheckedAt null -> nobody has looked yet
// A product that isn't in the export at all keeps the third state. Marking
// it "checked" would claim we looked somewhere we didn't.
//
// GET THE FILE (same file as the bulk import; about 7+ GB):
//   https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz
// Save as ./data/openfoodfacts-products.jsonl.gz and do NOT unzip it.
//
// USAGE
//   npx prisma generate
//       RUN THIS FIRST, once, after the migration that added the image
//       columns. The generated client is a build artifact and only rebuilds
//       on `npm install`; until it does, every query here fails validation
//       with "Unknown argument imageCheckedAt".
//   npx tsx scripts/backfill-off-images.ts --selftest
//       Checks the line parsing and the image-field priority against sample
//       records. No database, no export file, one second.
//   npx tsx scripts/backfill-off-images.ts ./data/openfoodfacts-products.jsonl.gz
//       Dry run (default). Reports how many products WOULD get a photo,
//       which OFF field each URL came from, and a sample of the URLs.
//       Writes nothing. Run this first — it also tells you whether this
//       export even carries the image fields.
//   npx tsx scripts/backfill-off-images.ts <file> --live --limit 2000
//       Trial: writes the first 2,000 matches, then stops.
//   npx tsx scripts/backfill-off-images.ts <file> --live
//       Full backfill.
//   Options:
//       --batch 500     products per database write (default 500)
//
// SAFE TO RE-RUN: it only loads products whose imageCheckedAt is null, so an
// interrupted run continues where it stopped. To re-check everything (a
// newer export, more photos uploaded), pass --recheck.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { StringDecoder } from 'string_decoder'
import * as zlib from 'zlib'
import { normalizeUpc } from '@/lib/upc'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
// queryPlanCacheMaxSize: 0 — same reason as bulk-import-off.ts. Every batch
// embeds different values, so cached plans are never reused and the cache
// just grows until the process runs out of memory.
const clientOptions = {
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0]
const prisma = new PrismaClient(clientOptions)

// --- CONFIG ---
const args = process.argv.slice(2)
const FILE = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a))
const DRY_RUN = !args.includes('--live')
const RECHECK = args.includes('--recheck')
function argValue(name: string): string | null {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] ?? null : null
}
const LIMIT = argValue('--limit') ? Number(argValue('--limit')) : Infinity
const BATCH_SIZE = argValue('--batch') ? Number(argValue('--batch')) : 500
const SOURCE = 'open_food_facts'
const INGESTION_SOURCE = 'open_food_facts_images'
const PROGRESS_EVERY = 250_000

// The only hosts an image URL may point at. Must stay in step with
// images.remotePatterns in next.config.ts: next/image refuses anything not
// listed there, so a URL stored here that isn't allowed there renders as a
// broken image rather than a photo. Three hosts because OFF has changed how
// it serves images over the years and old records keep the old form.
const ALLOWED_IMAGE_HOSTS = new Set([
  'images.openfoodfacts.org',
  'static.openfoodfacts.org',
  'world.openfoodfacts.org',
])

// --- LOGGING (written as it goes, like the bulk import: a multi-hour run
// that dies must still leave a record of how far it got) ---
const LOG_FILE = path.join(
  './logs',
  `${DRY_RUN ? 'backfill-off-images-dryrun' : 'backfill-off-images'}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
)
fs.mkdirSync('./logs', { recursive: true })
function writeLine(line: string) {
  fs.appendFileSync(LOG_FILE, line + '\n')
}
function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  writeLine(line)
}
function logError(...parts: unknown[]) {
  const line = parts
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')
  console.error(line)
  writeLine('[ERROR] ' + line)
}

// Keeps a short string from retaining the whole multi-megabyte line it was
// sliced out of. Same helper, same reason, as bulk-import-off.ts.
function detach(s: string): string {
  return (' ' + s).slice(1)
}

// --- COUNTERS ---
let linesRead = 0
let matched = 0
let withImage = 0
let withoutImage = 0
let rejectedHost = 0
let matchedByNormalising = 0
let batchesWritten = 0
let batchesFailed = 0
const fieldUsed = new Map<string, number>()
const rejectedHosts = new Map<string, number>()
const samples: string[] = []
// DIAGNOSTICS for the no-image case. The first dry run found zero photos and
// could not say why, which cost a whole 7-minute pass to learn one fact. These
// make the report describe what the export ACTUALLY contains, so a miss is
// self-explaining instead of sending us back to guess at field names.
const noImageShape = new Map<string, number>()
const shapeSamples: string[] = []
function bump(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) ?? 0) + 1)
}

// --- WHICH PRODUCTS WE'RE LOOKING FOR ---
// barcode -> product id. 400k entries of two short strings is ~60 MB, which
// is the same trade bulk-import-off.ts makes: holding this in memory is what
// turns one database round-trip per line into none.
const wanted = new Map<string, string>()

async function loadWanted() {
  let products: { id: string; upc: string | null }[]
  try {
    products = await prisma.product.findMany({
      where: RECHECK ? { upc: { not: null } } : { upc: { not: null }, imageCheckedAt: null },
      select: { id: true, upc: true },
    })
  } catch (e) {
    // The image columns exist in the database and in schema.prisma, but the
    // generated Prisma client is a separate build step that only runs on
    // `npm install` (the postinstall hook) or when asked. If the client
    // predates the migration, every query naming an image column fails
    // validation — which looks like a bug in this script and isn't.
    if (e instanceof Error && /Unknown argument .?image/i.test(e.message)) {
      logError('The generated Prisma client does not know about the image columns yet.')
      logError('Run this first, then re-run this script:')
      logError('    npx prisma generate')
      throw new Error('Prisma client is out of date — run `npx prisma generate`')
    }
    throw e
  }
  for (const p of products) if (p.upc) wanted.set(detach(p.upc), p.id)
  log(
    `Looking for ${wanted.size.toLocaleString()} products` +
      (RECHECK ? ' (--recheck: every product with a barcode).' : ' that have never been checked for a photo.')
  )
}

// --- FINDING THE IMAGE IN AN OFF RECORD ---
//
// Field names in the export have changed over the years and not every record
// carries every one, so this tries each in turn and REPORTS which one it
// used. That is deliberate: the dry-run output tells you what this export
// actually contains instead of us guessing from documentation. If the report
// says every hit came from one field, the others cost nothing; if it says
// zero hits, the export has no images and nothing was written.
type Found = { url: string; field: string }

// Where OFF puts a product's image files.
//
// The path is the barcode broken into groups of three. Straight from
// ProductOpener's product_path_from_id: a code of 9 characters or more
// becomes "123/456/789/rest", anything shorter is used whole.
function offImagePath(code: string): string {
  return code.length >= 9 ? code.replace(/^(.{3})(.{3})(.{3})(.*)$/, '$1/$2/$3/$4') : code
}

// Builds the URL for one image revision. 400px because that is the largest
// of OFF's three thumbnail sizes and still a fraction of `full` — the biggest
// we render is the 92px product hero, and next/image resizes from there.
function offImageUrl(code: string, imgid: string, rev: string): string {
  return `https://images.openfoodfacts.org/images/products/${offImagePath(code)}/${imgid}.${rev}.400.jpg`
}

// THE EXPORT DOES NOT CONTAIN image_front_url.
//
// That field, and every other `image_*_url`, is computed by the OFF API at
// request time and is not written into the JSONL dump. The first dry run
// matched 374,329 of our products and found zero photos for exactly this
// reason. What the dump carries instead is the raw `images` object, which
// holds each image's revision number — enough to build the URL ourselves.
//
// Two shapes exist in the wild and this handles both, because which one a
// dump uses depends on when it was produced:
//
//   legacy, flat:  images["front_en"] = { rev: "4", imgid: "1", sizes: {...} }
//   newer, nested: images.selected.front.en = { rev: "4", imgid: "1", ... }
//
// ONLY a `front_*` image is used. A product with nothing but numbered
// uploads has no designated front-of-pack shot, and those numbered images are
// as likely to be a close-up of the nutrition panel as the front of the box.
// Showing an ingredients panel where a shopper expects the package is worse
// than showing the aisle glyph.
function pickFromImagesObject(p: Record<string, unknown>, code: string): Found | null {
  const images = p.images
  if (!images || typeof images !== 'object') return null
  const obj = images as Record<string, unknown>

  const revOf = (entry: unknown): string | null => {
    if (!entry || typeof entry !== 'object') return null
    const rev = (entry as Record<string, unknown>).rev
    if (typeof rev === 'string' && rev.length > 0) return rev
    if (typeof rev === 'number') return String(rev)
    return null
  }

  // Newer nested shape first — if a dump has both, `selected` is the one
  // that says which image OFF considers the front.
  const selected = obj.selected
  if (selected && typeof selected === 'object') {
    const front = (selected as Record<string, unknown>).front
    if (front && typeof front === 'object') {
      const byLang = front as Record<string, unknown>
      const langs = ['en', ...Object.keys(byLang).filter((k) => k !== 'en')]
      for (const lang of langs) {
        const rev = revOf(byLang[lang])
        if (rev) {
          return {
            url: offImageUrl(code, `front_${lang}`, rev),
            field: `images.selected.front.${lang === 'en' ? 'en' : '<lang>'}`,
          }
        }
      }
    }
  }

  // Legacy flat shape. English first, then any other language.
  const frontKeys = Object.keys(obj).filter((k) => k.startsWith('front_'))
  frontKeys.sort((a, b) => Number(b === 'front_en') - Number(a === 'front_en'))
  for (const key of frontKeys) {
    const rev = revOf(obj[key])
    if (rev) {
      return {
        url: offImageUrl(code, key, rev),
        field: `images.${key === 'front_en' ? 'front_en' : 'front_<lang>'}`,
      }
    }
  }

  return null
}

function pickImage(p: Record<string, unknown>, code: string): Found | null {
  const direct: [string, unknown][] = [
    ['image_front_url', p.image_front_url],
    ['image_front_small_url', p.image_front_small_url],
    ['image_url', p.image_url],
    ['image_small_url', p.image_small_url],
  ]
  for (const [field, value] of direct) {
    if (typeof value === 'string' && value.startsWith('https://')) return { url: value, field }
  }

  // Some API-shaped records nest ready-made URLs here.
  const selected = p.selected_images
  if (selected && typeof selected === 'object') {
    const front = (selected as Record<string, unknown>).front
    if (front && typeof front === 'object') {
      const display = (front as Record<string, unknown>).display
      if (display && typeof display === 'object') {
        // English first, then whatever language the record has — a photo of
        // the package is a photo of the package whatever the locale key.
        const byLang = display as Record<string, unknown>
        const keys = ['en', ...Object.keys(byLang).filter((k) => k !== 'en')]
        for (const k of keys) {
          const value = byLang[k]
          if (typeof value === 'string' && value.startsWith('https://')) {
            return { url: value, field: `selected_images.front.display.${k === 'en' ? 'en' : '<lang>'}` }
          }
        }
      }
    }
  }

  // Nothing ready-made. Build it from the raw images object — which, for the
  // JSONL export, is the only path that actually works.
  return pickFromImagesObject(p, code)
}

// A URL we are allowed to render. Anything else is treated as "no photo":
// storing a URL next/image will refuse would put a broken image on the page,
// which is worse than the glyph we already have.
function allowed(url: string): boolean {
  try {
    const host = new URL(url).hostname
    if (ALLOWED_IMAGE_HOSTS.has(host)) return true
    bump(rejectedHosts, host)
    return false
  } catch {
    bump(rejectedHosts, '(unparseable URL)')
    return false
  }
}

// Pulls the barcode out of the raw line WITHOUT parsing it.
//
// The export has millions of records and we want a few hundred thousand of
// them. JSON.parse on every line is the single most expensive thing this
// script could do, so the barcode is read with a regex first and the line is
// only parsed when it turns out to be a product we hold. Falls back to a
// full parse if the regex misses, so an unusual field order cannot silently
// drop records.
const CODE_RE = /"code"\s*:\s*"(\d+)"/

// --- ONE BATCH ---
type Pending = { id: string; url: string | null; sourceUrl: string }
let batch: Pending[] = []

function processLine(line: string) {
  linesRead++

  const quick = CODE_RE.exec(line)
  let p: Record<string, unknown> | null = null
  let code: string | null = quick ? quick[1] : null

  if (!code) {
    // Regex missed — parse properly rather than skip.
    try {
      p = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    code = typeof p.code === 'string' ? p.code : null
    if (!code) return
  }

  // MATCHING A BARCODE TO ONE OF OURS.
  //
  // Our Product.upc is not the OFF code — it is the OFF code put through
  // normalizeUpc (src/lib/upc.ts), which is what bulk-import-off.ts stored.
  // That function does things no amount of zero-padding will reverse:
  //
  //   - an 8-digit UPC-E is EXPANDED to its 12-digit UPC-A and then to 13,
  //     so OFF's "01234565" is stored as a completely different string;
  //   - a 14-digit GTIN-14 has its leading zero stripped to 13.
  //
  // The first full pass used three hand-rolled variants (exact, strip leading
  // zeros, pad to 13) instead of the project's own normaliser, and left
  // 42,053 products unmatched — products that had come FROM this very export.
  // Reusing normalizeUpc makes the match exact by construction: the same
  // input through the same function as the import gives the same key.
  //
  // The cheap lookups are still tried first, because they catch most rows and
  // normalizeUpc runs a check-digit loop we would rather not pay 4.8 million
  // times.
  let key: string | undefined
  let id = wanted.get(code)
  if (id) key = code
  if (!id) {
    const padded = code.padStart(13, '0')
    id = wanted.get(padded)
    if (id) key = padded
  }
  if (!id) {
    const stripped = code.replace(/^0+/, '')
    id = wanted.get(stripped)
    if (id) key = stripped
  }
  if (!id) {
    const n = normalizeUpc(code)
    if (n.ok) {
      id = wanted.get(n.upc)
      if (id) {
        key = n.upc
        matchedByNormalising++
      }
    }
  }
  if (!id || !key) return

  if (!p) {
    try {
      p = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
  }
  if (!p) return

  matched++

  const found = pickImage(p, code)
  const usable = found && allowed(found.url) ? found : null
  if (found && !usable) rejectedHost++

  if (usable) {
    withImage++
    bump(fieldUsed, usable.field)
    if (samples.length < 15) samples.push(detach(`${code}  ${usable.field}  ${usable.url}`))
  } else {
    // In the export, and OFF has no photo for it. A real finding, and the
    // reason imageCheckedAt is written even when imageUrl stays null.
    withoutImage++

    // Record the SHAPE of what was there, so "no photo" can be told apart
    // from "a photo in a form this script does not understand".
    const images = p.images
    if (!images || typeof images !== 'object') {
      bump(noImageShape, 'no images key at all')
    } else {
      const keys = Object.keys(images as Record<string, unknown>)
      if (keys.length === 0) {
        bump(noImageShape, 'images present but empty')
      } else {
        const hasFront = keys.some((k) => k.startsWith('front_'))
        const hasSelected = keys.includes('selected')
        bump(
          noImageShape,
          hasSelected
            ? 'images.selected present but no usable front rev'
            : hasFront
              ? 'front_* key present but no usable rev'
              : `images keys: ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ', …' : ''}`
        )
        // A couple of real snippets beat any amount of guessing.
        if (shapeSamples.length < 4) {
          shapeSamples.push(detach(`${code}  images = ${JSON.stringify(images).slice(0, 600)}`))
        }
      }
    }
  }

  batch.push({
    id,
    url: usable ? detach(usable.url) : null,
    sourceUrl: detach(`https://world.openfoodfacts.org/product/${code}`),
  })

  // Found once; never look again in this run. Deleting `key` and not `code`
  // matters: when the match came from a padded or normalised form, deleting
  // the raw code removes nothing and the entry sits in the map for the rest
  // of the run, both wasting work and inflating the "never found" total that
  // the report ends with.
  wanted.delete(key)
}

// Writes the pending batch in ONE statement.
//
// Prisma has no "update many rows to different values" call, and 400,000
// individual updates over a home connection would take hours. This is a
// single UPDATE ... FROM (VALUES ...), which Postgres applies as one pass.
async function flushBatch() {
  if (batch.length === 0) return
  const rows = batch
  batch = []
  if (DRY_RUN) {
    batchesWritten++
    return
  }

  const values = rows.map(
    // Every value is cast: in a VALUES list Postgres infers column types
    // from the first row, and a parameter it cannot type (a NULL url in row
    // one) would make the whole statement fail.
    (r) => Prisma.sql`(${r.id}::text, ${r.url}::text, ${r.sourceUrl}::text)`
  )

  try {
    // Casts on ${SOURCE} and on NOW(): a bare parameter sitting in a CASE
    // branch next to NULL gives Postgres nothing to infer a type from
    // ("could not determine data type of parameter"), and imageCheckedAt is
    // `timestamp without time zone`, so NOW() — which is timestamptz — would
    // otherwise be converted using the session's timezone rather than UTC.
    await prisma.$executeRaw`
      UPDATE "Product" AS p
         SET "imageUrl"       = v.url,
             "imageSource"    = CASE WHEN v.url IS NULL THEN NULL ELSE ${SOURCE}::text END,
             "imageSourceUrl" = CASE WHEN v.url IS NULL THEN NULL ELSE v.source_url END,
             "imageCheckedAt" = (NOW() AT TIME ZONE 'UTC')
        FROM (VALUES ${Prisma.join(values)}) AS v(id, url, source_url)
       WHERE p.id = v.id
    `
    batchesWritten++
  } catch (e) {
    batchesFailed++
    logError(`Batch of ${rows.length} failed:`, e)
  }
}

async function* readLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  // Pulls from the stream rather than being pushed at: while a batch is
  // being written the file simply waits, so memory stays flat. Same reason
  // as bulk-import-off.ts, where the push version ran out of memory.
  const decoder = new StringDecoder('utf8')
  let carry = ''
  for await (const chunk of stream) {
    carry += decoder.write(chunk as Buffer)
    let newline = carry.indexOf('\n')
    while (newline !== -1) {
      yield carry.slice(0, newline)
      carry = carry.slice(newline + 1)
      newline = carry.indexOf('\n')
    }
  }
  carry += decoder.end()
  if (carry) yield carry
}

function top(m: Map<string, number>, n: number): string {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `    ${v.toLocaleString().padStart(9)}  ${k}`)
    .join('\n')
}

// --- SELF TEST ---
// Exercises the line parsing, the field priority and the host check against
// records shaped like the ones in the export, WITHOUT the database or the
// 7 GB file. Run this first: a wrong field name or a broken regex is then
// found in a second instead of twenty minutes into a full pass.
//
//   npx tsx scripts/backfill-off-images.ts --selftest
function selfTest(): boolean {
  const cases: { name: string; line: string; expectField: string | null; expectUrl?: string }[] = [
    {
      name: 'image_front_url preferred over the others',
      line: JSON.stringify({
        code: '0071012075379',
        image_front_url: 'https://images.openfoodfacts.org/images/products/007/101/207/5379/front_en.4.400.jpg',
        image_front_small_url: 'https://images.openfoodfacts.org/images/products/007/101/207/5379/front_en.4.200.jpg',
        image_url: 'https://images.openfoodfacts.org/images/products/007/101/207/5379/front_en.4.400.jpg',
      }),
      expectField: 'image_front_url',
    },
    {
      name: 'falls back to image_front_small_url',
      line: JSON.stringify({
        code: '0071012075379',
        image_front_small_url: 'https://images.openfoodfacts.org/images/products/1.200.jpg',
      }),
      expectField: 'image_front_small_url',
    },
    {
      name: 'falls back to the nested selected_images',
      line: JSON.stringify({
        code: '0071012075379',
        selected_images: {
          front: { display: { en: 'https://images.openfoodfacts.org/images/products/2.400.jpg' } },
        },
      }),
      expectField: 'selected_images.front.display.en',
    },
    {
      name: 'nested, no English — takes whatever language is there',
      line: JSON.stringify({
        code: '0071012075379',
        selected_images: {
          front: { display: { fr: 'https://images.openfoodfacts.org/images/products/3.400.jpg' } },
        },
      }),
      expectField: 'selected_images.front.display.<lang>',
    },
    {
      name: 'built from the legacy flat images object',
      line: JSON.stringify({
        code: '0071012075379',
        images: { front_en: { imgid: '1', rev: '4', sizes: { '400': { w: 400, h: 300 } } } },
      }),
      expectField: 'images.front_en',
      expectUrl: 'https://images.openfoodfacts.org/images/products/007/101/207/5379/front_en.4.400.jpg',
    },
    {
      name: 'built from the newer nested images.selected',
      line: JSON.stringify({
        code: '0071012075379',
        images: { selected: { front: { en: { imgid: '1', rev: 7 } } }, uploaded: { '1': {} } },
      }),
      expectField: 'images.selected.front.en',
      expectUrl: 'https://images.openfoodfacts.org/images/products/007/101/207/5379/front_en.7.400.jpg',
    },
    {
      name: 'images.selected wins over a stale flat front_en',
      line: JSON.stringify({
        code: '0071012075379',
        images: { front_en: { rev: '2' }, selected: { front: { en: { rev: '9' } } } },
      }),
      expectField: 'images.selected.front.en',
      expectUrl: 'https://images.openfoodfacts.org/images/products/007/101/207/5379/front_en.9.400.jpg',
    },
    {
      name: 'front_* in another language when there is no English',
      line: JSON.stringify({ code: '0071012075379', images: { front_fr: { rev: '3' } } }),
      expectField: 'images.front_<lang>',
      expectUrl: 'https://images.openfoodfacts.org/images/products/007/101/207/5379/front_fr.3.400.jpg',
    },
    {
      name: 'numbered uploads only — no designated front, so no photo',
      line: JSON.stringify({ code: '0071012075379', images: { '1': { sizes: {} }, '2': { sizes: {} } } }),
      expectField: null,
    },
    {
      name: 'front_* with no rev is unusable',
      line: JSON.stringify({ code: '0071012075379', images: { front_en: { imgid: '1' } } }),
      expectField: null,
    },
    {
      name: 'short barcode is not split into a path',
      line: JSON.stringify({ code: '20034', images: { front_en: { rev: '1' } } }),
      expectField: 'images.front_en',
      expectUrl: 'https://images.openfoodfacts.org/images/products/20034/front_en.1.400.jpg',
    },
    {
      name: 'no image fields at all',
      line: JSON.stringify({ code: '0071012075379', product_name: 'Flour' }),
      expectField: null,
    },
    {
      name: 'image on a host we do not allow is treated as no image',
      line: JSON.stringify({ code: '0071012075379', image_front_url: 'https://cdn.example.com/x.jpg' }),
      expectField: null,
    },
    {
      name: 'http (not https) is treated as no image',
      line: JSON.stringify({
        code: '0071012075379',
        image_front_url: 'http://images.openfoodfacts.org/images/products/4.400.jpg',
      }),
      expectField: null,
    },
  ]

  let failures = 0

  for (const c of cases) {
    const parsed = JSON.parse(c.line) as Record<string, unknown>
    const code = String(parsed.code)
    const found = pickImage(parsed, code)
    const usable = found && allowed(found.url) ? found : null
    const got = usable ? usable.field : null
    let ok = got === c.expectField
    // The field name alone is not enough: the URL is BUILT here rather than
    // read, so a wrong barcode path or revision would pass a field check and
    // still 404 on every image.
    if (ok && c.expectUrl && usable?.url !== c.expectUrl) {
      ok = false
      log(`        url mismatch:\n          expected ${c.expectUrl}\n          got      ${usable?.url}`)
    }
    if (!ok) failures++
    log(`  ${ok ? 'ok  ' : 'FAIL'}  ${c.name}  (expected ${c.expectField ?? 'no image'}, got ${got ?? 'no image'})`)
  }

  // The barcode has to come out of the raw line without a JSON parse, since
  // that shortcut is what makes a pass over the whole export affordable.
  const codeCases: { line: string; expect: string | null }[] = [
    { line: '{"code":"0071012075379","product_name":"x"}', expect: '0071012075379' },
    { line: '{"product_name":"x","code":"0071012075379"}', expect: '0071012075379' },
    { line: '{"code": "0071012075379"}', expect: '0071012075379' },
    { line: '{"product_name":"no code here"}', expect: null },
  ]
  for (const c of codeCases) {
    const m = CODE_RE.exec(c.line)
    const got = m ? m[1] : null
    const ok = got === c.expect
    if (!ok) failures++
    log(`  ${ok ? 'ok  ' : 'FAIL'}  barcode from raw line  (expected ${c.expect ?? 'none'}, got ${got ?? 'none'})`)
  }

  log(failures === 0 ? '\nAll self-tests passed.' : `\n${failures} self-test(s) FAILED.`)
  return failures === 0
}

async function main() {
  if (args.includes('--selftest')) {
    log('SELF TEST — no database, no export file')
    if (!selfTest()) process.exitCode = 1
    return
  }

  if (!FILE || !fs.existsSync(FILE)) {
    logError(`Export file not found: ${FILE ?? '(none given)'}`)
    logError('Download https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz to ./data/ and pass its path.')
    return
  }
  log(`${DRY_RUN ? 'DRY RUN' : 'LIVE RUN'} — ${FILE}, batch ${BATCH_SIZE}${LIMIT !== Infinity ? `, limit ${LIMIT}` : ''}${RECHECK ? ', --recheck' : ''}`)
  await loadWanted()
  if (wanted.size === 0) {
    log('Nothing to do. Every product with a barcode has already been checked — pass --recheck to look again.')
    return
  }

  const started = Date.now()
  const input = fs.createReadStream(FILE).pipe(zlib.createGunzip())

  for await (const rawLine of readLines(input)) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.trim()) processLine(line)
    if (batch.length >= BATCH_SIZE) await flushBatch()
    if (linesRead % PROGRESS_EVERY === 0 && linesRead > 0) {
      const mins = ((Date.now() - started) / 60000).toFixed(1)
      const mb = Math.round(process.memoryUsage().rss / 1024 / 1024)
      log(`  ...${linesRead.toLocaleString()} lines read, ${matched.toLocaleString()} of ours found, ${withImage.toLocaleString()} with a photo (${mins} min, ${mb} MB)`)
    }
    if (matched >= LIMIT) break
    // Every product we were looking for has been found — the rest of the
    // file cannot contain anything we need.
    if (wanted.size === 0) break
  }
  await flushBatch()
  input.destroy()

  const mins = ((Date.now() - started) / 60000).toFixed(1)
  log(`\n===== ${DRY_RUN ? 'DRY RUN — nothing was written' : 'BACKFILL COMPLETE'} (${mins} min) =====`)
  log(`Lines read: ${linesRead.toLocaleString()}`)
  log(`Our products found in the export: ${matched.toLocaleString()}`)
  log(`  with a usable photo: ${withImage.toLocaleString()}`)
  log(`  no photo on OFF: ${withoutImage.toLocaleString()}`)
  if (rejectedHost > 0) log(`  photo on a host we don't allow (treated as no photo): ${rejectedHost.toLocaleString()}`)
  log(`Matched only after normalising the barcode (would have been missed before): ${matchedByNormalising.toLocaleString()}`)
  log(`Never found in the export (left as "nobody has looked"): ${wanted.size.toLocaleString()}`)
  log(`Batches ${DRY_RUN ? 'that would be written' : 'written'}: ${batchesWritten}, failed: ${batchesFailed}`)

  log('\nWhich OFF field the URL came from:')
  log(top(fieldUsed, 10) || '    (none — this export carries no image fields this script recognises)')

  if (noImageShape.size > 0) {
    log('\nFor products with no usable photo, what the record actually held:')
    log(top(noImageShape, 12))
  }

  if (shapeSamples.length > 0) {
    log('\nRaw `images` from a few of those records (truncated to 600 chars):')
    for (const s of shapeSamples) log(`    ${s}`)
  }

  if (rejectedHosts.size > 0) {
    log('\nHosts rejected (add to ALLOWED_IMAGE_HOSTS and next.config.ts if one of these is legitimate):')
    log(top(rejectedHosts, 10))
  }

  if (samples.length > 0) {
    log('\nSample URLs (check one in a browser before the live run):')
    for (const s of samples) log(`    ${s}`)
  }

  if (!DRY_RUN) {
    await prisma.ingestionLog.create({
      data: {
        source: INGESTION_SOURCE,
        recordsMatched: withImage,
        fileName: path.basename(FILE),
      },
    })
    log('\nLogged this run to IngestionLog.')
  } else {
    log('\nRe-run with --live --limit 2000 for a trial, then --live for the full backfill.')
  }
}

main()
  .catch((e) => logError('Fatal:', e))
  .finally(async () => {
    await prisma.$disconnect()
    log(`\nLog written to ${LOG_FILE}`)
  })

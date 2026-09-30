// Cross-checks our product data against USDA FoodData Central (FDC).
//
// WHY: our ingredient and nutrition data comes from Open Food Facts, which is
// crowdsourced. It has already produced OCR garbage ("lonfat ilk"), whole
// nutrition panels stored as one ingredient, and a UPC labelled as the wrong
// flavour of cereal. FDC's Branded database comes from MANUFACTURERS' own
// label submissions, so it is the authoritative counterpart.
//
// This script does two different jobs, deliberately kept apart:
//   FILL  — where we have no ingredient list, take FDC's.
//   CHECK — where we already have one, COMPARE and report differences without
//           overwriting. A disagreement between two sources is a finding for a
//           human, not something to silently resolve. Overwriting would also
//           discard the organic markers and positions we parsed from OFF.
//
// Requires a free API key: https://fdc.nal.usda.gov/api-key-signup.html
// Then add to .env:   FDC_API_KEY=your-key
//
// Usage:
//   npx tsx scripts/ingest-fooddata-central.ts          (dry run / report)
//   npx tsx scripts/ingest-fooddata-central.ts --live    (writes FILL cases only)
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { parseIngredientsText } from '@/lib/ingredientParsing'
import { replaceProductIngredients } from '@/lib/ingredientStore'
import * as fs from 'fs'
import * as path from 'path'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const logLines: string[] = []
function log(...a: unknown[]) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 2))).join(' ')
  console.log(line); logLines.push(line)
}
function logError(...a: unknown[]) {
  const line = a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')
  console.error(line); logLines.push('[ERROR] ' + line)
}
function writeLogFile(prefix: string) {
  const dir = './logs'; fs.mkdirSync(dir, { recursive: true })
  const fp = path.join(dir, `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)
  fs.writeFileSync(fp, logLines.join('\n')); console.log(`\nFull output saved to ${fp}`)
}

const DRY_RUN = !process.argv.includes('--live')

// --prefer-fdc treats USDA as authoritative where it has the product and
// REPLACES our ingredient list with theirs.
//
// Justified, but not by default. FDC records come from the manufacturer's own
// label submission; ours come from volunteer transcription, which has
// demonstrably produced damaged text ("molassesi", "brown mustard seds",
// "' a salt"). Where the two differ on spelling or completeness, USDA is
// simply the better record.
//
// It is off by default because some differences are NOT transcription errors:
// a product genuinely reformulated (Pacific's soup lists canola in one source
// and high-oleic sunflower in the other), and neither source is wrong — they
// describe different versions. Replacing wholesale also discards the organic
// markers and list positions parsed from the original label. So this is a
// deliberate choice per run, and the log says which products it overwrote.
const PREFER_FDC = process.argv.includes('--prefer-fdc')
const API_KEY = process.env.FDC_API_KEY

if (!API_KEY) {
  console.error('Missing FDC_API_KEY in .env')
  console.error('Get a free key at https://fdc.nal.usda.gov/api-key-signup.html, then add:')
  console.error('  FDC_API_KEY=your-key')
  process.exit(1)
}

// api.data.gov allows 1,000 requests/hour with a personal key. 1s spacing is
// comfortably inside that while still finishing a 60-product run in a minute.
const DELAY_MS = 1000
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

// Compare barcodes on digits with leading zeros stripped — the same
// normalization used for the Non-GMO sheet, since 12-digit UPC-A and 13-digit
// EAN forms of the same code differ only by padding.
function normalizeUpc(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '')
}

// FDC's search is keyword-based, so the barcode has to be spelled the way the
// record spells it. Our UPCs are stored inconsistently (12-digit UPC-A,
// 13-digit EAN with a leading zero), and FDC commonly holds the 12-digit form.
// Searching "0038000332128" when the record says "038000332128" returns
// nothing — which is why an early version reported 51 of 54 products "not in
// FDC", including household brands that are certainly in it.
function upcQueryForms(upc: string): string[] {
  const digits = upc.replace(/\D/g, '')
  const stripped = digits.replace(/^0+/, '')
  const forms = new Set<string>([
    digits,
    stripped,
    stripped.padStart(12, '0'),
    stripped.padStart(13, '0'),
    stripped.padStart(14, '0'),
  ])
  return [...forms].filter(Boolean)
}

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((t) => t.length > 2 && !['the', 'and', 'with', 'organic'].includes(t))
      .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t))
  )
}

async function main() {
  const products = await prisma.product.findMany({
    where: { upc: { not: null }, productType: 'food_beverage' },
    include: { productIngredients: { include: { ingredient: true } } },
  })
  log(`Checking ${products.length} food product(s) with a UPC against USDA FoodData Central.\n`)

  let filled = 0, agreed = 0, disagreed = 0, notFound = 0, nameMismatch = 0, replaced = 0, keptShorter = 0

  for (const product of products) {
    // Try each spelling of the barcode until one returns a record whose own
    // gtinUpc matches ours.
    let match: Record<string, unknown> | undefined
    let matchedForm = ''
    for (const form of upcQueryForms(product.upc!)) {
      const url =
        `https://api.nal.usda.gov/fdc/v1/foods/search` +
        `?query=${encodeURIComponent(form)}` +
        `&dataType=Branded&pageSize=25&api_key=${API_KEY}`

      let response: Response
      try {
        response = await fetch(url)
      } catch (err) { logError(`Network error for ${product.name}:`, err); break }

      if (!response.ok) {
        logError(`HTTP ${response.status} for ${product.name}. A 403 usually means the API key was rejected.`)
        break
      }

      const data = await response.json()
      // Require the returned record's own gtinUpc to match ours — the search
      // is keyword-based and returns loosely related products otherwise.
      match = (data.foods ?? []).find(
        (f: Record<string, unknown>) => normalizeUpc(f.gtinUpc) === normalizeUpc(product.upc)
      )
      if (match) { matchedForm = form; break }
      await sleep(DELAY_MS)
    }

    if (!match) {
      notFound++
      log(`NOT IN FDC: "${product.name}" (${product.upc}) — tried ${upcQueryForms(product.upc!).join(', ')}`)
      await sleep(DELAY_MS); continue
    }

    const fdcName = String(match.description ?? '')
    const fdcBrand = String(match.brandOwner ?? match.brandName ?? '')
    const fdcIngredients = String(match.ingredients ?? '')
    const fdcUrl = `https://fdc.nal.usda.gov/food-details/${match.fdcId}/nutrients`

    // Does FDC think this barcode is the same product we do? This is the check
    // that would have caught "Sunrise Crunchy Maple" sitting on the barcode for
    // Sunrise Crunchy Honey.
    const ours = tokens(product.name)
    const theirs = tokens(fdcName)
    const shared = [...ours].filter((t) => theirs.has(t)).length
    if (ours.size > 0 && theirs.size > 0 && shared === 0) {
      nameMismatch++
      log(`⚠ NAME MISMATCH: we call ${product.upc} "${product.name}"; USDA calls it "${fdcName}" (${fdcBrand}). A UPC identifies one product — check ours.`)
      // Stop here. Comparing ingredients now is worse than useless: if our
      // record is on the wrong barcode, our ingredients came from that same
      // wrong barcode, so they will "agree" with USDA and the agreement will
      // read as validation. That is exactly what happened with a product filed
      // as shredded mozzarella whose barcode is actually heavy whipping cream.
      log('  Skipping ingredient comparison — the product identity is in doubt, so any agreement would be misleading.')
      await sleep(DELAY_MS)
      continue
    }

    if (matchedForm && normalizeUpc(matchedForm) !== normalizeUpc(product.upc)) {
      log(`  (matched using barcode form "${matchedForm}")`)
    }

    const existing = product.productIngredients.length

    if (existing === 0 && fdcIngredients) {
      // FILL: we had nothing, FDC has a manufacturer-submitted list.
      const parsed = parseIngredientsText(fdcIngredients)
      filled++
      log(`FILL: "${product.name}" — no ingredients on file; USDA lists ${parsed.length}.`)
      log(`  ${parsed.map((p) => p.name).join(' | ')}`)

      if (!DRY_RUN) {
        // Shared helper — resolves ingredients, then writes links + status in
        // one short transaction (see src/lib/ingredientStore.ts).
        await replaceProductIngredients(prisma, product.id, parsed, {
          ingredientDisclosureStatus: 'disclosed',
          ingredientCheckedAt: new Date(),
          ingredientSource: 'usda_fooddata_central',
          ingredientSourceUrl: fdcUrl,
        })
        log('  Written.')
      }
    } else if (existing > 0 && fdcIngredients) {
      // CHECK: compare, never overwrite.
      const parsed = parseIngredientsText(fdcIngredients)
      const ourSet = new Set(product.productIngredients.map((pi) => pi.ingredient.name.toLowerCase()))
      const theirSet = new Set(parsed.map((p) => p.name.toLowerCase()))
      const onlyOurs = [...ourSet].filter((n) => !theirSet.has(n))
      const onlyTheirs = [...theirSet].filter((n) => !ourSet.has(n))

      if (onlyOurs.length === 0 && onlyTheirs.length === 0) {
        agreed++
        log(`AGREE: "${product.name}" — our ${existing} ingredients match USDA exactly.`)
      } else {
        disagreed++
        log(`DIFFER: "${product.name}" (ours: ${existing}, USDA: ${parsed.length})`)
        if (onlyTheirs.length) log(`  only in USDA: ${onlyTheirs.join(', ')}`)
        if (onlyOurs.length) log(`  only in ours: ${onlyOurs.join(', ')}`)
        log(`  USDA record: ${fdcUrl}`)

        // A much SHORTER USDA list is usually a terser declaration, not a
        // correction. Pacific's bone broth reads "ORGANIC CHICKEN BONE BROTH,
        // APPLE CIDER VINEGAR" at USDA while the label transcription carries
        // the full breakdown (water, chicken, onions, carrots, celery, spices,
        // rosemary extract). Replacing there destroys real detail, so keep
        // ours and flag it instead.
        const muchShorter = parsed.length < Math.max(2, Math.ceil(existing * 0.6))

        if (PREFER_FDC && muchShorter) {
          keptShorter++
          log(`  KEPT OURS — USDA lists only ${parsed.length} vs our ${existing}. A shorter declaration is not a correction; replacing would lose detail. Review manually if you disagree.`)
        } else if (PREFER_FDC) {
          replaced++
          log('  REPLACING with the USDA list (--prefer-fdc).')
          if (!DRY_RUN) {
            // Shared helper — see src/lib/ingredientStore.ts
            await replaceProductIngredients(prisma, product.id, parsed, {
              ingredientCheckedAt: new Date(),
              ingredientSource: 'usda_fooddata_central',
              ingredientSourceUrl: fdcUrl,
            })
            log('  Replaced.')
          }
        } else {
          log('  NOT overwritten — decide which source is right, or re-run with --prefer-fdc. USDA comes from the manufacturer; ours came from crowdsourced label transcription.')
        }
      }
    }

    await sleep(DELAY_MS)
  }

  log(`\nDone. ${filled} filled, ${agreed} agreed, ${disagreed} differ, ${replaced} replaced from USDA, ${keptShorter} kept (USDA shorter), ${notFound} not in FDC, ${nameMismatch} name mismatch(es).`)
  log('Differences are NOT auto-resolved: a manufacturer submission and a crowdsourced transcription can each be wrong, and which one to trust is a judgement.')

  if (DRY_RUN) {
    log(PREFER_FDC
      ? 'DRY RUN — nothing written. Re-run with --live --prefer-fdc to fill AND replace.'
      : 'DRY RUN — nothing written. Re-run with --live to write FILL cases, or add --prefer-fdc to also replace differing lists.')
  } else {
    await prisma.ingestionLog.create({
      data: { source: 'usda_fooddata_central', recordsMatched: filled, fileName: 'FoodData Central API (no file — live query)' },
    })
    log('Logged this run to IngestionLog.')
  }
}

main().catch((e) => logError(e)).finally(async () => {
  writeLogFile('ingest-fooddata-central'); await prisma.$disconnect()
})

// Finds UPCs for EXISTING products that don't have one, by searching Open Food
// Facts under the company's own brand names and matching on product name.
//
// Distinct from discover-products.ts, which CREATES new products. This only
// fills in the barcode on products already in the database, so their
// ingredients and nutrition can then be pulled by the ingest scripts.
//
// Matching is deliberately conservative. A wrong UPC is worse than a missing
// one — it silently attaches another product's ingredients to this one — so
// only high-confidence matches are applied, and everything else is printed
// for a human to decide.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { userAgent } from '@/lib/userAgent'
import { normalizeUpc } from '@/lib/upc'
import * as fs from 'fs'
import * as path from 'path'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const logLines: string[] = []
function log(...args: unknown[]) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ')
  console.log(line)
  logLines.push(line)
}
function writeLogFile(prefix: string) {
  const dir = './logs'
  fs.mkdirSync(dir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(dir, `${prefix}-${timestamp}.txt`)
  fs.writeFileSync(filePath, logLines.join('\n'))
  console.log(`\nFull output saved to ${filePath}`)
}

// Usage:
//   npx tsx scripts/resolve-upcs.ts            (dry run — shows candidates)
//   npx tsx scripts/resolve-upcs.ts --live     (applies high-confidence matches)
const DRY_RUN = process.argv[2] !== '--live'

// Name-similarity score (0-1) required to apply a UPC automatically.
// Below this, the best candidate is printed for manual review but not applied.
// 0.8 in practice means a short name (3-4 words) must match on every word.
// That matters: at 0.6, "Sprouted Spelt Flour" auto-matched "Sprouted Whole
// Wheat Flour" (67%) — the generic words outvoted the one word that actually
// identifies the product. For short names the distinguishing word is often the
// only one that matters, so it must not be allowed to go missing.
const AUTO_APPLY_THRESHOLD = 0.8

// Real contact address comes from CONTACT_EMAIL in .env — see src/lib/userAgent.ts
const USER_AGENT = userAgent()
const DELAY_MS = 3000
const MAX_RETRIES = 3
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Same collision list as discover-products.ts — brand searches known to
// return a different company's products.
const BRAND_SEARCH_EXCLUSIONS: Record<string, string[]> = {
  'TOMY International, Inc.': ['Boon'],
  'The Honest Company, Inc.': ['Honest'],
}

// Only food products — Open Food Facts rarely carries useful data for
// diapers, bottles and similar, which need manufacturer disclosures instead.
const PRODUCT_TYPES = ['food_beverage']

function normalizeBrand(name: string): string {
  return name
    .toUpperCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[.,'']/g, '')
    .replace(/^\s*THE\s+/, '')
    .replace(/\b(LLC|INC|INCORPORATED|CO|CORP|CORPORATION|LTD|COMPANY)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Words that carry no identifying information about WHICH product it is
const NAME_STOPWORDS = new Set([
  'organic', 'the', 'and', 'with', 'of', 'a', 'an', '&', '+', 'by', 'oz', 'g', 'ml', 'pack',
])

function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !NAME_STOPWORDS.has(t))
      // Crude singularisation so "cookies" matches "cookie". Only strips a
      // trailing "s" from longer words, to avoid mangling short ones.
      .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t))
  )
}

// Share of OUR product's name tokens that appear in the candidate's name.
// Measured from our side so a longer Open Food Facts name (which often adds
// size and flavour detail) isn't penalised for being more specific.
function nameSimilarity(ours: string, theirs: string): number {
  const a = nameTokens(ours)
  const b = nameTokens(theirs)
  if (a.size === 0) return 0
  let hits = 0
  for (const t of a) if (b.has(t)) hits++
  return hits / a.size
}

async function fetchWithRetry(url: string): Promise<Response | null> {
  let response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  let retries = 0
  while ((response.status === 429 || response.status === 503) && retries < MAX_RETRIES) {
    retries++
    await sleep(DELAY_MS * (retries + 1))
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  }
  return response.ok ? response : null
}

async function main() {
  const products = await prisma.product.findMany({
    where: { upc: null, productType: { in: PRODUCT_TYPES } },
    include: { company: true },
  })
  log(`Resolving UPCs for ${products.length} product(s) without one...\n`)

  let applied = 0
  let needsReview = 0
  let noCandidate = 0
  let searchFailed = 0

  for (const product of products) {
    const company = product.company
    const excluded = (BRAND_SEARCH_EXCLUSIONS[company.legalName] ?? []).map((b) => b.toLowerCase())
    const brands = [company.legalName, ...company.dbaNames].filter(
      (b) => !excluded.includes(b.toLowerCase())
    )
    const brandNorms = brands.map(normalizeBrand)

    let best: { upc: string; name: string; score: number; brand: string } | null = null
    // Track whether any search actually succeeded. If every brand search
    // failed (rate limiting, server errors), "no match" would be a false
    // claim — we didn't check, rather than checked and found nothing.
    let searchesSucceeded = 0
    let searchesFailed = 0

    for (const brand of brands) {
      const url =
        `https://world.openfoodfacts.org/api/v2/search` +
        `?brands_tags=${encodeURIComponent(brand)}` +
        `&fields=code,product_name,brands&page_size=100`

      const response = await fetchWithRetry(url)
      await sleep(DELAY_MS)
      if (!response) {
        searchesFailed++
        log(`  search failed for brand "${brand}" (after retries)`)
        continue
      }
      searchesSucceeded++

      const data = await response.json()
      for (const cand of data.products ?? []) {
        const candName = String(cand.product_name ?? '')
        // Canonical 13-digit form (src/lib/upc.ts); also drops mistyped and
        // GS1 restricted/in-store barcodes.
        const normalized = normalizeUpc(cand.code)
        if (!normalized.ok || !candName) continue
        const upc = normalized.upc

        // Brand must genuinely match — same guard as discovery.
        const candBrands = String(cand.brands ?? '').split(',').map(normalizeBrand)
        if (!candBrands.some((b) => brandNorms.includes(b))) continue

        // Remove the company's own brand words from OUR product name before
        // scoring — the brand is already verified above, so "Alden's" in
        // "Alden's Organic Cookies and Cream Ice Cream" shouldn't count as a
        // missing word when Open Food Facts titles it "Cookies & Cream Ice Cream".
        const brandWords = new Set(brands.flatMap((b) => [...nameTokens(b)]))
        const ourName = [...nameTokens(product.name)].filter((t) => !brandWords.has(t)).join(' ')
        const score = nameSimilarity(ourName || product.name, candName)
        if (!best || score > best.score) {
          best = { upc, name: candName, score, brand: String(cand.brands) }
        }
      }
    }

    if (searchesSucceeded === 0) {
      searchFailed++
      log(`FAILED:    "${product.name}" (${company.legalName}) — every brand search failed; NOT checked. Re-run later.`)
      continue
    }

    if (!best || best.score === 0) {
      noCandidate++
      const partial = searchesFailed > 0 ? ` (${searchesFailed} of ${brands.length} brand searches failed — result may be incomplete)` : ''
      log(`NO MATCH:  "${product.name}" (${company.legalName})${partial}`)
      continue
    }

    const scoreText = `${Math.round(best.score * 100)}%`

    // Only check for an existing owner when the match is strong. Checking
    // first meant any weak candidate that happened to be in the database was
    // reported as a "possible duplicate" — e.g. a beet smoothie flagged as a
    // duplicate of a pumpkin puff. A weak match is a REVIEW, not a duplicate.
    const taken = best.score >= AUTO_APPLY_THRESHOLD
      ? await prisma.product.findFirst({ where: { upc: best.upc } })
      : null

    if (taken) {
      needsReview++
      log(`TAKEN:     "${product.name}" -> best match "${best.name}" (${best.upc}) already belongs to "${taken.name}". Possible duplicate product — review.`)
      continue
    }

    if (best.score >= AUTO_APPLY_THRESHOLD) {
      applied++
      log(`APPLY:     "${product.name}" -> "${best.name}" (UPC ${best.upc}, name match ${scoreText})`)
      if (!DRY_RUN) {
        await prisma.product.update({ where: { id: product.id }, data: { upc: best.upc } })
      }
    } else {
      needsReview++
      log(`REVIEW:    "${product.name}" -> closest is "${best.name}" (UPC ${best.upc}, name match ${scoreText}) — below threshold, not applied.`)
    }
  }

  log(`\nDone. ${applied} to apply, ${needsReview} need review, ${noCandidate} with no candidate, ${searchFailed} not checked (search failed).`)
  log(DRY_RUN ? 'DRY RUN — nothing written. Re-run with --live to apply.' : 'Applied. Run the ingest scripts to pull ingredients for these products.')
}

main()
  .catch((e) => log('[ERROR]', e instanceof Error ? e.message : String(e)))
  .finally(async () => {
    writeLogFile('resolve-upcs')
    await prisma.$disconnect()
  })

// Discovers additional products for companies ALREADY IN the database by
// searching Open Food Facts / Open Beauty Facts by brand name, and creates
// Product records with real UPCs.
//
// WHY THIS APPROACH: hand-hunting barcodes from retailer sites is slow and
// error-prone (a single wrong digit silently pulls a completely different
// product). Sourcing UPCs from Open*Facts itself guarantees (a) the barcode
// is real, and (b) the product actually exists in the database the ingestion
// scripts will later query — so nothing is added that can't be enriched.
//
// SCOPE RULE: only creates products under companies ALREADY in the database.
// It will never create a new Company. This follows the project rule that a
// new product under an already-vetted company may be auto-cached, but an
// unvetted company must go through human review first.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { userAgent } from '@/lib/userAgent'
import { normalizeUpc } from '@/lib/upc'
import { mapOffFoodCategory } from '@/lib/offCategoryMap'
import { BRAND_EXCLUSIONS } from '@/lib/brandMatching'
import { VETTED_COMPANIES } from '@/lib/vetting'
import * as fs from 'fs'
import * as path from 'path'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// --- LOGGING ---
const logLines: string[] = []
function log(...args: unknown[]) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ')
  console.log(line)
  logLines.push(line)
}
function logError(...args: unknown[]) {
  const line = args
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')
  console.error(line)
  logLines.push('[ERROR] ' + line)
}
function writeLogFile(prefix: string) {
  const dir = './logs'
  fs.mkdirSync(dir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(dir, `${prefix}-${timestamp}.txt`)
  fs.writeFileSync(filePath, logLines.join('\n'))
  console.log(`\nFull output saved to ${filePath}`)
}

// --- CONFIG ---
// Usage:
//   npx tsx scripts/discover-products.ts             (dry run)
//   npx tsx scripts/discover-products.ts --live      (creates products)
const DRY_RUN = process.argv[2] !== '--live'

// Cap per company so one large brand doesn't flood the database
const MAX_PRODUCTS_PER_COMPANY = 5

// Brand-collision exclusions now live in src/lib/brandMatching.ts, shared
// with the bulk import so both honor the same list.
const BRAND_SEARCH_EXCLUSIONS = BRAND_EXCLUSIONS

// Individual products to never import, by UPC. For one-off bad matches where
// the brand search itself is otherwise useful and worth keeping.
const UPC_EXCLUSIONS = new Set<string>([
  '8906163076666', // "Riz Étuvé Grains Long Sella Indien" — Indian rice, not Jovial Foods
])

// Product-name keywords indicating a NON-FOOD item. Open*Facts routinely
// misfiles diapers, wipes and similar under its food database (the same issue
// seen with WaterWipes), so its own product_type field cannot be trusted for
// these. Without this, the food ingestion script would try to write a
// nutrition panel for a pack of diapers.
// Includes Dutch terms because Open*Facts has heavy European coverage.
const NON_FOOD_NAME_KEYWORDS = [
  'diaper', 'nappy', 'luiers', 'pull-ups', 'drynites',
  'wipe', 'wipes', 'doekjes', 'babydoekjes',
  'matrasbeschermer', 'mattress',
  'bottle', 'pacifier', 'teether', 'sippy',
]

// Real contact address comes from CONTACT_EMAIL in .env — see src/lib/userAgent.ts
const USER_AGENT = userAgent()
// Open*Facts returned frequent HTTP 503s at 1.2s spacing — this is a
// volunteer-run nonprofit, so back off substantially rather than hammering it.
const DELAY_MS = 3000
const MAX_RETRIES = 2
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Optional: restrict to a single company, so results can be reviewed in
// manageable batches rather than 27 companies at once.
//   npx tsx scripts/discover-products.ts --company "Nature's Path Foods, Inc"
const companyArgIndex = process.argv.indexOf('--company')
const ONLY_COMPANY = companyArgIndex !== -1 ? process.argv[companyArgIndex + 1] : null

// GS1 barcode country prefixes. The prefix indicates where the barcode was
// REGISTERED (not necessarily manufactured), but it is a genuinely useful
// signal for catching brand-name collisions between unrelated companies —
// e.g. a US baby-bottle brand "Boon" versus a Dutch canned-bean brand also
// called "Boon". Not exhaustive; covers the ranges most likely to appear.

function barcodeCountry(upc: string): string | null {
  // Strip any leading zero used to pad a UPC-A into EAN-13 form
  const digits = upc.replace(/\D/g, '')
  const p3 = parseInt(digits.slice(0, 3), 10)
  if (isNaN(p3)) return null
  if (p3 <= 19 || (p3 >= 30 && p3 <= 39) || (p3 >= 60 && p3 <= 139)) return 'US/CA'
  if (p3 >= 300 && p3 <= 379) return 'France'
  if (p3 >= 400 && p3 <= 440) return 'Germany'
  if (p3 >= 500 && p3 <= 509) return 'UK'
  if (p3 >= 560 && p3 <= 569) return 'Portugal'
  if (p3 >= 570 && p3 <= 579) return 'Denmark'
  if (p3 >= 600 && p3 <= 601) return 'South Africa'
  if (p3 >= 690 && p3 <= 699) return 'China'
  if (p3 >= 730 && p3 <= 739) return 'Sweden'
  if (p3 === 750) return 'Mexico'
  if (p3 >= 754 && p3 <= 755) return 'Canada'
  if (p3 >= 760 && p3 <= 769) return 'Switzerland'
  if (p3 >= 800 && p3 <= 839) return 'Italy'
  if (p3 >= 840 && p3 <= 849) return 'Spain'
  if (p3 >= 870 && p3 <= 879) return 'Netherlands'
  if (p3 === 880) return 'South Korea'
  if (p3 === 890) return 'India'
  if (p3 === 893) return 'Vietnam'
  return null
}

// Rough country of the company, derived from its hqLocation text
function companyCountry(hqLocation: string | null): string | null {
  if (!hqLocation) return null
  const hq = hqLocation.toLowerCase()
  if (hq.includes('canada') || hq.includes('british columbia') || hq.includes('quebec')) return 'Canada'
  if (hq.includes('ireland')) return 'Ireland'
  if (hq.includes('united kingdom') || hq.includes('cumbria')) return 'UK'
  if (hq.includes('france')) return 'France'
  // Default assumption: a US state name or plain city means US
  return 'US/CA'
}

function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,'']/g, '')
    .replace(/^\s*THE\s+/, '')
    .replace(/\b(LLC|INC|INCORPORATED|CO|CORP|CORPORATION|LTD|COMPANY)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Open*Facts "brands" is a free-text, crowdsourced field — a search for
// "Boon" can return products whose brand merely CONTAINS that string. Same
// false-positive risk as the regulatory-action scripts, so verify the brand
// actually returned genuinely matches one of our candidate names before
// creating anything.
function isGenuineBrandMatch(offBrands: string, candidateNames: string[]): boolean {
  const brandList = offBrands.split(',').map((b) => normalizeName(b))
  return brandList.some((brand) =>
    candidateNames.some((candidate) => normalizeName(candidate) === brand)
  )
}

async function main() {
  const companies = await prisma.company.findMany({
    // Vetted companies only — this script's whole premise is that it adds
    // products under companies a human has already confirmed.
    where: ONLY_COMPANY ? { ...VETTED_COMPANIES, legalName: ONLY_COMPANY } : VETTED_COMPANIES,
    include: { products: true },
  })

  if (ONLY_COMPANY && companies.length === 0) {
    logError(`No company found with legalName "${ONLY_COMPANY}". Check the exact spelling.`)
    return
  }

  log(`Searching Open*Facts for additional products across ${companies.length} companies...`)

  let createdCount = 0
  let rejectedCount = 0
  let skippedExistingCount = 0

  for (const company of companies) {
    const candidateNames = [company.legalName, ...company.dbaNames]
    // UPCs already in the database, so we don't re-add the same product
    const existingUpcs = new Set(company.products.map((p) => p.upc).filter(Boolean))

    let addedForThisCompany = 0

    const excludedBrands = BRAND_SEARCH_EXCLUSIONS[company.legalName] ?? []

    for (const candidate of candidateNames) {
      if (addedForThisCompany >= MAX_PRODUCTS_PER_COMPANY) break

      if (excludedBrands.some((b) => b.toLowerCase() === candidate.toLowerCase())) {
        log(`  SKIPPING brand search "${candidate}" for ${company.legalName} — known to return a different company's products (see BRAND_SEARCH_EXCLUSIONS).`)
        continue
      }

      const url =
        `https://world.openfoodfacts.org/api/v2/search` +
        `?brands_tags=${encodeURIComponent(candidate)}` +
        `&fields=code,product_name,brands,product_type,categories_tags` +
        `&page_size=25`

      let response: Response
      try {
        response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      } catch (err) {
        logError(`Network error searching "${candidate}":`, err)
        await sleep(DELAY_MS)
        continue
      }

      // Retry on 503 (server busy) — these were frequent and transient
      let retries = 0
      while (response.status === 503 && retries < MAX_RETRIES) {
        retries++
        log(`  HTTP 503 for "${candidate}", retrying (${retries}/${MAX_RETRIES}) after backoff...`)
        await sleep(DELAY_MS * (retries + 1))
        try {
          response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
        } catch (err) {
          logError(`Retry failed for "${candidate}":`, err)
          break
        }
      }

      if (!response.ok) {
        logError(`HTTP ${response.status} searching "${candidate}" (after ${retries} retries)`)
        await sleep(DELAY_MS)
        continue
      }

      const data = await response.json()
      const products = data.products ?? []

      if (products.length === 0) {
        await sleep(DELAY_MS)
        continue
      }

      log(`\n"${candidate}" -> ${data.count ?? products.length} result(s) in Open*Facts`)

      for (const offProduct of products) {
        if (addedForThisCompany >= MAX_PRODUCTS_PER_COMPANY) break

        const rawCode = String(offProduct.code ?? '')
        const productName = String(offProduct.product_name ?? '').trim()
        const brands = String(offProduct.brands ?? '')

        // Skip entries too incomplete to be useful
        if (!rawCode || !productName) continue

        // Put the barcode into the one canonical form stored in Product.upc
        // (see src/lib/upc.ts). This also rejects mistyped barcodes (bad check
        // digit) and GS1 restricted/in-store codes, which aren't real retail
        // barcodes and would otherwise collide across unrelated products.
        const normalized = normalizeUpc(rawCode)
        if (!normalized.ok) {
          rejectedCount++
          log(`  REJECTED (${normalized.reason}): "${productName}" (${rawCode}) — not a usable retail barcode.`)
          continue
        }
        const upc = normalized.upc

        if (UPC_EXCLUSIONS.has(upc)) {
          rejectedCount++
          log(`  REJECTED (excluded UPC): "${productName}" (${upc}) — on the manual exclusion list.`)
          continue
        }

        // Verify the brand genuinely matches — see isGenuineBrandMatch above
        if (!isGenuineBrandMatch(brands, candidateNames)) {
          rejectedCount++
          log(`  REJECTED: "${productName}" — brands field was "${brands}", not a genuine match for ${company.legalName}`)
          continue
        }

        if (existingUpcs.has(upc)) {
          skippedExistingCount++
          continue
        }

        // Also check globally, in case this UPC is attached to another company
        const globalExisting = await prisma.product.findFirst({ where: { upc } })
        if (globalExisting) {
          skippedExistingCount++
          continue
        }

        // Derive productType from which Open*Facts database it lives in.
        // "food" is the default because that database is by far the largest
        // and most complete.
        const offType = String(offProduct.product_type ?? 'food')
        let productType =
          offType === 'beauty' ? 'personal_care'
          : offType === 'product' ? 'household_general'
          : 'food_beverage'

        // Override when the product NAME clearly indicates a non-food item.
        // Open*Facts frequently misfiles diapers and wipes into its food
        // database, so its product_type is not reliable on its own — trusting
        // it would send a pack of diapers to the nutrition-facts ingester.
        const lowerName = productName.toLowerCase()
        if (NON_FOOD_NAME_KEYWORDS.some((kw) => lowerName.includes(kw))) {
          productType = 'baby_child'
          log(`  (productType overridden to baby_child — name indicates a non-food item despite Open*Facts filing it under "${offType}")`)
        }

        // Barcode-origin note — a WARNING, never a rejection.
        //
        // Tried as a hard filter first and it was clearly wrong: multinationals
        // register barcodes in every market they sell in, so a Canadian company
        // (Nature's Path) legitimately has US barcodes, an Irish company
        // (WaterWipes) has UK barcodes, and P&G has Italian and Dutch ones.
        // As a rejection rule it discarded roughly ten times more legitimate
        // products than bad matches — and still missed the case that motivated
        // it (Coca-Cola's "Honest Kids" matching The Honest Company).
        //
        // It remains useful as a REVIEW HINT: an unexpected country is worth a
        // human glance, it just isn't evidence enough to discard a product.
        const bcCountry = barcodeCountry(upc)
        const coCountry = companyCountry(company.hqLocation)
        const countryNote =
          bcCountry !== null && coCountry !== null && bcCountry !== coCountry
            ? `  [NOTE: barcode registered in ${bcCountry}, company HQ in ${coCountry} — verify this is the same company]`
            : ''

        // Category from Open Food Facts' own categories (food only).
        const categoryMatch = productType === 'food_beverage' ? mapOffFoodCategory(offProduct.categories_tags) : null
        const category = categoryMatch?.category ?? null

        log(`  NEW: "${productName}" (UPC ${upc}, type ${productType}, category: ${category ?? 'none'}${categoryMatch ? ` via ${categoryMatch.matchedTag}` : ''}) -> ${company.legalName}${countryNote}`)

        if (!DRY_RUN) {
          await prisma.product.create({
            data: {
              name: productName,
              productType,
              // Mapped from Open Food Facts' own categories where a rule
              // exists (src/lib/offCategoryMap.ts); otherwise null for a human
              // to set. Only food is mapped — see that file.
              category,
              upc,
              companyId: company.id,
            },
          })
        }

        existingUpcs.add(upc)
        createdCount++
        addedForThisCompany++
      }

      await sleep(DELAY_MS)
    }
  }

  log(`\nDone. ${createdCount} new product(s), ${rejectedCount} rejected as brand mismatches, ${skippedExistingCount} already in database.`)
  log('NOTE: products whose Open Food Facts categories matched no rule have category = null and need a human to assign one (see "category: none" above).')

  if (DRY_RUN) {
    log('DRY RUN — nothing was written. Re-run with --live to commit.')
  } else {
    await prisma.ingestionLog.create({
      data: {
        source: 'product_discovery',
        recordsMatched: createdCount,
        fileName: 'Open*Facts brand search (no file — live query)',
      },
    })
    log('Logged this run to IngestionLog.')
  }
}

main()
  .catch((e) => logError(e))
  .finally(async () => {
    writeLogFile('discover-products')
    await prisma.$disconnect()
  })

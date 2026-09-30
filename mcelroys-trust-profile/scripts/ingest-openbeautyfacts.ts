// Ingests non-food product data (cosmetics, personal care, general goods) from
// the Open Beauty Facts / Open Products Facts / Open Pet Food Facts databases.
//
// Uses the unified "product_type=all" endpoint, which searches across ALL FOUR
// Open*Facts databases (Food, Beauty, Pet Food, Products) and redirects to
// whichever one has the product — so a single call covers every source rather
// than requiring four sequential lookups. This matches the "check every known
// database before declaring not-found" rule.
//
// Unlike the food script, this does NOT write NutritionFacts — cosmetics and
// general goods have no nutrition panel. It writes ingredients only.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { userAgent } from '@/lib/userAgent'
import { classifyIngredient } from '@/lib/ingredientClassification'
import { parseIngredientsText } from '@/lib/ingredientParsing'
import { replaceProductIngredients } from '@/lib/ingredientStore'
import { pickEnglishIngredientsText } from '@/lib/offIngredients'
import * as fs from 'fs'
import * as path from 'path'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// --- LOGGING SETUP ---
const logLines: string[] = []

function log(...args: unknown[]) {
  const line = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
    .join(' ')
  console.log(line)
  logLines.push(line)
}

function logError(...args: unknown[]) {
  const line = args
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a)))
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
//   npx tsx scripts/ingest-openbeautyfacts.ts            (dry run, safe)
//   npx tsx scripts/ingest-openbeautyfacts.ts --live      (writes to DB)
const DRY_RUN = process.argv[2] !== '--live'

// Open*Facts asks API clients to identify themselves so they can get in touch
// about usage issues. Update the contact address to a real one.
// Real contact address comes from CONTACT_EMAIL in .env — see src/lib/userAgent.ts
const USER_AGENT = userAgent()

// Open*Facts applies global rate limits to protect their infrastructure from
// abusive crawling. Pause briefly between requests to stay well within them —
// this is a volunteer-run nonprofit database, worth being a good citizen.
const DELAY_MS = 1000
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Which productTypes this script handles. Food products are covered by
// ingest-openfoodfacts.ts instead (which also pulls nutrition data).
const NON_FOOD_PRODUCT_TYPES = ['personal_care', 'baby_child', 'household_general']


async function main() {
  const products = await prisma.product.findMany({
    where: {
      upc: { not: null },
      productType: { in: NON_FOOD_PRODUCT_TYPES },
    },
    include: { company: true },
  })

  log(`Found ${products.length} non-food product(s) with a UPC set.`)
  if (products.length === 0) {
    log('Nothing to do. Note: this script only processes products with productType in ' +
        JSON.stringify(NON_FOOD_PRODUCT_TYPES) + ' AND a upc value set. Food products are handled by ingest-openfoodfacts.ts.')
  }

  let matchCount = 0
  let notFoundCount = 0

  for (const product of products) {
    // The unified endpoint searches ALL FOUR Open*Facts databases at once
    // (Food, Beauty, Pet Food, Products) and redirects to whichever has it.
    const url = `https://world.openfoodfacts.org/api/v2/product/${product.upc}?product_type=all`

    let response: Response
    try {
      response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    } catch (err) {
      logError(`Network error for UPC ${product.upc} (${product.name}):`, err)
      await sleep(DELAY_MS)
      continue
    }

    if (!response.ok) {
      logError(`Error querying UPC ${product.upc} (${product.name}): ${response.status}`)
      await sleep(DELAY_MS)
      continue
    }

    const data = await response.json()

    if (data.status !== 1 || !data.product) {
      notFoundCount++
      log(`NOT FOUND: UPC ${product.upc} (${product.name}) — not present in any of the four Open*Facts databases.`)
      // Checked all four databases and found nothing — a real finding, so the
      // app can tell a shopper no ingredient list was located.
      if (!DRY_RUN) {
        await prisma.product.update({
          where: { id: product.id },
          data: {
            ingredientDisclosureStatus: 'not_disclosed',
            ingredientCheckedAt: new Date(),
          },
        })
      }
      await sleep(DELAY_MS)
      continue
    }

    matchCount++
    const offProduct = data.product

    // Which of the four databases actually had this product — useful context
    // when reviewing, since data quality/completeness varies between them
    const sourceDb = offProduct.product_type ?? 'unknown'
    log(`MATCH: UPC ${product.upc} -> ${product.name} (${product.company.legalName}) [found in: ${sourceDb}]`)

    // English only — see src/lib/offIngredients.ts for why.
    const pick = pickEnglishIngredientsText(offProduct)
    const ingredientsText = pick.kind === 'english' ? pick.text : ''

    // A list exists but not in English: not "not disclosed" (that would be
    // false). Clear stale links from any earlier foreign-language parse and
    // mark unchecked, which the UI treats as "say nothing".
    if (pick.kind === 'not_english') {
      log(`  SKIPPED ingredients: the only ingredient list is in "${pick.lang}", not English. Marked unchecked.`)
      if (!DRY_RUN) {
        await prisma.$transaction([
          prisma.productIngredient.deleteMany({ where: { productId: product.id } }),
          prisma.product.update({
            where: { id: product.id },
            data: {
              ingredientDisclosureStatus: 'unchecked',
              ingredientCheckedAt: new Date(),
              ingredientSource: null,
              ingredientSourceUrl: null,
            },
          }),
        ])
      }
      await sleep(DELAY_MS)
      continue
    }

    // Record whether an ingredient list was actually found. Non-food items
    // (wipes, diapers) frequently have none in Open*Facts — worth stating
    // explicitly so a shopper knows the contents aren't published, rather
    // than seeing a blank section they might read as "nothing in it".
    if (!DRY_RUN) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          ingredientDisclosureStatus: ingredientsText ? 'disclosed' : 'not_disclosed',
          ingredientCheckedAt: new Date(),
          ingredientSource: ingredientsText ? 'open_food_facts' : null,
          ingredientSourceUrl: ingredientsText ? `https://world.openfoodfacts.org/product/${product.upc}` : null,
        },
      })
    }

    if (!ingredientsText) {
      log('  No ingredients_text available for this product — recorded as not_disclosed.')
      await sleep(DELAY_MS)
      continue
    }

    const parsedIngredients = parseIngredientsText(ingredientsText)
    log(`  Raw ingredients_text from source: ${JSON.stringify(ingredientsText)}`)
    log(`  Parsed ${parsedIngredients.length} ingredient(s):`, parsedIngredients.map((i) => i.name).join(' | '))
    const flagged = parsedIngredients.filter((i) => classifyIngredient(i.name).flaggedForResearch)
    if (flagged.length > 0) {
      log(`  ${flagged.length} ingredient(s) flagged for research:`, flagged.map((f) => f.name).join(', '))
    }

    if (!DRY_RUN) {
      // Clear existing links first so re-runs replace rather than accumulate —
      // same delete-then-recreate pattern as the food script
      // Wrapped in a transaction so the delete and the recreate succeed or
      // fail together. Without this, a failure partway through (e.g. a schema
      // mismatch) leaves the product with NO ingredient links at all — the
      // delete having already committed. Learned the hard way.
      // Shared helper — see src/lib/ingredientStore.ts. A failure on one
      // product is logged and skipped rather than ending the run.
      try {
        const written = await replaceProductIngredients(prisma, product.id, parsedIngredients)
        log(`  Wrote ${written} ingredient link(s)`)
      } catch (err) {
        logError(`  FAILED writing ingredients for UPC ${product.upc} (${product.name}) — left unchanged:`, err)
      }
    }

    await sleep(DELAY_MS)
  }

  log(`\nDone. ${matchCount} product(s) matched, ${notFoundCount} not found across all four Open*Facts databases.`)

  if (DRY_RUN) {
    log('DRY RUN — nothing was written. Re-run with --live to commit.')
  } else {
    await prisma.ingestionLog.create({
      data: {
        source: 'open_beauty_facts',
        recordsMatched: matchCount,
        fileName: 'Open*Facts unified API (no file — live query)',
      },
    })
    log('Logged this run to IngestionLog.')
  }
}

main()
  .catch((e) => logError(e))
  .finally(async () => {
    writeLogFile('ingest-openbeautyfacts')
    await prisma.$disconnect()
  })

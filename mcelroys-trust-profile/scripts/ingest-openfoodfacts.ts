// Loads .env into process.env (DATABASE_URL)
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { userAgent } from '@/lib/userAgent'
import { parseIngredientsText } from '@/lib/ingredientParsing'
import { replaceProductIngredients } from '@/lib/ingredientStore'
import { pickEnglishIngredientsText } from '@/lib/offIngredients'
import { buildNutritionFromOff } from '@/lib/offNutrition'
import * as fs from 'fs'
import * as path from 'path'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// --- LOGGING SETUP (same pattern as the other ingestion scripts) ---
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
    .map((a) => {
      // Error objects don't serialize their .message via JSON.stringify by
      // default (it's a non-enumerable property) — pull it out explicitly,
      // otherwise errors get logged as a useless {"name":...} with no message
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`
      return typeof a === 'string' ? a : JSON.stringify(a)
    })
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
//   npx tsx scripts/ingest-openfoodfacts.ts            (dry run, safe, prints only)
//   npx tsx scripts/ingest-openfoodfacts.ts --live      (actually writes to the DB)
const DRY_RUN = !process.argv.includes('--live')

// --only <upc> limits the run to one product, so a single record can be
// re-pulled without touching everything else.
const onlyIdx = process.argv.indexOf('--only')
const ONLY_UPC = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null

// Open Food Facts is crowdsourced; USDA FoodData Central comes from the
// manufacturer. Once a product's ingredients have been taken from USDA, a
// later OFF run must not silently overwrite them with the weaker source —
// that would undo the verification pass every time this script is run.
// --force overrides, for the case where USDA's entry is the poorer one.
const FORCE_OVER_MANUFACTURER = process.argv.includes('--force')

// Open Food Facts asks every API client to send a descriptive User-Agent
// identifying the app, so they can contact you if something's wrong with your usage
// Real contact address comes from CONTACT_EMAIL in .env — see src/lib/userAgent.ts
const USER_AGENT = userAgent()

// Open Food Facts returns HTTP 429 (rate limited) when requests come too fast.
// This script originally had no pacing at all, which was survivable when it
// processed a single product but caused most of the catalog to fail once there
// were dozens. This is a volunteer-run nonprofit — pace generously.
const DELAY_MS = 3000
const MAX_RETRIES = 3
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}


// Open Food Facts' ingredient list comes as one raw text string, e.g.:
//   "Organic oats, organic cane sugar, chocolate (cocoa, sugar, vanilla), sea salt"
// A naive split on every comma would incorrectly break "chocolate (cocoa,
// sugar, vanilla)" into three separate top-level items. This parser instead
// tracks parenthesis depth, so it only splits on commas OUTSIDE parentheses —
// then for any item that has a parenthetical (like "chocolate (...)"), it
// recursively extracts both the outer ingredient ("chocolate") AND each of
// its sub-ingredients ("cocoa", "sugar", "vanilla") as their own entries.
// This flattening is intentional: for filtering purposes ("does this product
// contain X"), what matters is every actual substance present, not just the
// top-level umbrella terms.
async function main() {
  // Only process FOOD products. Without the productType filter, this would
  // also pick up non-food items that happen to have a UPC (e.g. baby wipes)
  // and write them an all-null NutritionFacts record — meaningless, since
  // those products have no nutrition panel at all. Non-food products are
  // handled by ingest-openbeautyfacts.ts instead, which writes ingredients only.
  const products = await prisma.product.findMany({
    where: {
      upc: ONLY_UPC ? ONLY_UPC : { not: null },
      productType: 'food_beverage',
    },
    include: { company: true },
  })

  log(`Found ${products.length} product(s) with a UPC set.`)

  let matchCount = 0
  let notFoundCount = 0

  for (const product of products) {
    const url = `https://world.openfoodfacts.org/api/v2/product/${product.upc}.json`

    let response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    })

    // Retry on 429 (rate limited) and 503 (server busy) with escalating
    // backoff — both are transient and both were common at this volume.
    let retries = 0
    while ((response.status === 429 || response.status === 503) && retries < MAX_RETRIES) {
      retries++
      const backoff = DELAY_MS * (retries + 1)
      log(`  HTTP ${response.status} for UPC ${product.upc}, retrying (${retries}/${MAX_RETRIES}) after ${backoff}ms...`)
      await sleep(backoff)
      response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    }

    if (!response.ok) {
      logError(`Error querying Open Food Facts for UPC ${product.upc} (${product.name}): ${response.status} (after ${retries} retries)`)
      await sleep(DELAY_MS)
      continue
    }

    const data = await response.json()

    if (data.status !== 1 || !data.product) {
      notFoundCount++
      log(`NOT FOUND: UPC ${product.upc} (${product.name}) — no matching product in Open Food Facts.`)
      // We checked and found nothing. Record that as a real finding so the
      // app can tell a shopper no ingredient list was located, rather than
      // silently showing an empty section.
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
    // Per-serving conversion and its safety rules live in src/lib/offNutrition.ts,
    // shared with the bulk import so the two can't drift apart.
    const nutrition = buildNutritionFromOff(offProduct, product.upc!)
    for (const note of nutrition.notes) log(`  NOTE (UPC ${product.upc}): ${note}`)

    log(`MATCH: UPC ${product.upc} -> ${product.name} (${product.company.legalName})`)
    log(nutrition.data)

    if (!DRY_RUN && nutrition.data) {
      const existing = await prisma.nutritionFacts.findUnique({
        where: { productId: product.id },
      })

      // Never overwrite nutrition that came from somewhere better than OFF
      // (a hand correction from the manufacturer or a retailer listing, e.g.
      // the La Tourangelle olive oil fix). Same idea as the USDA-ingredients
      // guard below; --force overrides.
      if (existing && existing.sourceType !== 'crowdsourced' && !FORCE_OVER_MANUFACTURER) {
        log(`  KEPT existing NutritionFacts (source: ${existing.sourceType}) — not overwriting with Open Food Facts. Use --force to override.`)
      } else if (existing) {
        await prisma.nutritionFacts.update({
          where: { id: existing.id },
          data: nutrition.data,
        })
        log('  Updated existing NutritionFacts record')
      } else {
        await prisma.nutritionFacts.create({
          data: { ...nutrition.data, productId: product.id },
        })
        log('  Created new NutritionFacts record')
      }
    }

    // --- Ingredients (best-effort parse, see parseIngredientsText comment above) ---
    // English only — see src/lib/offIngredients.ts for why.
    const pick = pickEnglishIngredientsText(offProduct)
    const ingredientsText = pick.kind === 'english' ? pick.text : ''

    if (
      product.ingredientSource === 'usda_fooddata_central' &&
      !FORCE_OVER_MANUFACTURER
    ) {
      log(`  SKIPPING ingredients: this product's list came from USDA (manufacturer-submitted). Use --force to overwrite with Open Food Facts.`)
      await sleep(DELAY_MS)
      continue
    }

    // The product HAS an ingredient list, just not in English. That is not
    // "not disclosed" — saying so would be false. Clear any links left by an
    // earlier run that parsed the foreign-language text, and mark the product
    // unchecked, which the UI treats as "say nothing".
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

    // Record whether an ingredient list was actually found. "not_disclosed"
    // here means the product exists in the source but carries no ingredient
    // list — a real finding a shopper should see, not an empty section.
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
    }

    if (ingredientsText) {
      const parsedIngredients = parseIngredientsText(ingredientsText)
      log(`  Parsed ${parsedIngredients.length} ingredient(s) from ingredients_text`)

      if (!DRY_RUN) {
        // Clear this product's existing ingredient links first. Without this,
        // re-running the script (e.g. after a parsing fix, or because the
        // product's real ingredient list changed) would just ADD new links
        // alongside old ones instead of replacing them — exactly what
        // happened here (dirty "Brown rice flour*" and clean "Brown rice
        // flour" both ending up linked to the same product as separate rows).
        // ProductIngredient should reflect the CURRENT known list, not an
        // accumulating history, so delete-then-recreate is the correct
        // pattern here — unlike OrganicCertification/RegulatoryAction, where
        // we deliberately update-in-place to preserve reviewerId/reviewDate
        // history on individual records.
        // Wrapped in a transaction so the delete and the recreate succeed or
        // fail together. Without this, a failure partway through (e.g. a
        // schema mismatch) leaves the product with NO ingredient links at all
        // — the delete having already committed. Learned the hard way.
        // Shared helper — resolves ingredients first, then swaps the links in
        // one short transaction (see src/lib/ingredientStore.ts). A failure
        // on one product is logged and skipped rather than ending the run.
        try {
          const written = await replaceProductIngredients(prisma, product.id, parsedIngredients)
          log(`  Wrote ${written} ingredient link(s)`)
        } catch (err) {
          logError(`  FAILED writing ingredients for UPC ${product.upc} (${product.name}) — left unchanged:`, err)
        }
      }
    }

    // Pace requests so we don't trip Open Food Facts' rate limiter. This runs
    // at the end of EVERY iteration — including ones that hit `continue`
    // above, since a failed request still counts against the limit.
    await sleep(DELAY_MS)
  }

  log(`\nDone. ${matchCount} product(s) matched, ${notFoundCount} not found in Open Food Facts.`)

  if (DRY_RUN) {
    log('DRY RUN — nothing was written. Re-run with --live to commit.')
  } else {
    await prisma.ingestionLog.create({
      data: {
        source: 'open_food_facts',
        recordsMatched: matchCount,
        fileName: 'Open Food Facts API (no file — live query)',
      },
    })
    log('Logged this run to IngestionLog.')
  }
}

main()
  .catch((e) => logError(e))
  .finally(async () => {
    writeLogFile('ingest-openfoodfacts')
    await prisma.$disconnect()
  })

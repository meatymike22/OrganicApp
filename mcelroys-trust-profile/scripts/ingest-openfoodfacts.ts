// Loads .env into process.env (DATABASE_URL)
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
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
const DRY_RUN = process.argv[2] !== '--live'

// Open Food Facts asks every API client to send a descriptive User-Agent
// identifying the app, so they can contact you if something's wrong with your usage
const USER_AGENT = 'Rootify/1.0 (contact: your-email@example.com)'

// Classification rules for ingredients that warrant dedicated safety research
// (IngredientStudy records) — this is intentionally the SAME scope Yuka
// actually researches: standardized additives and flagged processing
// categories, not arbitrary whole-food ingredients. Not exhaustive — expand
// these lists as you encounter more real examples in your product data.
const CLASSIFICATION_RULES: { category: string; keywords: string[] }[] = [
  {
    category: 'seed oil',
    keywords: [
      'canola oil', 'rapeseed oil', 'soybean oil', 'corn oil', 'cottonseed oil',
      'sunflower oil', 'safflower oil', 'grapeseed oil', 'rice bran oil',
    ],
  },
  {
    category: 'artificial sweetener',
    keywords: [
      'aspartame', 'sucralose', 'saccharin', 'acesulfame potassium', 'acesulfame-k',
      'neotame', 'advantame',
    ],
  },
  {
    category: 'preservative',
    keywords: [
      'sodium benzoate', 'potassium sorbate', 'bha', 'bht', 'sodium nitrite',
      'sodium nitrate', 'calcium propionate', 'sulfur dioxide', 'sodium metabisulfite',
    ],
  },
  {
    category: 'artificial dye',
    keywords: [
      'red 40', 'yellow 5', 'yellow 6', 'blue 1', 'blue 2', 'green 3',
      'fd&c', 'titanium dioxide',
    ],
  },
  {
    category: 'emulsifier',
    keywords: [
      'polysorbate', 'carrageenan', 'carboxymethylcellulose', 'mono- and diglycerides',
    ],
  },
]

function classifyIngredient(name: string): { category: string | null; flaggedForResearch: boolean } {
  const lower = name.toLowerCase()
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) {
      return { category: rule.category, flaggedForResearch: true }
    }
  }
  return { category: null, flaggedForResearch: false }
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
function parseIngredientsText(raw: string): { name: string; isOrganicSourced: boolean }[] {
  const results: { name: string; isOrganicSourced: boolean }[] = []

  function cleanName(s: string): string {
    return s
      .replace(/^\*+/, '')
      .replace(/\*+$/, '')
      .replace(/^\d+(\.\d+)?%\s*/, '')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .trim()
  }

  // The "*" marker (leading or trailing) is Open Food Facts' common convention
  // for "this specific ingredient is organic." Check before stripping it.
  function isMarkedOrganic(s: string): boolean {
    const trimmed = s.trim()
    return trimmed.startsWith('*') || trimmed.endsWith('*')
  }

  function splitTopLevel(text: string): string[] {
    let depth = 0
    let current = ''
    const items: string[] = []
    for (const char of text) {
      if (char === '(' || char === '[') {
        depth++
        current += char
      } else if (char === ')' || char === ']') {
        depth--
        current += char
      } else if (char === ',' && depth === 0) {
        items.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    if (current.trim()) items.push(current.trim())
    return items
  }

  function processItem(item: string) {
    const parenStart = item.indexOf('(')
    if (parenStart === -1) {
      const organic = isMarkedOrganic(item)
      const cleaned = cleanName(item)
      if (cleaned.length >= 2) results.push({ name: cleaned, isOrganicSourced: organic })
      return
    }

    let depth = 0
    let parenEnd = -1
    for (let i = parenStart; i < item.length; i++) {
      if (item[i] === '(') depth++
      else if (item[i] === ')') {
        depth--
        if (depth === 0) {
          parenEnd = i
          break
        }
      }
    }

    const rawBefore = item.slice(0, parenStart)
    const before = cleanName(rawBefore)
    const beforeOrganic = isMarkedOrganic(rawBefore)
    const inside = parenEnd !== -1 ? item.slice(parenStart + 1, parenEnd).trim() : ''
    const after = parenEnd !== -1 ? item.slice(parenEnd + 1).trim() : ''

    if (before.length >= 2) results.push({ name: before, isOrganicSourced: beforeOrganic })
    if (inside) {
      for (const subItem of splitTopLevel(inside)) processItem(subItem)
    }
    if (after) processItem(after)
  }

  for (const topLevelItem of splitTopLevel(raw)) {
    processItem(topLevelItem)
  }

  // Dedupe by name, preferring an organic=true entry if the same ingredient
  // name appears both marked and unmarked (rare, but possible from nested parsing)
  const byName = new Map<string, { name: string; isOrganicSourced: boolean }>()
  for (const r of results) {
    const existing = byName.get(r.name)
    if (!existing || (!existing.isOrganicSourced && r.isOrganicSourced)) {
      byName.set(r.name, r)
    }
  }
  return [...byName.values()]
}

async function main() {
  const products = await prisma.product.findMany({
    where: { upc: { not: null } },
    include: { company: true },
  })

  log(`Found ${products.length} product(s) with a UPC set.`)

  let matchCount = 0
  let notFoundCount = 0

  for (const product of products) {
    const url = `https://world.openfoodfacts.org/api/v2/product/${product.upc}.json`

    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    })

    if (!response.ok) {
      logError(`Error querying Open Food Facts for UPC ${product.upc} (${product.name}): ${response.status}`)
      continue
    }

    const data = await response.json()

    if (data.status !== 1 || !data.product) {
      notFoundCount++
      log(`NOT FOUND: UPC ${product.upc} (${product.name}) — no matching product in Open Food Facts.`)
      continue
    }

    matchCount++
    const offProduct = data.product
    const n = offProduct.nutriments ?? {}

    // Open Food Facts gives nutrient values per 100g by default. But we're
    // also storing servingSize (e.g. "1 serving (40 g)") — showing a per-100g
    // number next to a stated serving size would be misleading (it would look
    // like "this serving has 375 calories" when the actual 40g serving has
    // roughly 150). Convert to true per-serving values using serving_quantity
    // (the numeric gram weight OFF provides separately from the display text),
    // so the numbers actually match a real nutrition label for this product.
    const servingGrams = typeof offProduct.serving_quantity === 'number' ? offProduct.serving_quantity : null
    const conversionFactor = servingGrams ? servingGrams / 100 : null

    if (!conversionFactor) {
      log(`  WARNING: no serving_quantity available for UPC ${product.upc} — nutrient values will be stored as per-100g, NOT per-serving. Flag this record for manual review before treating servingSize and the nutrient numbers as matching.`)
    }

    function toServingValue(per100g: number | undefined): number | null {
      if (per100g === undefined || per100g === null) return null
      return conversionFactor ? Math.round(per100g * conversionFactor * 100) / 100 : per100g
    }

    // Sodium: OFF sometimes gives sodium directly (in grams), sometimes only
    // salt (in grams). Salt-to-sodium conversion: sodium = salt / 2.5
    const sodiumG100 = n.sodium_100g ?? (n.salt_100g ? n.salt_100g / 2.5 : undefined)

    const nutritionData = {
      servingSize: offProduct.serving_size ?? null,
      calories: toServingValue(n['energy-kcal_100g']),
      totalFatG: toServingValue(n.fat_100g),
      saturatedFatG: toServingValue(n['saturated-fat_100g']),
      sugarG: toServingValue(n.sugars_100g),
      carbsG: toServingValue(n.carbohydrates_100g),
      sodiumMg: sodiumG100 !== undefined ? toServingValue(sodiumG100 * 1000) : null,
      proteinG: toServingValue(n.proteins_100g),
      sourceUrl: `https://world.openfoodfacts.org/product/${product.upc}`,
      sourceType: 'crowdsourced',
      dataPulledDate: new Date(),
      aiDrafted: false, // structured nutriments data is not AI-interpreted, just relayed
    }

    log(`MATCH: UPC ${product.upc} -> ${product.name} (${product.company.legalName})`)
    log(nutritionData)

    if (!DRY_RUN) {
      const existing = await prisma.nutritionFacts.findUnique({
        where: { productId: product.id },
      })

      if (existing) {
        await prisma.nutritionFacts.update({
          where: { id: existing.id },
          data: nutritionData,
        })
        log('  Updated existing NutritionFacts record')
      } else {
        await prisma.nutritionFacts.create({
          data: { ...nutritionData, productId: product.id },
        })
        log('  Created new NutritionFacts record')
      }
    }

    // --- Ingredients (best-effort parse, see parseIngredientsText comment above) ---
    const ingredientsText = String(offProduct.ingredients_text ?? '')
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
        await prisma.productIngredient.deleteMany({
          where: { productId: product.id },
        })

        for (const { name: ingName, isOrganicSourced } of parsedIngredients) {
          let ingredient = await prisma.ingredient.findUnique({
            where: { name: ingName },
          })

          if (!ingredient) {
            const classification = classifyIngredient(ingName)
            ingredient = await prisma.ingredient.create({
              data: {
                name: ingName,
                category: classification.category,
                flaggedForResearch: classification.flaggedForResearch,
              },
            })
          }

          await prisma.productIngredient.create({
            data: {
              productId: product.id,
              ingredientId: ingredient.id,
              isOrganicSourced,
            },
          })
        }
      }
    }
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
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
const USER_AGENT = 'Rootify/1.0 (contact: your-email@example.com)'

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

// Classification rules — same approach as the food script, but oriented toward
// cosmetic/personal-care ingredients of concern rather than food additives.
// Not exhaustive; expand as you encounter real examples in your data.
const CLASSIFICATION_RULES: { category: string; keywords: string[] }[] = [
  {
    category: 'paraben preservative',
    keywords: ['paraben', 'methylparaben', 'propylparaben', 'butylparaben', 'ethylparaben'],
  },
  {
    category: 'phthalate',
    keywords: ['phthalate', 'dbp', 'dehp', 'diethyl phthalate'],
  },
  {
    category: 'formaldehyde releaser',
    keywords: ['formaldehyde', 'quaternium-15', 'dmdm hydantoin', 'imidazolidinyl urea', 'diazolidinyl urea'],
  },
  {
    category: 'sulfate surfactant',
    keywords: ['sodium lauryl sulfate', 'sodium laureth sulfate', 'ammonium lauryl sulfate'],
  },
  {
    category: 'undisclosed fragrance',
    // "Fragrance"/"parfum" can legally conceal dozens of undisclosed component
    // chemicals under trade-secret protections — worth flagging for research.
    keywords: ['fragrance', 'parfum'],
  },
  {
    category: 'ethanolamine',
    keywords: ['diethanolamine', 'triethanolamine', 'cocamide dea', 'cocamide mea'],
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

// Identical parsing logic to the food script — handles nested parentheticals,
// organic asterisk markers, and junk fragments. Kept in sync intentionally.
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
      await sleep(DELAY_MS)
      continue
    }

    matchCount++
    const offProduct = data.product

    // Which of the four databases actually had this product — useful context
    // when reviewing, since data quality/completeness varies between them
    const sourceDb = offProduct.product_type ?? 'unknown'
    log(`MATCH: UPC ${product.upc} -> ${product.name} (${product.company.legalName}) [found in: ${sourceDb}]`)

    const ingredientsText = String(offProduct.ingredients_text ?? '')
    if (!ingredientsText) {
      log('  No ingredients_text available for this product — nothing to write.')
      await sleep(DELAY_MS)
      continue
    }

    const parsedIngredients = parseIngredientsText(ingredientsText)
    log(`  Parsed ${parsedIngredients.length} ingredient(s)`)
    const flagged = parsedIngredients.filter((i) => classifyIngredient(i.name).flaggedForResearch)
    if (flagged.length > 0) {
      log(`  ${flagged.length} ingredient(s) flagged for research:`, flagged.map((f) => f.name).join(', '))
    }

    if (!DRY_RUN) {
      // Clear existing links first so re-runs replace rather than accumulate —
      // same delete-then-recreate pattern as the food script
      await prisma.productIngredient.deleteMany({ where: { productId: product.id } })

      for (const { name: ingName, isOrganicSourced } of parsedIngredients) {
        let ingredient = await prisma.ingredient.findUnique({ where: { name: ingName } })

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
      log('  Wrote ingredient links')
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

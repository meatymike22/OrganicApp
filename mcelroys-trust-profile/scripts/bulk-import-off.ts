// BULK IMPORT from the Open Food Facts data export.
//
// Reads OFF's full product export (one JSON product per line, gzipped),
// keeps US food products with usable data, and adds the ones Rootify doesn't
// have yet — with nutrition, English ingredients and a mapped category.
//
// WHY THE EXPORT AND NOT THE API: the API scripts call once per product with
// a 3-second pause (~1,200 products/hour), which would take weeks for a few
// hundred thousand. OFF asks bulk users to download the export instead, and
// it contains the same fields the API returns, so this reuses all the same
// helpers (English-only ingredients, nutrition conversion, normalization).
//
// GET THE FILE (about 7+ GB, updated daily by OFF):
//   https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz
// Save it as ./data/openfoodfacts-products.jsonl.gz — do NOT unzip it; the
// script reads it compressed.
//
// USAGE
//   npx tsx scripts/bulk-import-off.ts ./data/openfoodfacts-products.jsonl.gz
//       Dry run (default). Reads the whole file and reports what WOULD be
//       imported — counts, skip reasons, categories, new brands. Writes nothing.
//   npx tsx scripts/bulk-import-off.ts <file> --live --limit 2000
//       Trial: imports the first 2,000 qualifying products. Do this first and
//       look at the results in the app before the full run.
//   npx tsx scripts/bulk-import-off.ts <file> --live
//       Full import.
//   Other options:
//       --country en:canada   (default en:united-states)
//       --batch 250           (products per database write)
//
// TO UNDO an import: every product it created has importSource =
// 'open_food_facts_bulk', so it can be removed as a unit (ask before doing
// this — child rows must be deleted first).
//
// SAFE TO RE-RUN: products whose UPC is already in the database are skipped,
// so an interrupted run just continues where it left off when restarted.
// Existing products are never modified here — refreshing them is
// ingest-openfoodfacts.ts's job.
//
// HOW THE PROJECT'S RULES APPLY
//   - New brands become UNVETTED companies (legalName = the brand text as
//     seen). They're hidden from the company list, labeled "not yet in
//     Rootify's reviewed database", and skipped by every recall/SEC/organic
//     matcher until a human vets them. See src/lib/vetting.ts.
//   - A brand that exactly matches an existing company (vetted or not) is
//     attached to it — "new product under an existing company may be
//     auto-cached". Known brand collisions are excluded via
//     src/lib/brandMatching.ts. Brands of REJECTED companies are skipped.
//   - Barcodes are normalized/validated (src/lib/upc.ts), ingredients are
//     English-only and normalized, categories come from offCategoryMap.ts,
//     nutrition from offNutrition.ts.
//   - Every NutritionFacts row cites its OFF product page.
//
// LICENSE NOTE: Open Food Facts data is under the Open Database License
// (ODbL), which requires attribution and has share-alike terms for
// derivative databases. That already applied to the API scripts; a bulk copy
// makes it more significant. Add it to the attorney-review list before
// public launch.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { StringDecoder } from 'string_decoder'
import * as zlib from 'zlib'
import { normalizeUpc } from '@/lib/upc'
import { pickEnglishIngredientsText } from '@/lib/offIngredients'
import { buildNutritionFromOff, type OffNutrition } from '@/lib/offNutrition'
import { parseIngredientsText, type ParsedIngredient } from '@/lib/ingredientParsing'
import { classifyIngredient } from '@/lib/ingredientClassification'
import { mapOffFoodCategory } from '@/lib/offCategoryMap'
import { categorizeByName } from '@/lib/nameCategoryMap'
import { normalizeBrandName, isExcludedBrand } from '@/lib/brandMatching'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
// queryPlanCacheMaxSize: 0 — THE fix for the out-of-memory crash on the
// first full run. Prisma 7 caches up to 1,000 query plans by default, and a
// createMany plan embeds that batch's actual rows. Every batch here is
// different, so plans are never reused — the cache just held up to 1,000
// batches of product data (several GB). Found with a heap snapshot: the
// retained objects were Prisma "plans" full of our parameter values.
//
// The cast is needed because the client generated for this project doesn't
// list queryPlanCacheMaxSize in its TypeScript types, even though Prisma's
// runtime accepts and applies it (verified: with it, memory stays flat at
// ~60 MB for the whole run; without it, the run ran out of memory).
//
// transactionOptions: Prisma's default transaction time limit is 5 seconds.
// Each batch writes ~250 products plus several thousand ingredient links in
// one transaction; on a busy database a few took 5.6–7 s and were rolled
// back (the second full run lost 8 batches this way). Two minutes is ample
// for one batch while still catching a genuinely stuck connection.
const clientOptions = {
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0]
const prisma = new PrismaClient(clientOptions)

// --- CONFIG ---
const args = process.argv.slice(2)
const FILE = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a) && !a.startsWith('en:'))
const DRY_RUN = !args.includes('--live')
function argValue(name: string): string | null {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] ?? null : null
}
const COUNTRY = argValue('--country') ?? 'en:united-states'
const LIMIT = argValue('--limit') ? Number(argValue('--limit')) : Infinity
const BATCH_SIZE = argValue('--batch') ? Number(argValue('--batch')) : 250
// Written to Product.importSource and IngestionLog.source
const IMPORT_SOURCE = 'open_food_facts_bulk'
// How often to print progress, in lines read from the file
const PROGRESS_EVERY = 100_000

// Product-name keywords marking a NON-FOOD item. OFF routinely files wipes,
// diapers and similar in its food database (same list as discover-products).
// This import is for food, so those are skipped rather than miscategorized.
const NON_FOOD_NAME_KEYWORDS = [
  'diaper', 'nappy', 'pull-ups', 'wipe', 'wipes', 'mattress',
  'bottle nipple', 'pacifier', 'teether', 'sippy', 'shampoo', 'toothpaste',
  'lotion', 'sunscreen', 'detergent',
]

// Whole-word patterns for household and personal-care items. Added after the
// 2026-09-28 data review found 33 of these in the food database (hand soap,
// all-purpose cleaner, deodorant, "Soft & Strong Bath Tissue" filed under
// Eggs). Whole words so "Premium Dough Conditioner" and "Cake Topper With
// Candle" chocolates are NOT caught.
const NON_FOOD_NAME_PATTERN =
  /\b(bath tissue|toilet paper|paper towels?|multi.?purpose cleaner|all.?purpose cleaner|surface cleaner|bowl cleaner|peroxide cleaner|cleaner paste|hand soap|dish soap|deodorant|anti.?perspirant|laundry|dryer sheets?|fabric softener|dishwasher|wood conditioner|hair conditioner|leave.?in conditioner)\b/i

// Names that aren't names. The review found 31 products called "null",
// "undefined", "Unknown" or "test", and 292 whose name had no Latin letters
// at all (a barcode typed as the name, or Russian/Chinese/Arabic text that
// slipped past the English-name check).
const PLACEHOLDER_NAMES = new Set(['null', 'undefined', 'n/a', 'na', 'none', 'unknown', 'test', 'product', '-', '.'])

// Brands that aren't brands ("N/A", "Unknown", "Generic", "?"). Products with
// these go under the single "Brand not listed" placeholder company (mostly
// loose produce) instead of each creating a fake company of its own.
const PLACEHOLDER_BRAND = /^(null|none|n\/?a|na|unknown|generic|no brand|not applicable|unbranded|brand|private label|store brand|other|various|-|\.|test|test only|undefined|\?+|0|1)$/i
const NO_BRAND_COMPANY_NAME = 'Brand not listed'

// --- LOGGING ---
// Unlike the other scripts, this log is written to disk AS IT GOES, not at
// the end. A multi-hour run that crashes (the first full run ran out of
// memory at ~7 minutes) must still leave a record of how far it got.
const LOG_FILE = path.join(
  './logs',
  `${process.argv.includes('--live') ? 'bulk-import-off' : 'bulk-import-off-dryrun'}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
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

// --- COUNTERS for the end-of-run report ---
const skipped = new Map<string, number>()
function skip(reason: string) {
  skipped.set(reason, (skipped.get(reason) ?? 0) + 1)
}
const categoryCounts = new Map<string, number>()
const unmappedCategoryTags = new Map<string, number>() // most specific tag of unmapped products
const attachedToExisting = new Map<string, number>() // company legalName -> products added
const newBrandCounts = new Map<string, number>() // new unvetted brand -> products
let linesRead = 0
let accepted = 0
let ingredientDisclosed = 0
let nutritionPerServing = 0
let nutritionPer100g = 0
let nutritionNotes = 0
let newIngredientCount = 0
let newCompanyCount = 0
let newFlaggedIngredients = 0
let batchesWritten = 0
let batchesFailed = 0
const failedUpcs: string[] = []
const nutritionWarnings: string[] = [] // "UPC<TAB>name<TAB>warning" for review

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by)
}
function top(map: Map<string, number>, n: number): string {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `    ${v.toLocaleString()}  ${k}`)
    .join('\n')
}

// --- DETACHING STRINGS FROM THE LINE THEY CAME FROM ---
// The real cause of the out-of-memory crash. When V8 (Node's engine) runs
// JSON.parse, a text value of 13+ characters can be stored as a pointer INTO
// the original line rather than as its own copy. A barcode is exactly 13
// characters, so every UPC kept in knownUpcs was silently keeping its whole
// ~15 KB product line alive: 415,000 products x ~15 KB = ~6 GB, past Node's
// 4 GB limit. Same for brand names, category tags and warning text.
// Anything kept for the whole run must be a standalone copy. Prepending a
// character forces V8 to build a new string; slicing it back off leaves one
// that points only at that small new string, not the product line.
function detach(s: string): string {
  return (' ' + s).slice(1)
}

// --- IN-MEMORY CACHES (loaded once, kept current as we go) ---
// Keeping these in memory is what makes this fast: without them every
// product would need several database lookups.
type CompanyRef = { id: string; legalName: string; vettingStatus: string }
const companiesByBrand = new Map<string, CompanyRef>() // normalized brand -> company
const ingredientIds = new Map<string, string>() // ingredient name -> id
const knownUpcs = new Set<string>()

async function loadCaches() {
  const products = await prisma.product.findMany({ where: { upc: { not: null } }, select: { upc: true } })
  for (const p of products) if (p.upc) knownUpcs.add(p.upc)

  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, dbaNames: true, vettingStatus: true },
  })
  // Vetted companies first so that, if two companies normalize to the same
  // name, a brand attaches to the reviewed one.
  companies.sort((a, b) => Number(b.vettingStatus === 'vetted') - Number(a.vettingStatus === 'vetted'))
  for (const c of companies) {
    for (const name of [c.legalName, ...c.dbaNames]) {
      const key = normalizeBrandName(name)
      if (key && !companiesByBrand.has(key)) companiesByBrand.set(key, c)
    }
  }

  const ingredients = await prisma.ingredient.findMany({ select: { id: true, name: true } })
  for (const i of ingredients) ingredientIds.set(i.name, i.id)

  log(`Loaded ${knownUpcs.size.toLocaleString()} existing UPCs, ${companies.length.toLocaleString()} companies, ${ingredients.length.toLocaleString()} ingredients.`)
}

// --- READING THE FILE, ONE LINE AT A TIME, ONLY AS FAST AS WE WRITE ---
// The first full run crashed with "JavaScript heap out of memory" after ~7
// minutes. Cause: Node's readline module keeps reading the file and queuing
// lines in memory even while the script is waiting on the database. In the
// dry run nothing waits, so the queue stayed small; in a live run each batch
// waits on Supabase over a home connection, and the unzipped export (tens
// of GB) piled up in memory until Node hit its 4 GB limit.
//
// This generator PULLS from the stream: the next chunk is only read when
// the loop asks for the next line, so while a batch is being written, the
// file simply waits. Memory stays flat for the whole run.
async function* readLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  // StringDecoder: a multi-byte character (é, ü) can be split across two
  // chunks; the decoder holds the partial bytes instead of corrupting them.
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

// --- ONE BATCH of products waiting to be written ---
type PendingProduct = {
  row: Prisma.ProductCreateManyInput & { id: string; upc: string }
  nutrition: OffNutrition | null
  ingredients: ParsedIngredient[]
}
let batch: PendingProduct[] = []
let batchNewCompanies: (Prisma.CompanyCreateManyInput & { id: string; brandKey: string })[] = []

// Turns one line of the export into a pending product, or records why not.
function processLine(line: string) {
  // Cheap text check BEFORE parsing JSON. The export is tens of GB and most
  // products aren't sold in the target country; skipping them without a
  // full JSON.parse saves most of the run time.
  if (!line.includes(`"${COUNTRY}"`)) return skip('not in target country')

  let p: Record<string, unknown>
  try {
    p = JSON.parse(line)
  } catch {
    return skip('malformed line')
  }

  const countries = Array.isArray(p.countries_tags) ? (p.countries_tags as string[]) : []
  if (!countries.includes(COUNTRY)) return skip('not in target country')
  if (p.obsolete === true || p.obsolete === 'on') return skip('marked obsolete by OFF')

  const upcResult = normalizeUpc(p.code)
  if (!upcResult.ok) return skip(`barcode ${upcResult.reason}`)
  const upc = detach(upcResult.upc) // kept in knownUpcs for the whole run — see detach()
  if (knownUpcs.has(upc)) return skip('already in Rootify')

  // English product name: the English field if present, otherwise the main
  // name only when the product's main language is English.
  const nameEn = String(p.product_name_en ?? '').trim()
  const nameMain = String(p.product_name ?? '').trim()
  const lang = String(p.lang ?? '').toLowerCase()
  const name = nameEn || (lang === 'en' ? nameMain : '')
  if (!name) return skip(nameMain ? 'no English product name' : 'no product name')
  if (name.length > 200) return skip('product name implausibly long')
  if (PLACEHOLDER_NAMES.has(name.toLowerCase())) return skip('placeholder product name')
  if (!/[A-Za-z]/.test(name)) return skip('product name has no Latin letters')

  // First listed brand, whitespace tidied ("The Father's Table  L.L.C." had a double space)
  const brandFirst = (String(p.brands ?? '').split(',')[0] ?? '').replace(/\s+/g, ' ').trim()
  if (!brandFirst) return skip('no brand')
  const brandRaw = detach(PLACEHOLDER_BRAND.test(brandFirst) ? NO_BRAND_COMPANY_NAME : brandFirst)

  const lowerName = name.toLowerCase()
  if (NON_FOOD_NAME_KEYWORDS.some((kw) => lowerName.includes(kw)) || NON_FOOD_NAME_PATTERN.test(name)) {
    return skip('non-food item in food database')
  }

  const ingredientsPick = pickEnglishIngredientsText(p)

  // Parse now, so a list that yields NOTHING usable (OCR garbage, a pasted
  // nutrition panel) can be told apart from a real one. The first full run
  // stored 854 products as "ingredients disclosed" with zero ingredients.
  const ingredients: ParsedIngredient[] =
    ingredientsPick.kind === 'english'
      ? // Known names let "sodium benzoate and potassium sorbate" split into
        // its two ingredients (see splitCompoundName in ingredientParsing.ts)
        parseIngredientsText(ingredientsPick.text, { isKnownIngredient: (n) => ingredientIds.has(n) })
      : []
  const hasUsableIngredients = ingredients.length > 0

  // Parsed BEFORE nutrition: the sodium check needs to know whether salt is
  // near the top of the list (see offNutrition.ts).
  const saltNearTop = ingredients.slice(0, 6).some((i) => i.name === 'salt' || i.name === 'sea salt')
  const nutrition = buildNutritionFromOff(p, upc, { saltNearTop })

  // Worth importing only with SOMETHING a shopper can use.
  if (!hasUsableIngredients && !nutrition.data) {
    return skip(ingredientsPick.kind === 'english' ? 'ingredient text unreadable and no nutrition' : 'no English ingredients and no nutrition')
  }

  // --- Company ---
  const brandKey = detach(normalizeBrandName(brandRaw))
  if (!brandKey) return skip('no brand')
  let company = companiesByBrand.get(brandKey)
  if (company && isExcludedBrand(company.legalName, brandRaw)) company = undefined // known collision
  if (company?.vettingStatus === 'rejected') return skip('brand belongs to a rejected company')

  if (!company) {
    const id = randomUUID()
    company = { id, legalName: brandRaw, vettingStatus: 'unvetted' }
    companiesByBrand.set(brandKey, company)
    batchNewCompanies.push({
      id,
      brandKey,
      legalName: brandRaw,
      vettingStatus: 'unvetted',
      discoverySourceUrl: `https://world.openfoodfacts.org/product/${upc}`,
    })
    newCompanyCount++
    bump(newBrandCounts, brandRaw)
  } else if (company.vettingStatus === 'vetted') {
    bump(attachedToExisting, company.legalName)
  } else {
    bump(newBrandCounts, company.legalName)
  }

  // --- Category ---
  // OFF's own category tags first; if they don't map (or OFF has none, as
  // for ~half of US products), guess from the product name. See
  // src/lib/nameCategoryMap.ts and scripts/categorize-products.ts.
  const offCat = mapOffFoodCategory(p.categories_tags)
  const nameCat = offCat ? null : categorizeByName(name)
  const cat = offCat ?? (nameCat ? { category: nameCat.category, matchedTag: `name:${nameCat.matchedTerm}` } : null)
  if (cat) bump(categoryCounts, cat.category)
  else {
    // "en:null" / "en:undefined" are placeholder values, not categories
    const tags = (Array.isArray(p.categories_tags) ? (p.categories_tags as string[]) : []).filter(
      (t) => !/^en:(null|undefined)$/i.test(String(t))
    )
    bump(unmappedCategoryTags, tags.length ? detach(String(tags[tags.length - 1])) : '(no categories on OFF)')
  }

  if (hasUsableIngredients) ingredientDisclosed++
  const offUrl = `https://world.openfoodfacts.org/product/${upc}`

  if (nutrition.data) {
    if (nutrition.perServing) nutritionPerServing++
    else nutritionPer100g++
  }
  if (nutrition.notes.length) {
    nutritionNotes++
    for (const note of nutrition.notes) nutritionWarnings.push(detach(`${upc}\t${name}\t${note}`))
  }

  knownUpcs.add(upc) // also dedupes repeats within the file
  accepted++
  batch.push({
    row: {
      id: randomUUID(),
      name,
      productType: 'food_beverage',
      category: cat?.category ?? null,
      // Where it came from (see Product.categorySource in schema.prisma)
      categorySource: offCat ? 'open_food_facts' : nameCat ? 'name_estimate' : null,
      upc,
      companyId: company.id,
      // parsed list          → "disclosed"
      // OFF has no list      → "not_disclosed" (a real finding)
      // list exists but not in English, or unreadable → "unchecked": say
      //   nothing, since claiming "not disclosed" would be false
      ingredientDisclosureStatus: hasUsableIngredients
        ? 'disclosed'
        : ingredientsPick.kind === 'none'
          ? 'not_disclosed'
          : 'unchecked',
      ingredientCheckedAt: hasUsableIngredients || ingredientsPick.kind === 'none' ? new Date() : null,
      ingredientSource: hasUsableIngredients ? 'open_food_facts' : null,
      ingredientSourceUrl: hasUsableIngredients ? offUrl : null,
      // Marks every product this script creates (see Product.importSource), so
      // the import can be found, reviewed or rolled back as a unit.
      importSource: IMPORT_SOURCE,
    },
    nutrition: nutrition.data,
    ingredients,
  })
}

// Writes the pending batch. Everything for these products goes in ONE
// transaction, so a failure leaves no half-imported products behind.
async function flushBatch() {
  if (batch.length === 0) return
  const products = batch
  const newCompanies = batchNewCompanies
  batch = []
  batchNewCompanies = []

  // 1. Ingredient names not seen before. Created up front, outside the main
  //    transaction: they're shared rows, safe to create even if this batch
  //    later fails (worst case, an orphan the maintenance cleanup removes).
  const newNames = new Set<string>()
  for (const p of products) for (const i of p.ingredients) if (!ingredientIds.has(i.name)) newNames.add(i.name)

  if (newNames.size > 0) {
    newIngredientCount += newNames.size
    const rows = [...newNames].map((name) => {
      const c = classifyIngredient(name)
      if (c.flaggedForResearch) newFlaggedIngredients++
      return { name, category: c.category, flaggedForResearch: c.flaggedForResearch }
    })
    if (DRY_RUN) {
      for (const r of rows) ingredientIds.set(detach(r.name), 'dry-run')
    } else {
      await prisma.ingredient.createMany({ data: rows, skipDuplicates: true })
      const created = await prisma.ingredient.findMany({
        where: { name: { in: [...newNames] } },
        select: { id: true, name: true },
      })
      for (const c of created) ingredientIds.set(c.name, c.id) // from the database — already standalone
    }
  }

  if (DRY_RUN) {
    batchesWritten++
    return
  }

  // 2. Build the rows
  const nutritionRows: Prisma.NutritionFactsCreateManyInput[] = []
  const linkRows: Prisma.ProductIngredientCreateManyInput[] = []
  for (const p of products) {
    if (p.nutrition) nutritionRows.push({ ...p.nutrition, productId: p.row.id })
    const seen = new Set<string>()
    for (const i of p.ingredients) {
      const ingredientId = ingredientIds.get(i.name)
      if (!ingredientId || seen.has(ingredientId)) continue // one link per ingredient per product
      seen.add(ingredientId)
      linkRows.push({
        productId: p.row.id,
        ingredientId,
        isOrganicSourced: i.isOrganicSourced,
        listPosition: i.listPosition,
        isTrace: i.isTrace,
        concentrationNote: i.concentrationNote,
      })
    }
  }

  // 3. One transaction: companies, products, nutrition, ingredient links
  try {
    await prisma.$transaction([
      prisma.company.createMany({ data: newCompanies.map(({ brandKey: _unused, ...c }) => c) }),
      prisma.product.createMany({ data: products.map((p) => p.row) }),
      prisma.nutritionFacts.createMany({ data: nutritionRows }),
      prisma.productIngredient.createMany({ data: linkRows }),
    ])
    batchesWritten++
  } catch (err) {
    // Out of disk space (Postgres error 53100) is not worth retrying batch
    // after batch — every write will fail until the disk is enlarged. Stop.
    if (String((err as Error)?.message ?? err).includes('No space left on device')) {
      logError('DATABASE DISK IS FULL — stopping. Enlarge the disk in Supabase (Project Settings → Compute and Disk), then re-run; the import resumes where it stopped.')
      throw err
    }
    // The whole batch rolled back. Forget its new companies and UPCs so a
    // re-run can try them again, record the UPCs, and keep going.
    batchesFailed++
    logError(`Batch of ${products.length} failed and was rolled back (UPCs saved to the failed list):`, err)
    for (const c of newCompanies) companiesByBrand.delete(c.brandKey)
    newCompanyCount -= newCompanies.length
    for (const p of products) {
      knownUpcs.delete(p.row.upc)
      failedUpcs.push(p.row.upc)
    }
    accepted -= products.length
  }
}

async function main() {
  if (!FILE || !fs.existsSync(FILE)) {
    logError(`Export file not found: ${FILE ?? '(none given)'}`)
    logError('Download https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz to ./data/ and pass its path.')
    return
  }
  log(`${DRY_RUN ? 'DRY RUN' : 'LIVE RUN'} — ${FILE}, country ${COUNTRY}, batch ${BATCH_SIZE}${LIMIT !== Infinity ? `, limit ${LIMIT}` : ''}`)
  await loadCaches()

  const started = Date.now()
  const input = fs.createReadStream(FILE).pipe(zlib.createGunzip())

  for await (const rawLine of readLines(input)) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    linesRead++
    if (line.trim()) processLine(line)
    if (batch.length >= BATCH_SIZE) await flushBatch()
    if (linesRead % PROGRESS_EVERY === 0) {
      const mins = ((Date.now() - started) / 60000).toFixed(1)
      const mb = Math.round(process.memoryUsage().rss / 1024 / 1024)
      log(`  ...${linesRead.toLocaleString()} lines read, ${accepted.toLocaleString()} products ${DRY_RUN ? 'would be ' : ''}imported (${mins} min, ${mb} MB memory)`)
    }
    if (accepted >= LIMIT) break
  }
  await flushBatch()
  input.destroy() // stop reading if we ended early (--limit)

  // --- REPORT ---
  const mins = ((Date.now() - started) / 60000).toFixed(1)
  log(`\n===== ${DRY_RUN ? 'DRY RUN — nothing was written' : 'IMPORT COMPLETE'} (${mins} min) =====`)
  log(`Lines read: ${linesRead.toLocaleString()}`)
  log(`Products ${DRY_RUN ? 'that would be ' : ''}imported: ${accepted.toLocaleString()}`)
  log(`  with an English ingredient list: ${ingredientDisclosed.toLocaleString()}`)
  log(`  with nutrition per serving: ${nutritionPerServing.toLocaleString()}, per 100 g: ${nutritionPer100g.toLocaleString()}`)
  log(`  with a nutrition warning to review (calories vs macros, impossible values): ${nutritionNotes.toLocaleString()}`)
  log(`New unvetted companies: ${newCompanyCount.toLocaleString()}`)
  log(`New ingredients: ${newIngredientCount.toLocaleString()} (${newFlaggedIngredients.toLocaleString()} flagged for research by the classification rules)`)
  log(`Batches written: ${batchesWritten}, failed: ${batchesFailed}`)

  log('\nSkipped, by reason:')
  log(top(skipped, 30) || '    (none)')

  log('\nProducts added under EXISTING VETTED companies (check these look right):')
  log(top(attachedToExisting, 50) || '    (none)')

  log('\nCategories assigned:')
  log(top(categoryCounts, 60) || '    (none)')
  const unmapped = [...unmappedCategoryTags.values()].reduce((a, b) => a + b, 0)
  log(`\nNo category matched: ${unmapped.toLocaleString()} products. Most common OFF categories among them (candidates for new rules in offCategoryMap.ts):`)
  log(top(unmappedCategoryTags, 40) || '    (none)')

  log('\nLargest unvetted brands receiving products (new or already unvetted):')
  log(top(newBrandCounts, 40) || '    (none)')

  if (nutritionWarnings.length) {
    const dir = './logs'
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, `bulk-import-nutrition-warnings-${Date.now()}.tsv`)
    fs.writeFileSync(f, 'upc\tproduct\twarning\n' + nutritionWarnings.join('\n'))
    log(`\nNutrition warnings (${nutritionWarnings.length.toLocaleString()}) saved to ${f} — open in Excel to review. Warnings never block a product — the numbers are stored exactly as OFF has them.`)
  }

  if (failedUpcs.length) {
    const dir = './logs'
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, `bulk-import-failed-upcs-${Date.now()}.txt`)
    fs.writeFileSync(f, failedUpcs.join('\n'))
    log(`\n${failedUpcs.length} UPCs in failed batches were saved to ${f}. Re-running retries them.`)
  }

  if (!DRY_RUN) {
    await prisma.ingestionLog.create({
      data: {
        source: IMPORT_SOURCE,
        recordsMatched: accepted,
        fileName: path.basename(FILE),
      },
    })
    log('\nLogged this run to IngestionLog.')
  } else {
    log('\nRe-run with --live --limit 2000 for a trial import, then --live for the full import.')
  }
}

main()
  .catch((e) => logError(e))
  .finally(async () => {
    console.log(`\nFull output saved to ${LOG_FILE}`)
    await prisma.$disconnect()
  })

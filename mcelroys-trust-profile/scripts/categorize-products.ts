// CATEGORIZE the bulk-imported products, using the most objective source
// available for each one, and record where every category came from.
//
// WHY: about 225,000 bulk products had no category, and the rest came from
// Open Food Facts' crowdsourced tags, which file similar products
// inconsistently (salted nuts under snacks, ketchup under sauces). Rootify
// should not categorize by its own opinion, so the order of sources is:
//
//   1. USDA FoodData Central (--usda). USDA's branded foods data gives each
//      product a category the MANUFACTURER supplied, largely through GS1, the
//      retail industry's product data standard. Matched by barcode, mapped
//      onto Rootify's categories by src/lib/usdaCategoryMap.ts.
//      Source: "usda_fdc".
//   2. Open Food Facts' category tags. Either re-read from the export (--off,
//      picks up the newer rules in src/lib/offCategoryMap.ts) or, without
//      --off, the category the bulk import already set is kept.
//      Source: "open_food_facts".
//   3. The product name (src/lib/nameCategoryMap.ts), only when neither of
//      the above has anything. Source: "name_estimate" — the app should
//      present these as estimates.
//   4. Otherwise the category stays null for a human.
//
// One exception to "keep what OFF said": a product in Beverage or Juice
// whose name plainly says beer, wine or spirits ("IPA", "Cabernet
// Sauvignon", "Hard Seltzer") moves to Alcoholic Beverage (name_estimate).
// USDA rarely has alcohol — its labels are regulated by TTB, not FDA.
//
// WHAT IT NEVER DOES
//   - Never changes a category whose source is "manual" (set by a person),
//     or any product that didn't come from the bulk import.
//   - Never marks anything reviewed.
//
// GET THE USDA FILE (free, about 430 MB zipped / 2.9 GB unzipped):
//   https://fdc.nal.usda.gov/download-datasets/ → "Branded" → the latest CSV
//   Unzip it into ./data. Only branded_food.csv is read; pass either that file
//   or the unzipped folder.
//
// USAGE
//   npx tsx scripts/categorize-products.ts --usda ./data/<unzipped folder> --off ./data/openfoodfacts-products.jsonl.gz
//       Dry run (default): writes the log and a plan TSV to ./logs, changes
//       nothing. --usda and --off are each optional, but without --usda this
//       is just the name-based estimate.
//   Add --live to write.
//   --strong-only   use names only when they contain a clear product word
//
// REQUIRES the migration 20260929180000_add_product_category_source
// (npx prisma migrate deploy).
//
// UNDO: every change is recorded in review_backup.category_assignments with
// the run label printed at the end. To reverse one run:
//   UPDATE "Product" p SET category = b.old_category, "categorySource" = b.old_source
//   FROM review_backup.category_assignments b
//   WHERE b.run_label = '<label>' AND p.id = b.product_id
//     AND p.category IS NOT DISTINCT FROM b.new_category;
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { parse } from 'csv-parse'
import * as fs from 'fs'
import * as path from 'path'
import { StringDecoder } from 'string_decoder'
import * as zlib from 'zlib'
import { normalizeUpc } from '@/lib/upc'
import { mapOffFoodCategory } from '@/lib/offCategoryMap'
import { mapUsdaCategory } from '@/lib/usdaCategoryMap'
import { categorizeByName, type NameCategoryMatch } from '@/lib/nameCategoryMap'
import { isValidCategoryForType } from '@/lib/productTypes'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
// Same client options as bulk-import-off.ts (see the notes there)
const clientOptions = {
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0]
const prisma = new PrismaClient(clientOptions)

// Raises Supabase's statement time limit for one statement (see
// repair-ingredients.ts)
async function slowQuery<T>(query: Prisma.PrismaPromise<T>): Promise<T> {
  const [, result] = await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '20min'`),
    query,
  ])
  return result as T
}

// --- CONFIG ---
const args = process.argv.slice(2)
const DRY_RUN = !args.includes('--live')
const STRONG_ONLY = args.includes('--strong-only')
function argValue(name: string): string | null {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] ?? null : null
}
const USDA_PATH = argValue('--usda')
const OFF_FILE = argValue('--off')
const IMPORT_SOURCE = 'open_food_facts_bulk'
const ALCOHOL = 'Alcoholic Beverage'
const MOVABLE_TO_ALCOHOL = new Set(['Beverage', 'Juice'])
const WRITE_BATCH = 2000
const RUN_LABEL = `categorize-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`

// Values of Product.categorySource (see schema.prisma)
type CategorySource = 'usda_fdc' | 'open_food_facts' | 'name_estimate' | 'manual'

// --- LOGGING (written as it goes) ---
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
fs.mkdirSync('./logs', { recursive: true })
const LOG_FILE = path.join('./logs', `categorize-products${DRY_RUN ? '-dryrun' : ''}-${STAMP}.txt`)
const PLAN_FILE = path.join('./logs', `categorize-products-plan-${STAMP}.tsv`)
function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}
function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by)
}
function top(map: Map<string, number>, n: number, indent = '    '): string {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${indent}${v.toLocaleString().padStart(7)}  ${k}`)
    .join('\n')
}
const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`

type Row = { id: string; upc: string | null; name: string; category: string | null; categorySource: string | null }
type Decision = { row: Row; category: string; source: CategorySource; detail: string }

// ---------------------------------------------------------------------------
// USDA: barcode -> branded food category, from branded_food.csv
// ---------------------------------------------------------------------------
function findBrandedFoodCsv(p: string): string {
  if (!fs.existsSync(p)) throw new Error(`Not found: ${p}`)
  if (fs.statSync(p).isFile()) return p
  // The zip unpacks to a folder, sometimes with one more folder inside
  for (const dir of [p, ...fs.readdirSync(p).map((d) => path.join(p, d)).filter((d) => fs.statSync(d).isDirectory())]) {
    const f = path.join(dir, 'branded_food.csv')
    if (fs.existsSync(f)) return f
  }
  throw new Error(`branded_food.csv not found in ${p} — pass the unzipped USDA "Branded" CSV folder or the file itself`)
}

type UsdaRecord = { category: string; fdcId: number; date: string }

async function readUsdaCategories(file: string, wanted: Set<string>) {
  const byUpc = new Map<string, UsdaRecord>()
  const allCategories = new Map<string, number>() // every category in the file
  let rows = 0
  const parser = fs.createReadStream(file).pipe(
    parse({ columns: true, bom: true, relax_quotes: true, relax_column_count: true, skip_records_with_error: true })
  )
  let checkedHeader = false
  for await (const rec of parser as AsyncIterable<Record<string, string>>) {
    if (!checkedHeader) {
      for (const col of ['gtin_upc', 'branded_food_category', 'fdc_id']) {
        if (!(col in rec)) throw new Error(`${file} has no "${col}" column — is this USDA's branded_food.csv?`)
      }
      checkedHeader = true
    }
    rows++
    if (rows % 250_000 === 0) log(`  ...${rows.toLocaleString()} USDA rows read, ${byUpc.size.toLocaleString()} of our barcodes found`)
    const category = (rec.branded_food_category ?? '').trim()
    if (!category) continue
    bump(allCategories, category)
    const u = normalizeUpc(rec.gtin_upc)
    if (!u.ok || !wanted.has(u.upc)) continue
    // USDA keeps several records per barcode over time; use the newest
    const date = rec.available_date || rec.modified_date || rec.publication_date || ''
    const fdcId = Number(rec.fdc_id) || 0
    const prev = byUpc.get(u.upc)
    if (!prev || date > prev.date || (date === prev.date && fdcId > prev.fdcId)) {
      byUpc.set(u.upc, { category: (' ' + category).slice(1), fdcId, date: (' ' + date).slice(1) })
    }
  }
  log(`  Done: ${rows.toLocaleString()} USDA records, ${allCategories.size} categories, ${byUpc.size.toLocaleString()} of our barcodes found.`)
  return { byUpc, allCategories }
}

// ---------------------------------------------------------------------------
// OFF: barcode -> mapped category, from the export (same reader as the import)
// ---------------------------------------------------------------------------
async function* readLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
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

async function readOffCategories(file: string, wanted: Set<string>) {
  const found = new Map<string, { category: string; tag: string }>()
  const codePattern = /"code"\s*:\s*"([^"]{1,40})"/g
  let lines = 0
  let seen = 0
  for await (const line of readLines(fs.createReadStream(file).pipe(zlib.createGunzip()))) {
    lines++
    if (lines % 500_000 === 0) log(`  ...${lines.toLocaleString()} OFF lines read, ${seen.toLocaleString()} of our products found`)
    // Cheap check before JSON.parse: does any "code" in the line match?
    let hit = false
    for (const m of line.matchAll(codePattern)) {
      const u = normalizeUpc(m[1])
      if (u.ok && wanted.has(u.upc)) {
        hit = true
        break
      }
    }
    if (!hit) continue
    let p: Record<string, unknown>
    try {
      p = JSON.parse(line)
    } catch {
      continue
    }
    const u = normalizeUpc(p.code)
    if (!u.ok || !wanted.has(u.upc)) continue
    seen++
    const match = mapOffFoodCategory(p.categories_tags)
    if (match) found.set((' ' + u.upc).slice(1), { category: match.category, tag: match.matchedTag })
  }
  log(`  Done: ${lines.toLocaleString()} lines, ${seen.toLocaleString()} of our products found, ${found.size.toLocaleString()} with mappable OFF categories.`)
  return found
}

// ---------------------------------------------------------------------------
async function main() {
  log(`categorize-products — ${DRY_RUN ? 'DRY RUN (nothing is written)' : 'LIVE'}${STRONG_ONLY ? ', strong name matches only' : ''}`)
  log(`USDA branded foods: ${USDA_PATH ?? 'not used (pass --usda <folder>)'}`)
  log(`Open Food Facts tags: ${OFF_FILE ?? 'not re-read (the categories the import set are kept)'}`)
  log('')

  // Raw SQL so this works even before `npx prisma generate` picks up the
  // new categorySource column
  const hasColumn = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'Product' AND column_name = 'categorySource'`
  if (Number(hasColumn[0]?.n ?? 0) === 0) {
    throw new Error('Product.categorySource is missing — run `npx prisma migrate deploy` first')
  }
  const rows = await slowQuery(
    prisma.$queryRaw<Row[]>`
      SELECT id, upc, name, category, "categorySource"
      FROM "Product"
      WHERE "importSource" = ${IMPORT_SOURCE} AND "productType" = 'food_beverage'
        AND "categorySource" IS DISTINCT FROM 'manual'`
  )
  const startNull = rows.filter((r) => r.category === null).length
  log(`Loaded ${rows.length.toLocaleString()} bulk food products (${startNull.toLocaleString()} without a category). Products with a manual category are not loaded.`)

  const upcOf = new Map<string, string>() // product id -> canonical UPC
  const wanted = new Set<string>()
  for (const r of rows) {
    const u = r.upc ? normalizeUpc(r.upc) : null
    if (u?.ok) {
      upcOf.set(r.id, u.upc)
      wanted.add(u.upc)
    }
  }

  let usda: Map<string, UsdaRecord> = new Map()
  let usdaAllCategories = new Map<string, number>()
  if (USDA_PATH) {
    const file = findBrandedFoodCsv(USDA_PATH)
    log(`Reading USDA categories from ${file}...`)
    ;({ byUpc: usda, allCategories: usdaAllCategories } = await readUsdaCategories(file, wanted))
  }
  let off = new Map<string, { category: string; tag: string }>()
  if (OFF_FILE) {
    if (!fs.existsSync(OFF_FILE)) throw new Error(`Export file not found: ${OFF_FILE}`)
    log(`Reading Open Food Facts category tags from ${OFF_FILE}...`)
    off = await readOffCategories(OFF_FILE, wanted)
  }

  // --- Decide ---
  const decisions: Decision[] = []
  const finalSource = new Map<string, number>() // where every product's category ends up coming from
  const usdaTable = new Map<string, { n: number; to: Map<string, number> }>() // USDA category -> our mapping
  const transitions = new Map<string, number>() // "old -> new" category changes
  const transitionSamples = new Map<string, string[]>()
  const estimateSamples = new Map<string, string[]>()
  const estimateSeen = new Map<string, number>()
  const stillNull = new Map<string, number>()
  let usdaUnmapped = 0
  let nameVsUsdaCovered = 0
  let nameVsUsdaAgree = 0
  let leftNull = 0

  for (const row of rows) {
    const upc = upcOf.get(row.id)
    const u = upc ? usda.get(upc) : undefined
    const o = upc ? off.get(upc) : undefined
    const byName: NameCategoryMatch | null = categorizeByName(row.name)
    const nameOk = byName && (!STRONG_ONLY || byName.tier === 'strong') ? byName : null

    let next: { category: string; source: CategorySource; detail: string } | null = null

    if (u) {
      const mapped = mapUsdaCategory(u.category, byName?.category, row.name)
      const entry = usdaTable.get(u.category) ?? { n: 0, to: new Map<string, number>() }
      entry.n++
      bump(entry.to, mapped?.category ?? '(not mapped — next source used)')
      usdaTable.set(u.category, entry)
      if (mapped) {
        next = { category: mapped.category, source: 'usda_fdc', detail: `usda:${u.category} (fdc ${u.fdcId})` }
        // How often does the name reader agree with USDA? The honest
        // accuracy figure for the estimates.
        if (byName) {
          nameVsUsdaCovered++
          const plain = mapUsdaCategory(u.category)
          if (byName.category === mapped.category || byName.category === plain?.category) nameVsUsdaAgree++
        }
      } else usdaUnmapped++
    }
    // OFF volunteers occasionally tag the wrong thing as alcohol ("Extra
    // virgin olive oil", "Apple Juice"); skip that tag when the name clearly
    // names a non-drink or a juice
    const offAlcoholDoubtful =
      o?.category === ALCOHOL && byName?.tier === 'strong' && byName.category !== ALCOHOL && byName.category !== 'Beverage'
    if (!next && o && !offAlcoholDoubtful) next = { category: o.category, source: 'open_food_facts', detail: `off-tag:${o.tag}` }
    if (!next && row.category !== null) {
      // Keep what the import set from OFF — except plain alcohol
      if (MOVABLE_TO_ALCOHOL.has(row.category) && byName?.category === ALCOHOL && byName.tier === 'strong') {
        next = { category: ALCOHOL, source: 'name_estimate', detail: `name-strong:${byName.matchedTerm}` }
      } else {
        next = { category: row.category, source: (row.categorySource as CategorySource) ?? 'open_food_facts', detail: 'kept' }
      }
    }
    if (!next && nameOk) next = { category: nameOk.category, source: 'name_estimate', detail: `name-${nameOk.tier}:${nameOk.matchedTerm}` }

    if (!next) {
      leftNull++
      const words = row.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2)
      bump(stillNull, words.length ? words[words.length - 1] : '(no letters)')
      continue
    }
    if (!isValidCategoryForType('food_beverage', next.category)) {
      throw new Error(`Invalid category "${next.category}" for ${row.id} — check productTypes.ts`)
    }
    bump(finalSource, next.source)

    if (next.category === row.category && next.source === row.categorySource) continue
    decisions.push({ row, ...next })

    if (next.category !== row.category) {
      const key = `${row.category ?? '(none)'} -> ${next.category}  [${next.source}]`
      bump(transitions, key)
      const s = transitionSamples.get(key) ?? []
      if (s.length < 4) s.push(`${row.name}  [${next.detail}]`)
      transitionSamples.set(key, s)
    }
    if (next.source === 'name_estimate' && row.category === null) {
      // Reservoir sample: 10 random estimates per category
      const seen = (estimateSeen.get(next.category) ?? 0) + 1
      estimateSeen.set(next.category, seen)
      const s = estimateSamples.get(next.category) ?? []
      const text = `${row.name}  [${next.detail}]`
      if (s.length < 10) s.push(text)
      else if (Math.random() < 10 / seen) s[Math.floor(Math.random() * 10)] = text
      estimateSamples.set(next.category, s)
    }
  }

  // --- Plan file ---
  fs.writeFileSync(
    PLAN_FILE,
    'productId\tupc\tname\toldCategory\toldSource\tnewCategory\tnewSource\tdetail\n' +
      decisions
        .map((d) =>
          [d.row.id, d.row.upc ?? '', d.row.name.replace(/\s+/g, ' '), d.row.category ?? '', d.row.categorySource ?? '', d.category, d.source, d.detail].join('\t')
        )
        .join('\n') +
      '\n'
  )

  // --- Report ---
  const categoryChanges = decisions.filter((d) => d.category !== d.row.category)
  log('')
  log('RESULT')
  log(`  Products that would have a category: ${(rows.length - leftNull).toLocaleString()} of ${rows.length.toLocaleString()} (${pct(rows.length - leftNull, rows.length)}); ${leftNull.toLocaleString()} left for a human.`)
  log(`  Where each category would come from:`)
  for (const [src, n] of [...finalSource.entries()].sort((a, b) => b[1] - a[1])) log(`    ${n.toLocaleString().padStart(8)}  ${src}  (${pct(n, rows.length)})`)
  log(`  Rows to write: ${decisions.length.toLocaleString()} (${categoryChanges.length.toLocaleString()} change the category; the rest only record its source)`)
  log(`    newly categorized: ${categoryChanges.filter((d) => d.row.category === null).length.toLocaleString()}`)
  log(`    recategorized:     ${categoryChanges.filter((d) => d.row.category !== null).length.toLocaleString()}`)
  if (USDA_PATH) {
    log('')
    log(`USDA matched ${usda.size.toLocaleString()} of our ${wanted.size.toLocaleString()} barcodes (${pct(usda.size, wanted.size)}); ${usdaUnmapped.toLocaleString()} of those had a USDA category that maps to nothing.`)
    log(`Name reader vs USDA, where both have an answer: agree on ${pct(nameVsUsdaAgree, nameVsUsdaCovered)} of ${nameVsUsdaCovered.toLocaleString()} products.`)
    log('  (This is the best available measure of how reliable the "name_estimate" categories are.)')
    log('')
    log('USDA CATEGORY MAP — every USDA category among our products, and what it became (please review):')
    for (const [cat, e] of [...usdaTable.entries()].sort((a, b) => b[1].n - a[1].n)) {
      const to = [...e.to.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(', ')
      log(`  ${e.n.toLocaleString().padStart(7)}  ${cat}  =>  ${to}`)
    }
    const notOurs = [...usdaAllCategories.entries()].filter(([c]) => !usdaTable.has(c))
    if (notOurs.length) {
      log('')
      log(`USDA categories with none of our products (${notOurs.length}), with how they would map:`)
      for (const [c, n] of notOurs.sort((a, b) => b[1] - a[1])) log(`  ${n.toLocaleString().padStart(7)}  ${c}  =>  ${mapUsdaCategory(c)?.category ?? '(not mapped)'}`)
    }
  }
  log('')
  log('CATEGORY CHANGES (old -> new [source]), most common first, with examples:')
  for (const [key, n] of [...transitions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) {
    log(`  ${n.toLocaleString().padStart(7)}  ${key}`)
    for (const s of transitionSamples.get(key) ?? []) log(`             e.g. ${s}`)
  }
  log('')
  log('NAME ESTIMATES — random examples per category:')
  for (const cat of [...estimateSamples.keys()].sort()) {
    log(`  ${cat} (${(estimateSeen.get(cat) ?? 0).toLocaleString()}):`)
    for (const s of estimateSamples.get(cat) ?? []) log(`      ${s}`)
  }
  log('')
  log('Most common last words of names still uncategorized:')
  log(top(stillNull, 40))
  log('')
  log(`Plan written to ${PLAN_FILE} (${decisions.length.toLocaleString()} rows).`)

  if (DRY_RUN) {
    log('')
    log('DRY RUN — nothing was written. Re-run with --live to apply.')
    return
  }

  // --- LIVE: record every change first, then apply it ---
  log('')
  log(`Writing ${decisions.length.toLocaleString()} rows (run label ${RUN_LABEL})...`)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS review_backup.category_assignments (
      run_label text NOT NULL,
      product_id text NOT NULL,
      old_category text,
      old_source text,
      new_category text NOT NULL,
      new_source text NOT NULL,
      detail text,
      assigned_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_label, product_id)
    )`)

  let written = 0
  let applied = 0
  for (let i = 0; i < decisions.length; i += WRITE_BATCH) {
    const batch = decisions.slice(i, i + WRITE_BATCH)
    const ids = batch.map((d) => d.row.id)
    const [, count] = await prisma.$transaction([
      prisma.$executeRaw`
        INSERT INTO review_backup.category_assignments (run_label, product_id, old_category, old_source, new_category, new_source, detail)
        SELECT ${RUN_LABEL}::text, * FROM unnest(
          ${ids}::text[], ${batch.map((d) => d.row.category)}::text[], ${batch.map((d) => d.row.categorySource)}::text[],
          ${batch.map((d) => d.category)}::text[], ${batch.map((d) => d.source)}::text[], ${batch.map((d) => d.detail)}::text[])
        ON CONFLICT DO NOTHING`,
      // Only if nothing changed since this run read the product — never
      // overwrite a category someone set in the meantime
      prisma.$executeRaw`
        UPDATE "Product" p SET category = b.new_category, "categorySource" = b.new_source
        FROM review_backup.category_assignments b
        WHERE b.run_label = ${RUN_LABEL} AND b.product_id = p.id
          AND p.id = ANY(${ids}::text[])
          AND p.category IS NOT DISTINCT FROM b.old_category
          AND p."categorySource" IS NOT DISTINCT FROM b.old_source`,
    ])
    written += batch.length
    applied += count
    if ((i / WRITE_BATCH) % 10 === 0 || written === decisions.length) {
      log(`  ...${written.toLocaleString()} / ${decisions.length.toLocaleString()} processed, ${applied.toLocaleString()} products updated`)
    }
  }
  log('')
  log(`Done. ${applied.toLocaleString()} products updated${applied < written ? ` (${(written - applied).toLocaleString()} skipped because they changed since the run started)` : ''}.`)
  log(`Run label for undo: ${RUN_LABEL}`)
}

main()
  .catch((e) => {
    log(`[ERROR] ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

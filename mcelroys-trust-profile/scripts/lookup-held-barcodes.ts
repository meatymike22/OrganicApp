// LOOK UP the real brand of products whose company record is on hold.
//
// WHY: about 2,700 companies are held (unvetted) because their name is a
// placeholder, a generic word or a product description ("Organics",
// "Restaurant Item", "Multi-grain Bread"). Their products came from Open Food
// Facts, where the brand field was typed in wrong. The barcode is still
// reliable, so this looks each barcode up in:
//   - USDA FoodData Central branded foods (brand_owner, brand_name,
//     subbrand_name) — supplied by the manufacturer, mostly through GS1
//   - the Open Food Facts export (brands, brand_owner, owner) — the full
//     record, which sometimes carries a manufacturer-supplied brand_owner even
//     when the "brands" field is wrong
//
// READ-ONLY: it reads the database and the two files and writes one TSV to
// ./logs. It changes nothing in the database. The TSV is then reviewed and
// applied separately (with a dry run first).
//
// USAGE
//   npx tsx scripts/lookup-held-barcodes.ts --usda ./data/FoodData_Central_branded_food_csv_2025-12-18 --off ./data/openfoodfacts-products.jsonl.gz
//   Either source may be left out. Reading the OFF export takes a while
//   (it is 13 GB compressed); progress is printed.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse'
import * as fs from 'fs'
import * as path from 'path'
import { StringDecoder } from 'string_decoder'
import * as zlib from 'zlib'
import { normalizeUpc } from '@/lib/upc'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter } as unknown as ConstructorParameters<typeof PrismaClient>[0])

const args = process.argv.slice(2)
function argValue(name: string): string | null {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] ?? null : null
}
const USDA_PATH = argValue('--usda')
const OFF_FILE = argValue('--off')

const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
fs.mkdirSync('./logs', { recursive: true })
const LOG_FILE = path.join('./logs', `lookup-held-barcodes-${STAMP}.txt`)
const OUT_FILE = path.join('./logs', `held-barcode-lookup-${STAMP}.tsv`)
function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}
// Tabs/newlines would break the TSV
const clean = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v))
  .replace(/[\t\r\n]+/g, ' ')
  .trim()

function findBrandedFoodCsv(p: string): string {
  if (!fs.existsSync(p)) throw new Error(`Not found: ${p}`)
  if (fs.statSync(p).isFile()) return p
  for (const dir of [p, ...fs.readdirSync(p).map((d) => path.join(p, d)).filter((d) => fs.statSync(d).isDirectory())]) {
    const f = path.join(dir, 'branded_food.csv')
    if (fs.existsSync(f)) return f
  }
  throw new Error(`branded_food.csv not found in ${p}`)
}

type Usda = { owner: string; brand: string; sub: string; date: string; fdcId: number }
async function readUsda(file: string, wanted: Set<string>) {
  const byUpc = new Map<string, Usda>()
  let rows = 0
  const parser = fs.createReadStream(file).pipe(
    parse({ columns: true, bom: true, relax_quotes: true, relax_column_count: true, skip_records_with_error: true })
  )
  for await (const rec of parser as AsyncIterable<Record<string, string>>) {
    rows++
    if (rows % 250_000 === 0) log(`  ...${rows.toLocaleString()} USDA rows, ${byUpc.size.toLocaleString()} of our barcodes found`)
    const u = normalizeUpc(rec.gtin_upc)
    if (!u.ok || !wanted.has(u.upc)) continue
    const date = rec.available_date || rec.modified_date || rec.publication_date || ''
    const fdcId = Number(rec.fdc_id) || 0
    const prev = byUpc.get(u.upc)
    // USDA keeps several records per barcode over time; use the newest
    if (!prev || date > prev.date || (date === prev.date && fdcId > prev.fdcId)) {
      byUpc.set(u.upc, { owner: clean(rec.brand_owner), brand: clean(rec.brand_name), sub: clean(rec.subbrand_name), date: clean(date), fdcId })
    }
  }
  log(`  USDA done: ${rows.toLocaleString()} rows, ${byUpc.size.toLocaleString()} of our barcodes found.`)
  return byUpc
}

async function* readLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8')
  let carry = ''
  for await (const chunk of stream) {
    carry += decoder.write(chunk as Buffer)
    let nl = carry.indexOf('\n')
    while (nl !== -1) {
      yield carry.slice(0, nl)
      carry = carry.slice(nl + 1)
      nl = carry.indexOf('\n')
    }
  }
  carry += decoder.end()
  if (carry) yield carry
}

type Off = { brands: string; brandOwner: string; owner: string; name: string }
async function readOff(file: string, wanted: Set<string>) {
  const found = new Map<string, Off>()
  const codePattern = /"code"\s*:\s*"([^"]{1,40})"/g
  let lines = 0
  for await (const line of readLines(fs.createReadStream(file).pipe(zlib.createGunzip()))) {
    lines++
    if (lines % 500_000 === 0) log(`  ...${lines.toLocaleString()} OFF lines, ${found.size.toLocaleString()} of our products found`)
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
    found.set(u.upc, {
      brands: clean(p.brands),
      brandOwner: clean(p.brand_owner),
      owner: clean(p.owner),
      name: clean(p.product_name),
    })
  }
  log(`  OFF done: ${lines.toLocaleString()} lines, ${found.size.toLocaleString()} of our products found.`)
  return found
}

async function main() {
  log('lookup-held-barcodes — READ-ONLY (the database is not changed)')
  const rows = await prisma.$queryRawUnsafe<{ id: string; upc: string | null; name: string; company_id: string; company: string }[]>(
    `SELECT p.id, p.upc, p.name, c.id AS company_id, c."legalName" AS company
       FROM "Product" p JOIN "Company" c ON c.id = p."companyId"
      WHERE c."vettingStatus" = 'unvetted'`
  )
  log(`Products under held companies: ${rows.length.toLocaleString()}`)
  const wanted = new Set<string>()
  const upcOf = new Map<string, string>()
  for (const r of rows) {
    const u = normalizeUpc(r.upc)
    if (u.ok) {
      wanted.add(u.upc)
      upcOf.set(r.id, u.upc)
    }
  }
  log(`  with a usable barcode: ${upcOf.size.toLocaleString()}`)

  const usda = USDA_PATH ? await readUsda(findBrandedFoodCsv(USDA_PATH), wanted) : new Map<string, Usda>()
  const off = OFF_FILE ? await readOff(OFF_FILE, wanted) : new Map<string, Off>()

  const header = ['product_id', 'upc', 'product_name', 'company_id', 'company', 'usda_brand_owner', 'usda_brand_name', 'usda_subbrand', 'off_brands', 'off_brand_owner', 'off_owner']
  const out = [header.join('\t')]
  let withAny = 0
  for (const r of rows) {
    const upc = upcOf.get(r.id) ?? ''
    const us = upc ? usda.get(upc) : undefined
    const of = upc ? off.get(upc) : undefined
    if (us || of?.brandOwner || of?.owner) withAny++
    out.push([r.id, upc, clean(r.name), r.company_id, clean(r.company), us?.owner ?? '', us?.brand ?? '', us?.sub ?? '', of?.brands ?? '', of?.brandOwner ?? '', of?.owner ?? ''].join('\t'))
  }
  fs.writeFileSync(OUT_FILE, out.join('\n') + '\n')
  log(`Products with a USDA record or an OFF brand owner: ${withAny.toLocaleString()} of ${rows.length.toLocaleString()}`)
  log(`Wrote ${OUT_FILE}`)
}

main()
  .catch((e) => {
    log('FAILED:', e instanceof Error ? e.stack ?? e.message : String(e))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

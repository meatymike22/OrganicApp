// VET the bulk-imported companies automatically, by checking each one
// against USDA FoodData Central's manufacturer-supplied brand data.
//
// WHY: the bulk import created ~60,000 "unvetted" companies straight from
// Open Food Facts' free-text brand field. Unvetted companies are hidden from
// browsing and — more importantly — never matched against recalls, warning
// letters or filings, because a brand name typed by a volunteer isn't a
// reliable enough identity to attach a government record to. Rootify
// doesn't review these by hand; instead scripts cross-check every company
// against known databases, and users report what slips through.
//
// THIS SCRIPT IS PASS 1: USDA. For every product of a company, its barcode
// is looked up in USDA's branded foods file, which carries the brand name
// and brand OWNER that the manufacturer itself reported (largely through
// GS1, the barcode standards body). If the company's name matches the brand
// USDA has on file for (nearly) all of its products that USDA knows, the
// company is confirmed: the barcodes prove the products are real, and the
// manufacturer's own records prove the brand is who we say it is.
//
// VERDICTS
//   verified  — USDA knows at least one of its products, and the brand USDA
//               has matches this company's name on at least 80% of those.
//               Vetted, method "automated_usda", with USDA's brand owner
//               recorded (Company.brandOwner).
//   conflict  — USDA knows 2+ of its products but mostly under a DIFFERENT
//               brand. The brand text we have is probably wrong or mixed.
//               Left unvetted for the AI pass (pass 2).
//   partial   — some agreement, but under 80%. Left for pass 2.
//   no_usda   — USDA has none of its products. Left for pass 2.
//   junk      — the name isn't a usable brand (no letters, one character,
//               a barcode). Reported only; nothing is changed.
// It also REPORTS likely duplicates (two companies whose products USDA files
// under the same brand) for a later merge — it does not merge anything.
//
// USAGE
//   npx tsx scripts/vet-companies.ts --usda ./data/FoodData_Central_branded_food_csv_2025-12-18
//       Dry run (default): log + plan TSV in ./logs, changes nothing.
//   Add --live to write.
//
// REQUIRES the migration 20260929200000_add_company_vetting_method
// (npx prisma migrate deploy).
//
// UNDO: every change is recorded in review_backup.vetting_assignments:
//   UPDATE "Company" c SET "vettingStatus" = 'unvetted', "vettingMethod" = NULL,
//     "vettedAt" = NULL, "vettingNotes" = NULL, "brandOwner" = NULL
//   FROM review_backup.vetting_assignments b
//   WHERE b.run_label = '<label>' AND c.id = b.company_id;
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import { parse } from 'csv-parse'
import * as fs from 'fs'
import * as path from 'path'
import { normalizeUpc } from '@/lib/upc'
import { normalizeBrandName } from '@/lib/brandMatching'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
// Same client options as bulk-import-off.ts (see the notes there)
const clientOptions = {
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0]
const prisma = new PrismaClient(clientOptions)

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
function argValue(name: string): string | null {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] ?? null : null
}
const USDA_PATH = argValue('--usda')
// Share of a company's USDA-known products whose USDA brand must match
const AGREE_THRESHOLD = 0.8
// USDA's brand_owner is whoever submitted the label data — sometimes the
// brand's owner, sometimes a co-packer or distributor, spelled several ways.
// It's saved as Company.brandOwner only when one owner accounts for at least
// this share of the company's USDA-known products.
const OWNER_SHARE_TO_SAVE = 0.8
const WRITE_BATCH = 1000
const RUN_LABEL = `vet-usda-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`

// --- LOGGING ---
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
fs.mkdirSync('./logs', { recursive: true })
const LOG_FILE = path.join('./logs', `vet-companies${DRY_RUN ? '-dryrun' : ''}-${STAMP}.txt`)
const PLAN_FILE = path.join('./logs', `vet-companies-plan-${STAMP}.tsv`)
function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}
function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by)
}
const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`
// Copy so a kept string doesn't pin the whole CSV chunk in memory (see
// detach() in bulk-import-off.ts)
const detach = (s: string) => (' ' + s).slice(1)

// ---------------------------------------------------------------------------
// USDA: barcode -> brand name + brand owner (newest record per barcode)
// ---------------------------------------------------------------------------
type UsdaBrand = { brandName: string; brandOwner: string; subbrand: string; date: string; fdcId: number }

function findBrandedFoodCsv(p: string): string {
  if (!fs.existsSync(p)) throw new Error(`Not found: ${p}`)
  if (fs.statSync(p).isFile()) return p
  for (const dir of [p, ...fs.readdirSync(p).map((d) => path.join(p, d)).filter((d) => fs.statSync(d).isDirectory())]) {
    const f = path.join(dir, 'branded_food.csv')
    if (fs.existsSync(f)) return f
  }
  throw new Error(`branded_food.csv not found in ${p}`)
}

async function readUsdaBrands(file: string, wanted: Set<string>) {
  const byUpc = new Map<string, UsdaBrand>()
  let rows = 0
  const parser = fs.createReadStream(file).pipe(
    parse({ columns: true, bom: true, relax_quotes: true, relax_column_count: true, skip_records_with_error: true })
  )
  let checked = false
  for await (const rec of parser as AsyncIterable<Record<string, string>>) {
    if (!checked) {
      for (const col of ['gtin_upc', 'brand_owner', 'brand_name', 'fdc_id']) {
        if (!(col in rec)) throw new Error(`${file} has no "${col}" column — is this USDA's branded_food.csv?`)
      }
      checked = true
    }
    rows++
    if (rows % 500_000 === 0) log(`  ...${rows.toLocaleString()} USDA rows read, ${byUpc.size.toLocaleString()} of our barcodes found`)
    const u = normalizeUpc(rec.gtin_upc)
    if (!u.ok || !wanted.has(u.upc)) continue
    const date = rec.available_date || rec.modified_date || ''
    const fdcId = Number(rec.fdc_id) || 0
    const prev = byUpc.get(u.upc)
    if (!prev || date > prev.date || (date === prev.date && fdcId > prev.fdcId)) {
      byUpc.set(u.upc, {
        brandName: detach((rec.brand_name ?? '').trim()),
        brandOwner: detach((rec.brand_owner ?? '').trim()),
        subbrand: detach((rec.subbrand_name ?? '').trim()),
        date: detach(date),
        fdcId,
      })
    }
  }
  log(`  Done: ${rows.toLocaleString()} USDA records, ${byUpc.size.toLocaleString()} of our barcodes found.`)
  return byUpc
}

// ---------------------------------------------------------------------------
// Does a USDA record's brand match our company name?
// ---------------------------------------------------------------------------
// Two ways a USDA brand can match our company name:
//   1. Same key, using the normalization the import used to create the
//      companies ("The Honest Company, Inc." = "HONEST COMPANY"), with
//      accents removed for this comparison ("Häagen-Dazs" = "HAAGEN-DAZS").
//   2. One name's WORDS appear, in order, inside the other's: "Clif" in
//      "CLIF BAR", "Cheez-It" in "Kellogg's Cheez It", "Wegmans" in our
//      "Wegmans Organic", "H-E-B" at the start of "H-E-B Organics".
//      Not for generic one-word names ("Organics", "Simply", "Select"),
//      which appear inside unrelated brands, and not for very short names.
// A match on brand name, sub-brand OR brand owner counts: store brands are
// often filed with the retailer as owner ("Kroger" brand, owner "The Kroger
// Co."), and single-brand makers often report only the owner.
const GENERIC_WORDS = new Set([
  'ORGANIC', 'ORGANICS', 'NATURAL', 'NATURALS', 'SIMPLY', 'SIMPLE', 'SELECT', 'SIGNATURE', 'PREMIUM', 'CLASSIC', 'ORIGINAL',
  'FRESH', 'KITCHEN', 'KITCHENS', 'FARMS', 'FARM', 'MARKET', 'FOODS', 'FOOD', 'BRAND', 'BRANDS', 'GOURMET', 'HOMESTYLE',
  'CHOICE', 'BEST', 'GOLD', 'HARVEST', 'DELI', 'BAKERY', 'PANTRY', 'TRADITIONAL', 'VALUE', 'QUALITY', 'FAMILY', 'GARDEN',
  'STAR', 'SUN', 'SUNNY', 'GOLDEN', 'ROYAL', 'PURE', 'REAL', 'GOOD', 'GREAT', 'HOME', 'COUNTRY', 'HEALTHY', 'CRAFT',
])
const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
function words(s: string): string[] {
  return stripAccents(s)
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/['’‘`´.]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .filter((w) => !['THE', 'INC', 'LLC', 'CO', 'CORP', 'CORPORATION', 'COMPANY', 'LTD', 'USA', 'US'].includes(w))
}
function containsRun(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w)) return true
  }
  return false
}
function namesAgree(ours: string, theirs: string): boolean {
  if (!ours || !theirs) return false
  if (normalizeBrandName(stripAccents(ours)) === normalizeBrandName(stripAccents(theirs))) return true
  const a = words(ours)
  const b = words(theirs)
  if (!a.length || !b.length) return false
  const generic = (w: string[]) => w.length === 1 && GENERIC_WORDS.has(w[0])
  // One squashed name starting with the other ("KELLOGGS" and "KELLOGG'S
  // RAISIN BRAN", "WALMART" and "WAL-MART STORES"), for names of 5+ letters
  const sa = a.join('')
  const sb = b.join('')
  if (sa.length >= 5 && sb.length >= 5 && !generic(a) && !generic(b) && (sa.startsWith(sb) || sb.startsWith(sa))) return true
  // One name's words at the START of the other's, for names of 3+
  // characters ("365" and "365 WHOLE FOODS MARKET")
  if (sa.length >= 3 && !generic(a) && a.every((w, i) => b[i] === w)) return true
  if (sb.length >= 3 && !generic(b) && b.every((w, i) => a[i] === w)) return true
  const usable = (w: string[]) => w.join('').length >= 4 && !generic(w)
  // Our words inside theirs ("Clif" in "CLIF BAR")
  if (usable(a) && containsRun(b, a)) return true
  // Their words inside ours ("WEGMANS" in "Wegmans Organic"); a short name
  // like "H-E-B" only at the START of ours
  if (usable(b) && containsRun(a, b)) return true
  if (b.join('').length >= 3 && !(b.length === 1 && GENERIC_WORDS.has(b[0])) && b.every((w, i) => a[i] === w) && b.length > 1) return true
  return false
}
function recordAgrees(ourName: string, r: UsdaBrand): boolean {
  return namesAgree(ourName, r.brandName) || namesAgree(ourName, r.subbrand) || namesAgree(ourName, r.brandOwner)
}

// Names that can't be a brand: a single character, or a barcode typed into
// the brand field
// (Numeric names like "365" or "4505" are real brands and go through the
// normal checks.)
function isJunkName(name: string): string | null {
  if (name.replace(/\s/g, '').length < 2) return 'one character'
  if (/^\d{8,14}$/.test(name.replace(/\s/g, ''))) return 'a barcode'
  return null
}

type Row = { company_id: string; legal_name: string; upc: string | null }
type Verdict = 'verified' | 'conflict' | 'partial' | 'no_usda' | 'junk'
type Result = {
  id: string
  name: string
  products: number
  usdaKnown: number
  agree: number
  topBrand: string
  topOwner: string
  ownerShare: number
  verdict: Verdict
  notes: string
}

async function main() {
  log(`vet-companies (pass 1: USDA) — ${DRY_RUN ? 'DRY RUN (nothing is written)' : 'LIVE'}`)
  if (!USDA_PATH) throw new Error('Pass the USDA folder: --usda ./data/<unzipped FoodData Central branded CSV folder>')

  const hasColumn = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'Company' AND column_name = 'vettingMethod'`
  if (Number(hasColumn[0]?.n ?? 0) === 0) throw new Error('Company.vettingMethod is missing — run `npx prisma migrate deploy` first')

  // Every unvetted company with its products' barcodes (raw SQL so this
  // works before `npx prisma generate` picks up the new columns)
  const rows = await slowQuery(
    prisma.$queryRaw<Row[]>`
      SELECT c.id AS company_id, c."legalName" AS legal_name, p.upc
      FROM "Company" c JOIN "Product" p ON p."companyId" = c.id
      WHERE c."vettingStatus" = 'unvetted'`
  )
  const companies = new Map<string, { name: string; upcs: string[] }>()
  const wanted = new Set<string>()
  for (const r of rows) {
    const c = companies.get(r.company_id) ?? { name: r.legal_name, upcs: [] }
    const u = r.upc ? normalizeUpc(r.upc) : null
    if (u?.ok) {
      c.upcs.push(u.upc)
      wanted.add(u.upc)
    } else c.upcs.push('')
    companies.set(r.company_id, c)
  }
  log(`Loaded ${companies.size.toLocaleString()} unvetted companies with ${rows.length.toLocaleString()} products.`)

  const file = findBrandedFoodCsv(USDA_PATH)
  log(`Reading USDA brands from ${file}...`)
  const usda = await readUsdaBrands(file, wanted)

  // --- Judge each company ---
  const results: Result[] = []
  for (const [id, c] of companies) {
    const junk = isJunkName(c.name)
    const recs = c.upcs.map((u) => (u ? usda.get(u) : undefined)).filter((r): r is UsdaBrand => !!r)
    const agree = recs.filter((r) => recordAgrees(c.name, r)).length

    // Most common USDA brand and owner (display text of the commonest key)
    const brandCounts = new Map<string, number>()
    const ownerCounts = new Map<string, number>()
    const ownerDisplay = new Map<string, string>()
    for (const r of recs) {
      if (r.brandName) bump(brandCounts, r.brandName)
      if (r.brandOwner) {
        const k = normalizeBrandName(r.brandOwner)
        bump(ownerCounts, k)
        if (!ownerDisplay.has(k)) ownerDisplay.set(k, r.brandOwner)
      }
    }
    const topBrand = [...brandCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
    const [topOwnerKey, topOwnerN] = [...ownerCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
    const topOwner = ownerDisplay.get(topOwnerKey) ?? ''
    const ownerShare = recs.length ? topOwnerN / recs.length : 0

    let verdict: Verdict
    if (junk) verdict = 'junk'
    else if (recs.length === 0) verdict = 'no_usda'
    else if (agree / recs.length >= AGREE_THRESHOLD) verdict = 'verified'
    else if (recs.length >= 2 && agree / recs.length < 0.5) verdict = 'conflict'
    else verdict = 'partial'

    const notes =
      verdict === 'junk'
        ? `Name is not a usable brand (${junk})`
        : recs.length === 0
          ? `USDA has none of its ${c.upcs.length} barcodes`
          : `USDA: ${recs.length} of ${c.upcs.length} barcodes found; brand matches on ${agree}` +
            (topOwner ? `; owner ${topOwner}${ownerShare < 1 ? ` (${Math.round(ownerShare * 100)}%)` : ''}` : '') +
            (verdict === 'conflict' ? `; USDA mostly says "${topBrand}"` : '')
    results.push({ id, name: c.name, products: c.upcs.length, usdaKnown: recs.length, agree, topBrand, topOwner, ownerShare, verdict, notes })
  }

  // --- Likely duplicates: verified companies USDA files under the same brand ---
  const byUsdaBrand = new Map<string, Result[]>()
  for (const r of results) {
    if (r.verdict !== 'verified' || !r.topBrand) continue
    const k = normalizeBrandName(r.topBrand)
    byUsdaBrand.set(k, [...(byUsdaBrand.get(k) ?? []), r])
  }
  const dupGroups = [...byUsdaBrand.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length)

  // --- Plan file ---
  fs.writeFileSync(
    PLAN_FILE,
    'companyId\tname\tproducts\tusdaKnown\tbrandAgrees\ttopUsdaBrand\ttopUsdaOwner\townerShare\tverdict\tnotes\n' +
      results
        .sort((a, b) => b.products - a.products)
        .map((r) => [r.id, r.name, r.products, r.usdaKnown, r.agree, r.topBrand, r.topOwner, r.ownerShare.toFixed(2), r.verdict, r.notes].join('\t'))
        .join('\n') +
      '\n'
  )

  // --- Report ---
  const verdicts: Verdict[] = ['verified', 'partial', 'conflict', 'no_usda', 'junk']
  log('')
  log('VERDICTS (companies / their products):')
  const totalProducts = results.reduce((s, r) => s + r.products, 0)
  for (const v of verdicts) {
    const rs = results.filter((r) => r.verdict === v)
    const p = rs.reduce((s, r) => s + r.products, 0)
    log(`  ${v.padEnd(9)} ${rs.length.toLocaleString().padStart(7)} companies (${pct(rs.length, results.length)})  ${p.toLocaleString().padStart(8)} products (${pct(p, totalProducts)})`)
  }
  log('')
  log('By company size — share verified:')
  for (const [label, lo, hi] of [['100+ products', 100, Infinity], ['20–99', 20, 99], ['5–19', 5, 19], ['2–4', 2, 4], ['1', 1, 1]] as const) {
    const rs = results.filter((r) => r.products >= lo && r.products <= hi)
    log(`  ${label.padEnd(14)} ${pct(rs.filter((r) => r.verdict === 'verified').length, rs.length)} of ${rs.length.toLocaleString()}`)
  }
  const sample = (v: Verdict, n: number) =>
    results
      .filter((r) => r.verdict === v)
      .sort((a, b) => b.products - a.products)
      .slice(0, n)
      .forEach((r) => log(`    ${r.name}  —  ${r.notes}`))
  log('')
  log('LARGEST VERIFIED (check these look right):')
  sample('verified', 40)
  log('')
  log('LARGEST CONFLICTS (brand text disagrees with USDA — left unvetted):')
  sample('conflict', 40)
  log('')
  log('LARGEST PARTIAL (left unvetted):')
  sample('partial', 25)
  log('')
  log('LARGEST WITH NO USDA DATA (left unvetted):')
  sample('no_usda', 25)
  log('')
  log('JUNK NAMES (reported only):')
  sample('junk', 25)
  log('')
  log(`LIKELY DUPLICATES — verified companies USDA files under the same brand (${dupGroups.length.toLocaleString()} groups; first 40, not merged):`)
  for (const g of dupGroups.slice(0, 40)) log(`    "${g[0].topBrand}": ${g.map((r) => `${r.name} (${r.products})`).join(' | ')}`)
  log('')
  log(`Plan written to ${PLAN_FILE} (${results.length.toLocaleString()} companies).`)

  if (DRY_RUN) {
    log('')
    log('DRY RUN — nothing was written. Re-run with --live to vet the "verified" companies.')
    return
  }

  // --- LIVE: back up, then vet the verified companies ---
  const toVet = results.filter((r) => r.verdict === 'verified')
  log('')
  log(`Vetting ${toVet.length.toLocaleString()} companies (run label ${RUN_LABEL})...`)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS review_backup.vetting_assignments (
      run_label text NOT NULL,
      company_id text NOT NULL,
      old_status text,
      new_status text NOT NULL,
      method text NOT NULL,
      brand_owner text,
      notes text,
      assigned_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_label, company_id)
    )`)
  let done = 0
  let applied = 0
  for (let i = 0; i < toVet.length; i += WRITE_BATCH) {
    const batch = toVet.slice(i, i + WRITE_BATCH)
    const ids = batch.map((r) => r.id)
    const [, count] = await prisma.$transaction([
      prisma.$executeRaw`
        INSERT INTO review_backup.vetting_assignments (run_label, company_id, old_status, new_status, method, brand_owner, notes)
        SELECT ${RUN_LABEL}::text, id, 'unvetted', 'vetted', 'automated_usda', owner, notes FROM unnest(
          ${ids}::text[], ${batch.map((r) => (r.topOwner && r.ownerShare >= OWNER_SHARE_TO_SAVE ? r.topOwner : null))}::text[], ${batch.map((r) => r.notes)}::text[]) AS t(id, owner, notes)
        ON CONFLICT DO NOTHING`,
      // Only companies still unvetted — never touches a human decision
      prisma.$executeRaw`
        UPDATE "Company" c SET "vettingStatus" = 'vetted', "vettingMethod" = 'automated_usda', "vettedAt" = now(),
          "vettingNotes" = b.notes, "brandOwner" = b.brand_owner
        FROM review_backup.vetting_assignments b
        WHERE b.run_label = ${RUN_LABEL} AND b.company_id = c.id
          AND c.id = ANY(${ids}::text[]) AND c."vettingStatus" = 'unvetted'`,
    ])
    done += batch.length
    applied += count
    log(`  ...${done.toLocaleString()} / ${toVet.length.toLocaleString()} processed, ${applied.toLocaleString()} vetted`)
  }
  log('')
  log(`Done. ${applied.toLocaleString()} companies vetted. Run label for undo: ${RUN_LABEL}`)
}

main()
  .catch((e) => {
    log(`[ERROR] ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

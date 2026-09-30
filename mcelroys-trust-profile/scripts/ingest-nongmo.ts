// Ingests Non-GMO Project verification status from the Project's Verified
// product code spreadsheets into ProductCertification.
//
// Handles BOTH sheets the Project publishes, because they share an identical
// column layout and differ only in which standard they certify:
//   Non-GMO Project Verified  — GMO avoidance (the butterfly)
//   Non-UPF Verified          — a separate standard on ultra-processed food
// Pass --scheme to select; it defaults to the Non-GMO sheet.
//
// HOW TO GET THE FILE: the Non-GMO Project has no public API. It publishes a
// Verified product code spreadsheet on request — submit the form linked from
// https://www.nongmoproject.org/find-non-gmo/ and save the file to ./data/.
// (Their consumer-facing Product Finder is a website, not an API; requesting
// the official file is both more reliable and the sanctioned route.)
//
// Usage:
//   npx tsx scripts/ingest-nongmo.ts ./data/non-gmo-verified-upc-sheet.csv
//   npx tsx scripts/ingest-nongmo.ts ./data/non-gmo-verified-upc-sheet.csv --live
//   npx tsx scripts/ingest-nongmo.ts ./data/non-UPF-verified-upc-sheet.csv --scheme non-upf --live
//   npx tsx scripts/ingest-nongmo.ts ./data/file.csv --headers   (inspect columns only)
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const logLines: string[] = []
function log(...a: unknown[]) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 2))).join(' ')
  console.log(line); logLines.push(line)
}
function logError(...a: unknown[]) {
  const line = a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')
  console.error(line); logLines.push('[ERROR] ' + line)
}
function writeLogFile(prefix: string) {
  const dir = './logs'; fs.mkdirSync(dir, { recursive: true })
  const fp = path.join(dir, `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)
  fs.writeFileSync(fp, logLines.join('\n')); console.log(`\nFull output saved to ${fp}`)
}

// The two schemes this script can ingest. Each carries its own scopeNote,
// because what a mark actually certifies is the part shoppers most often
// over-read — and these two certify very different things despite coming from
// the same organisation and looking similar on a package.
const SCHEMES = {
  'non-gmo': {
    scheme: 'Non-GMO Project Verified',
    sourceUrl: 'https://www.nongmoproject.org/find-non-gmo/',
    scopeNote:
      'Non-GMO Project verification certifies compliance with the Non-GMO Project Standard for GMO avoidance. Three limits worth knowing. First, and most relevant on a package that also carries the USDA organic seal: certified organic production already prohibits the use of GMOs under US law, so on an organic product the butterfly is largely duplicate assurance rather than additional information. The European Union goes further and prohibits non-GMO claims on organic products for exactly this reason — the requirement is already law there. Second, the Project also verifies products in categories where no genetically modified version is commercially available (salt, water, citrus), so the mark on such a product confirms far less than it may appear to. Third, the Project itself states that "GMO free" is not a defensible claim, so verification means compliance with an avoidance standard, not a guarantee of zero GMO content.',
  },
  'non-upf': {
    scheme: 'Non-UPF Verified',
    sourceUrl: 'https://www.nongmoproject.org/',
    scopeNote:
      'Non-UPF verification is a SEPARATE standard from the Non-GMO butterfly, administered by the same organisation, and it certifies something different: that a product is not ultra-processed. The two marks are easy to confuse on a package and carry no implication of each other — a product can hold one without the other. Two cautions. Ultra-processing has no single agreed regulatory definition; the most cited framework, NOVA, is a research classification rather than a legal standard, so this mark reflects one organisation\'s operational definition rather than a government one. And because the standard is recent, absence of the mark says very little — most products have simply never been submitted. Verify the current published standard before relying on any specific criterion.',
  },
} as const

const schemeArgIndex = process.argv.indexOf('--scheme')
const SCHEME_KEY = (schemeArgIndex !== -1 ? process.argv[schemeArgIndex + 1] : 'non-gmo') as keyof typeof SCHEMES

if (!SCHEMES[SCHEME_KEY]) {
  console.error(`Unknown --scheme "${SCHEME_KEY}". Valid values: ${Object.keys(SCHEMES).join(', ')}`)
  process.exit(1)
}
const SCHEME = SCHEMES[SCHEME_KEY]

const FILE_PATH = process.argv[2]
const DRY_RUN = !process.argv.includes('--live')
const HEADERS_ONLY = process.argv.includes('--headers')

if (!FILE_PATH) {
  console.error('Provide the spreadsheet path, e.g.:')
  console.error('  npx tsx scripts/ingest-nongmo.ts ./data/nongmo-verified-products.xlsx')
  process.exit(1)
}

// UPCs are written inconsistently across sources: 12-digit UPC-A, 13-digit
// EAN with a leading zero, sometimes with the check digit dropped or stored as
// a number that lost its leading zeros in Excel. Compare on digits with
// leading zeros stripped so "0058449772057" and "58449772057" match.
function normalizeUpc(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '')
}

// The exact column names in this file are not documented publicly, so detect
// them rather than hardcoding. Run with --headers first to see what's there.
// Loose brand comparison, used only as a sanity check on a UPC match.
function normalizeBrand(n: string): string {
  return n.toUpperCase().replace(/\([^)]*\)/g, '').replace(/[.,'']/g, '')
    .replace(/^\s*THE\s+/, '')
    .replace(/\b(LLC|INC|INCORPORATED|CO|CORP|CORPORATION|LTD|COMPANY)\b/g, '')
    .replace(/\s+/g, ' ').trim()
}

function findColumn(headers: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(String(h ?? '')))
    if (i !== -1) return i
  }
  return -1
}

async function main() {
  log(`Reading spreadsheet for scheme: ${SCHEME.scheme}`)
  const wb = XLSX.readFile(FILE_PATH, { cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  // Find the header row: the first row containing something UPC-ish
  const headerRow = rows.findIndex((r) =>
    r.some((c) => /upc|gtin|product code|barcode/i.test(String(c ?? '')))
  )
  if (headerRow === -1) {
    logError('Could not find a header row containing a UPC/GTIN/product code column.')
    log('First 5 rows for inspection:', rows.slice(0, 5))
    return
  }

  const headers = (rows[headerRow] as string[]).map((h) => String(h ?? ''))
  log(`Header row found at index ${headerRow}. Columns:`)
  headers.forEach((h, i) => { if (h) log(`  ${i}: ${h}`) })
  if (HEADERS_ONLY) return

  const upcCol = findColumn(headers, [/^upc$/i, /gtin/i, /product code/i, /barcode/i, /upc/i])
  const nameCol = findColumn(headers, [/product name/i, /^product$/i, /item/i, /description/i])
  const brandCol = findColumn(headers, [/brand/i, /company/i, /manufacturer/i])
  const dateCol = findColumn(headers, [/verification date/i, /verified date/i, /^date$/i])
  const otherCertCol = findColumn(headers, [/other certification/i])
  log(`Using columns -> UPC: ${upcCol}, name: ${nameCol}, brand: ${brandCol}, verification date: ${dateCol}, other certs: ${otherCertCol}`)

  const dataRows = rows.slice(headerRow + 1)
  log(`Loaded ${dataRows.length} verified product row(s).`)

  // Index the spreadsheet by normalized UPC, then look up OUR products — far
  // cheaper than scanning a large file once per product.
  const byUpc = new Map<string, unknown[]>()
  for (const r of dataRows) {
    const u = normalizeUpc(r[upcCol])
    if (u) byUpc.set(u, r)
  }
  log(`Indexed ${byUpc.size} distinct UPC(s).`)

  const products = await prisma.product.findMany({
    where: { upc: { not: null } },
    include: { company: true },
  })
  log(`Checking ${products.length} product(s) that have a UPC.\n`)

  let matched = 0
  let brandMismatches = 0
  let nameMismatches = 0
  for (const product of products) {
    const row = byUpc.get(normalizeUpc(product.upc))
    if (!row) continue
    matched++

    // A UPC is globally unique, so a UPC hit is strong on its own. Still
    // compare brands: a mismatch usually means our product record has the
    // wrong barcode rather than that the spreadsheet is wrong, and that is
    // worth knowing about.
    const sheetBrand = brandCol !== -1 ? String(row[brandCol] ?? '') : ''
    const ourBrands = [product.company.legalName, ...product.company.dbaNames]
    // Containment, not equality: the sheet trades in consumer brand names
    // ("Nature's Path") while we store legal entities ("Nature's Path Foods,
    // Inc"). Requiring an exact match flagged a legitimate pair as suspicious.
    const brandAgrees = !sheetBrand || ourBrands.some((b) => {
      const a = normalizeBrand(b), c = normalizeBrand(sheetBrand)
      return a === c || a.includes(c) || c.includes(a)
    })

    // The more valuable check: does the sheet's PRODUCT name resemble ours?
    // A UPC is unique, so if the names diverge it is our record that is wrong
    // — which is exactly how "Sunrise Crunchy Maple" was found to be carrying
    // the barcode for Sunrise Crunchy HONEY.
    const sheetName = nameCol !== -1 ? String(row[nameCol] ?? '') : ''
    const tok = (t: string) => new Set(
      t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter((w) => w.length > 2 && !['the','and','with','organic','pack','variety'].includes(w))
        .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    )
    const ourTokens = tok(product.name)
    const sheetTokens = tok(sheetName)
    const shared = [...ourTokens].filter((t) => sheetTokens.has(t)).length
    // Only flag when there is NO overlap at all.
    //
    // A proportional threshold was tried and removed: it fired on "Gluten Free
    // Orzo" vs "Orzo, Brown Rice, Organic" and on a bar whose sheet name is
    // simply shorter than ours — both correct matches — while missing the one
    // real error, "Sunrise Crunchy Maple" sitting on the barcode for Sunrise
    // Crunchy HONEY, because the two share "sunrise" and "crunchy". Naming
    // conventions differ too much between a certifier's sheet and a retail
    // catalogue for a score to mean anything. Zero overlap is the only signal
    // strong enough to assert, so the sheet's product name is printed on every
    // match instead and a human compares.
    const nameAgrees = ourTokens.size === 0 || sheetTokens.size === 0 || shared > 0

    const verifiedOn = dateCol !== -1 && row[dateCol] instanceof Date
      ? (row[dateCol] as Date)
      : null

    const certData = {
      scheme: SCHEME.scheme,
      // The Project owns the mark; evaluation is performed by independent
      // technical administrators. Left null unless the file names one.
      certifyingBody: null as string | null,
      certificateNumber: null as string | null,
      status: 'verified',
      effectiveDate: verifiedOn,
      lastVerifiedDate: new Date(),
      scopeNote: SCHEME.scopeNote,
      sourceUrl: SCHEME.sourceUrl,
      sourceType: 'certifier_database',
      dataPulledDate: new Date(),
      aiDrafted: true,
    }

    log(`MATCH: "${product.name}" (UPC ${product.upc}) -> ${SCHEME.scheme}`)
    if (nameCol !== -1) log(`  spreadsheet: ${sheetBrand} — ${String(row[nameCol] ?? '')}`)
    if (verifiedOn) log(`  originally verified: ${verifiedOn.toISOString().slice(0, 10)}`)
    if (!brandAgrees) {
      brandMismatches++
      log(`  ⚠ BRAND MISMATCH: sheet says "${sheetBrand}", we have "${product.company.legalName}".`)
    }
    if (!nameAgrees) {
      nameMismatches++
      log(`  ⚠ NAME MISMATCH: this UPC is "${sheetName}" on the certifier's sheet and "${product.name}" here — no words in common at all. A UPC identifies one product, so OUR record is almost certainly on the wrong barcode.`)
    }
    // Logged, not stored: other certifications are this certifier's claim
    // about other schemes. Anything we publish about those should come from
    // that scheme's own source, not second-hand from here. Useful as a lead.
    if (otherCertCol !== -1 && row[otherCertCol]) {
      log(`  (sheet also lists other certifications: ${String(row[otherCertCol])} — lead only, not recorded)`)
    }

    if (!DRY_RUN) {
      const existing = await prisma.productCertification.findFirst({
        where: { productId: product.id, scheme: SCHEME.scheme },
      })
      if (existing) {
        await prisma.productCertification.update({ where: { id: existing.id }, data: certData })
        log('  Updated existing record')
      } else {
        await prisma.productCertification.create({ data: { ...certData, productId: product.id } })
        log('  Created new record')
      }
    }
  }

  log(`\nDone. ${matched} of ${products.length} product(s) carry ${SCHEME.scheme}.`)
  if (brandMismatches > 0) log(`⚠ ${brandMismatches} match(es) had a brand mismatch — see warnings above.`)
  if (nameMismatches > 0) log(`⚠ ${nameMismatches} match(es) shared no words with the certifier's product name — almost certainly a wrong UPC on our side.`)
  log('Compare each "spreadsheet:" line above against our product name. Names differ legitimately between a certifier sheet and a retail catalogue, so this is a human judgement, not something worth automating.')
  log(`Note: a product NOT matching here has simply not been verified under this standard — it may never have been submitted. Absence of the mark is not evidence that the product fails the standard.`)

  if (DRY_RUN) {
    log('DRY RUN — nothing written. Re-run with --live to commit.')
  } else {
    await prisma.ingestionLog.create({
      data: { source: SCHEME_KEY === 'non-upf' ? 'nonupf_project' : 'nongmo_project', recordsMatched: matched, fileName: FILE_PATH },
    })
    log('Logged this run to IngestionLog.')
  }
}

main().catch((e) => logError(e)).finally(async () => {
  writeLogFile(`ingest-${SCHEME_KEY}`); await prisma.$disconnect()
})

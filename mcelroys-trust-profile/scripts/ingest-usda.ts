// Loads .env into process.env (DATABASE_URL) since this runs outside the Prisma CLI
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
// SheetJS - reads Excel files in Node. Install with: npm install xlsx
import * as XLSX from 'xlsx'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// --- CONFIG ---
// Path to the file you downloaded from USDA OID, passed as the first argument.
// Defaults to dry-run (safe, no writes) unless you explicitly pass --live as the second argument.
// Usage:
//   npx tsx scripts/ingest-usda.ts ./data/INTEGRITY_Export_2026.xlsx            (dry run, safe)
//   npx tsx scripts/ingest-usda.ts ./data/INTEGRITY_Export_2026.xlsx --live     (actually writes)
const FILE_PATH = process.argv[2]
const DRY_RUN = process.argv[3] !== '--live'

if (!FILE_PATH) {
  console.error('Please provide a file path. Example:')
  console.error('  npx tsx scripts/ingest-usda.ts ./data/INTEGRITY_Export_2026.xlsx')
  console.error('  npx tsx scripts/ingest-usda.ts ./data/INTEGRITY_Export_2026.xlsx --live')
  process.exit(1)
}

// Strips punctuation, legal suffixes (LLC, Inc, Co, etc.), and extra whitespace,
// then uppercases — so "Nurture LLC" and "NURTURE, LLC." both normalize to "NURTURE"
// and can be matched against each other even if formatted slightly differently.
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(/\b(LLC|INC|CO|CORP|LTD|COMPANY)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Some OID rows combine legal name + DBA into one string, like:
// "Nurture LLC dba Happy Family Organics; Happy Family Brands"
// This splits on both semicolons and the word "dba" so each individual name
// becomes its own candidate to check against our database.
function extractCandidates(raw: string): string[] {
  return raw
    .split(';')
    .flatMap((part) => part.split(/\bdba\b/i))
    .map((p) => p.trim())
    .filter(Boolean)
}

async function main() {
  // --- Step 1: Load every company already in our database ---
  // We only need to check OID rows against companies we actually have, not all 76,000+ rows in detail
  const companies = await prisma.company.findMany({
    include: { products: true },
  })

  // Build a lookup map: normalized name -> company record
  // Includes both legalName and every dbaNames entry, so a match on either works
  const nameMap = new Map<string, (typeof companies)[number]>()
  for (const company of companies) {
    nameMap.set(normalizeName(company.legalName), company)
    for (const dba of company.dbaNames) {
      nameMap.set(normalizeName(dba), company)
    }
  }

  // --- Step 2: Load the USDA spreadsheet ---
  console.log('Reading spreadsheet (this may take a moment, it is a large file)...')
  const workbook = XLSX.readFile(FILE_PATH)
  // This file has everything on one sheet: operation info, scope status,
  // and certified products all together (unlike the split-sheet version)
  const sheet = workbook.Sheets['Operations']

  // Convert to an array of arrays (raw rows), since this file has extra header/description
  // rows before the real column headers — we need to find them manually rather than
  // assuming row 1 is the header like a normal CSV.
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  // Find the row containing the real technical column names (e.g. "Cert_name")
  const headerRowIndex = rows.findIndex((row) => row[0] === 'Cert_name')
  const headers = rows[headerRowIndex] as string[]

  // Data rows start 3 rows after the technical header row:
  // +1 = human-readable label row, +1 = description row, +1 = first real data row
  const dataRows = rows.slice(headerRowIndex + 3)

  // Helper to pull a column's value out of a raw row by its technical column name,
  // instead of hardcoding column positions (which could shift if USDA changes the file)
  const col = (row: unknown[], name: string) => row[headers.indexOf(name)]

  console.log(`Loaded ${dataRows.length} operations from USDA data.`)

  // --- Step 3: Walk every OID row, check for a match against our companies ---
  let matchCount = 0

  for (const row of dataRows) {
    const opName = String(col(row, 'op_name') ?? '')
    const otherNames = String(col(row, 'op_otherNames') ?? '')

    // Check the main operation name, plus each "other name" — splitting both on
    // semicolons and "dba", since USDA sometimes combines legal name + DBA into one string
    const candidateNames = [...extractCandidates(opName), ...extractCandidates(otherNames)]

    let matchedCompany: (typeof companies)[number] | undefined
    for (const candidate of candidateNames) {
      const found = nameMap.get(normalizeName(candidate))
      if (found) {
        matchedCompany = found
        break
      }
    }

    if (!matchedCompany) continue // no match, move to the next row

    matchCount++

    // Build the certified scopes array from the four scope status columns.
    // This file also includes the actual certified product/category text per scope
    // (e.g. "Field/Forageable: Corn, Wheat") — logged here for visibility, though it
    // doesn't map cleanly to a specific Product record in our schema yet.
    const scopes: string[] = []
    if (col(row, 'opSC_CR') === 'Certified') {
      scopes.push('Crops')
      console.log('  Crops products:', col(row, 'CR_CertifiedProducts'))
    }
    if (col(row, 'opSC_LS') === 'Certified') {
      scopes.push('Livestock')
      console.log('  Livestock products:', col(row, 'LS_CertifiedProducts'))
    }
    if (col(row, 'opSC_WC') === 'Certified') {
      scopes.push('Wild Crops')
      console.log('  Wild Crops products:', col(row, 'WC_CertifiedProducts'))
    }
    if (col(row, 'opSC_HANDLING') === 'Certified') {
      scopes.push('Handling')
      console.log('  Handling products:', col(row, 'Han_CertifiedProducts'))
    }

    // The certificate link column can come through as either the raw formula
    // (=HYPERLINK("https://...")) or, more commonly, the already-computed plain URL —
    // handle both instead of assuming one format
    const certRaw = String(col(row, 'op_certificate') ?? '')
    let sourceUrl = ''
    if (certRaw.startsWith('http')) {
      sourceUrl = certRaw
    } else {
      const urlMatch = certRaw.match(/"(https:\/\/[^"]+)"/)
      if (urlMatch) sourceUrl = urlMatch[1]
    }

    const certData = {
      certifyingAgency: String(col(row, 'Cert_name') ?? ''),
      certificateNumber: String(col(row, 'op_nopOpID') ?? ''),
      certificationStatus: String(col(row, 'op_status') ?? ''),
      certifiedScopes: scopes,
      sourceUrl,
      sourceType: 'regulatory_filing',
      dataPulledDate: new Date(),
      aiDrafted: true, // this record was written by an automated script, not typed by a human
    }

    console.log(`MATCH: "${opName}" -> ${matchedCompany.legalName} (${matchedCompany.products.length} product(s))`)
    console.log(certData)

    if (!DRY_RUN) {
      // Write this certification to every product under the matched company.
      // (See the note above the script: USDA data is company-level, not product-level,
      // so this applies the same cert to all of that company's products for now.)
      for (const product of matchedCompany.products) {
        // Check whether this exact certificate already exists for this product,
        // so re-running the script doesn't create duplicate rows.
        // certificateNumber is USDA's own unique ID for this certification, so it's
        // a reliable way to detect "have we already recorded this one."
        const existing = await prisma.organicCertification.findFirst({
          where: {
            productId: product.id,
            certificateNumber: certData.certificateNumber,
          },
        })

        if (existing) {
          // Already have this cert on file — update it instead of creating a duplicate,
          // in case status/scopes changed since the last time we pulled the data
          await prisma.organicCertification.update({
            where: { id: existing.id },
            data: {
              ...certData,
              lastVerifiedDate: new Date(),
            },
          })
          console.log(`  Updated existing record for ${product.name}`)
        } else {
          // No existing record — safe to create a new one
          await prisma.organicCertification.create({
            data: {
              ...certData,
              productId: product.id,
              lastVerifiedDate: new Date(),
            },
          })
          console.log(`  Created new record for ${product.name}`)
        }
      }
    }
  }

  console.log(`\nDone. ${matchCount} companies matched out of ${companies.length} in database.`)
  if (DRY_RUN) {
    console.log('DRY RUN — nothing was written. Review the matches above, then set DRY_RUN = false to commit.')
  } else {
    // Record that this ingestion actually ran, so the app can later show
    // "data last refreshed on [date]" and flag if it's gotten stale.
    await prisma.ingestionLog.create({
      data: {
        source: 'usda_oid',
        recordsMatched: matchCount,
        fileName: FILE_PATH,
      },
    })
    console.log('Logged this run to IngestionLog.')
  }
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect()
  })
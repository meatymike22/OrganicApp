// Loads .env into process.env (DATABASE_URL) since this runs outside the Prisma CLI,
// which normally does this automatically
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
// SheetJS - reads Excel files in Node. Install with: npm install xlsx
import * as XLSX from 'xlsx'
// Node's built-in filesystem and path modules, used to write the log file
import * as fs from 'fs'
import * as path from 'path'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// --- LOGGING SETUP ---
// Collects every line we print into an array, so that at the end of the run we can
// write it all out to a text file — in addition to still showing it live in the
// terminal as the script runs. Saves you from manually copy-pasting terminal output.
const logLines: string[] = []

// Use this instead of console.log everywhere below, so every message gets
// captured for the log file automatically instead of only appearing on screen
function log(...args: unknown[]) {
  // Convert each argument to a readable string — objects get pretty-printed JSON
  // (2-space indent) instead of the unreadable "[object Object]" a plain join would give
  const line = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
    .join(' ')
  console.log(line) // still show it live in the terminal
  logLines.push(line) // also remember it for the file
}

function logError(...args: unknown[]) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.error(line)
  logLines.push('[ERROR] ' + line)
}

// Writes everything collected so far to a timestamped file inside a "logs" folder,
// creating that folder first if it doesn't already exist (recursive: true means
// it won't error if the folder is already there)
function writeLogFile(prefix: string) {
  const dir = './logs'
  fs.mkdirSync(dir, { recursive: true })
  // Timestamp with colons/periods stripped, since those characters aren't
  // safe to use in filenames on Windows
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(dir, `${prefix}-${timestamp}.txt`)
  fs.writeFileSync(filePath, logLines.join('\n'))
  console.log(`\nFull output saved to ${filePath}`)
}

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

// USDA's certificate pages follow a stable URL pattern:
// https://organic.ams.usda.gov/Integrity/Certificate.aspx?cid={agency-code}&nopid={certificateNumber}
// The "cid" identifies the certifying agency (not the individual operation), so it's
// reusable across every certificate that agency has issued. When the spreadsheet's own
// op_certificate column comes back blank (as happens on some monthly exports), we can
// reconstruct a working URL ourselves using this lookup, rather than depending on a
// column that isn't always reliably populated.
//
// Add new agencies here as you discover their cid (visible in any working certificate
// URL for that agency, e.g. from a manually-verified record).
const CERTIFYING_AGENT_CIDS: Record<string, string> = {
  'Quality Assurance International': '71',
  'CCOF Certification Services, LLC': '15',
  'Organic Certifiers, Inc.': '63',
  'Oregon Tilth Certified Organic': '62',
  'Ecocert SAS (formerly Ecocert SA)': '24',
  'Natural Food Certifiers': '51',
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
  log('Reading spreadsheet (this may take a moment, it is a large file)...')
  const workbook = XLSX.readFile(FILE_PATH)
  // This file has everything on one sheet: operation info, scope status,
  // and certified products all together
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

  log(`Loaded ${dataRows.length} operations from USDA data.`)

  // --- Step 3: Walk every OID row, check for a match against our companies ---
  let matchCount = 0
  let skippedNoSourceCount = 0
  let fallbackUrlCount = 0
  // Track agencies we couldn't build a fallback URL for, so we can report
  // them once at the end instead of repeating the same warning per record
  const unknownAgencies = new Set<string>()

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
      log('  Crops products:', col(row, 'CR_CertifiedProducts'))
    }
    if (col(row, 'opSC_LS') === 'Certified') {
      scopes.push('Livestock')
      log('  Livestock products:', col(row, 'LS_CertifiedProducts'))
    }
    if (col(row, 'opSC_WC') === 'Certified') {
      scopes.push('Wild Crops')
      log('  Wild Crops products:', col(row, 'WC_CertifiedProducts'))
    }
    if (col(row, 'opSC_HANDLING') === 'Certified') {
      scopes.push('Handling')
      log('  Handling products:', col(row, 'Han_CertifiedProducts'))
    }

    const certifyingAgency = String(col(row, 'Cert_name') ?? '')
    const certificateNumber = String(col(row, 'op_nopOpID') ?? '')

    // The certificate link column can come through as either the raw formula
    // (=HYPERLINK("https://...")) or the already-computed plain URL — handle both.
    const certRaw = String(col(row, 'op_certificate') ?? '')
    let sourceUrl = ''
    if (certRaw.startsWith('http')) {
      sourceUrl = certRaw
    } else {
      const urlMatch = certRaw.match(/"(https:\/\/[^"]+)"/)
      if (urlMatch) sourceUrl = urlMatch[1]
    }

    // Fallback: if the spreadsheet's own certificate column was empty (a known gap
    // on some monthly exports), reconstruct the URL ourselves using the certifying
    // agency's known "cid" code plus the certificate number, following the same
    // stable URL pattern USDA uses everywhere else.
    if (!sourceUrl) {
      const cid = CERTIFYING_AGENT_CIDS[certifyingAgency.trim()]
      if (cid) {
        sourceUrl = `https://organic.ams.usda.gov/Integrity/Certificate.aspx?cid=${cid}&nopid=${certificateNumber}`
        fallbackUrlCount++
      } else {
        // We don't have a cid on file for this agency yet — flag it so it can be
        // added to CERTIFYING_AGENT_CIDS once discovered (e.g. from a manually
        // verified certificate URL for this same agency).
        unknownAgencies.add(certifyingAgency.trim())
      }
    }

    const certData = {
      certifyingAgency,
      certificateNumber,
      certificationStatus: String(col(row, 'op_status') ?? ''),
      certifiedScopes: scopes,
      sourceUrl,
      sourceType: 'regulatory_filing',
      dataPulledDate: new Date(),
      aiDrafted: true, // this record was written by an automated script, not typed by a human
    }

    log(`MATCH: "${opName}" -> ${matchedCompany.legalName} (${matchedCompany.products.length} product(s))`)
    log(certData)

    // Guard against writing a record with no citable source at all — this can still
    // happen for statuses like "Surrendered" with no active certificate, or an
    // agency we don't have a cid mapping for yet. Skip rather than write a blank
    // sourceUrl, consistent with the platform's "every record needs a real source" rule.
    if (!sourceUrl) {
      skippedNoSourceCount++
      log(`  SKIPPED (no source URL available, and no cid mapping for "${certifyingAgency}"). Needs manual review.`)
      continue
    }

    if (!DRY_RUN) {
      // Write this certification to every product under the matched company.
      // (USDA data is company-level, not product-level, so this applies the same
      // cert to all of that company's products for now — a known schema compromise.)
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
          log(`  Updated existing record for ${product.name}`)
        } else {
          // No existing record — safe to create a new one
          await prisma.organicCertification.create({
            data: {
              ...certData,
              productId: product.id,
              lastVerifiedDate: new Date(),
            },
          })
          log(`  Created new record for ${product.name}`)
        }
      }
    }
  }

  log(`\nDone. ${matchCount} certification record(s) matched across ${companies.length} companies in database.`)
  if (fallbackUrlCount > 0) {
    log(`${fallbackUrlCount} record(s) used a reconstructed source URL (spreadsheet's own link was blank).`)
  }
  if (skippedNoSourceCount > 0) {
    log(`${skippedNoSourceCount} record(s) skipped due to missing source URL — review these manually.`)
  }
  if (unknownAgencies.size > 0) {
    log('\nThe following certifying agencies have no cid mapping yet — add them to CERTIFYING_AGENT_CIDS once you find a working certificate URL for one of their records:')
    for (const agency of unknownAgencies) {
      log(`  - "${agency}"`)
    }
  }
  if (DRY_RUN) {
    log('DRY RUN — nothing was written. Review the matches above, then set --live to commit.')
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
    log('Logged this run to IngestionLog.')
  }
}

main()
  .catch((e) => logError(e))
  .finally(async () => {
    writeLogFile('ingest-usda')
    await prisma.$disconnect()
  })
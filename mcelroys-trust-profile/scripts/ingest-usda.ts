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
const logLines: string[] = []

function log(...args: unknown[]) {
  const line = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
    .join(' ')
  console.log(line)
  logLines.push(line)
}

function logError(...args: unknown[]) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
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
// Used as a fallback when the spreadsheet's own op_certificate column is blank
// (happens on some monthly exports). Add new agencies here as discovered.
const CERTIFYING_AGENT_CIDS: Record<string, string> = {
  'Quality Assurance International': '71',
  'CCOF Certification Services, LLC': '15',
  'Organic Certifiers, Inc.': '63',
  'Oregon Tilth Certified Organic': '62',
  'Ecocert SAS (formerly Ecocert SA)': '24',
  'Natural Food Certifiers': '51',
}

function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(/\b(LLC|INC|CO|CORP|LTD|COMPANY)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractCandidates(raw: string): string[] {
  return raw
    .split(';')
    .flatMap((part) => part.split(/\bdba\b/i))
    .map((p) => p.trim())
    .filter(Boolean)
}

// USDA's date columns aren't consistently typed — sometimes a real Excel date,
// sometimes plain text, sometimes a serial number. Try each in turn.
function parseFlexibleDate(raw: unknown): Date | null {
  if (raw instanceof Date) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = new Date(raw)
    if (!isNaN(parsed.getTime())) return parsed
  }
  if (typeof raw === 'number') {
    const decoded = XLSX.SSF.parse_date_code(raw)
    if (decoded) return new Date(decoded.y, decoded.m - 1, decoded.d)
  }
  return null
}

async function main() {
  const companies = await prisma.company.findMany({
    include: { products: true },
  })

  const nameMap = new Map<string, (typeof companies)[number]>()
  for (const company of companies) {
    nameMap.set(normalizeName(company.legalName), company)
    for (const dba of company.dbaNames) {
      nameMap.set(normalizeName(dba), company)
    }
  }

  log('Reading spreadsheet (this may take a moment, it is a large file)...')
  const workbook = XLSX.readFile(FILE_PATH, { cellDates: true })
  const sheet = workbook.Sheets['Operations']

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })
  const headerRowIndex = rows.findIndex((row) => row[0] === 'Cert_name')
  const headers = rows[headerRowIndex] as string[]
  const dataRows = rows.slice(headerRowIndex + 3)

  const col = (row: unknown[], name: string) => row[headers.indexOf(name)]

  log(`Loaded ${dataRows.length} operations from USDA data.`)

  let matchCount = 0
  let skippedNoSourceCount = 0
  let fallbackUrlCount = 0
  let hqLocationFilledCount = 0
  const unknownAgencies = new Set<string>()

  for (const row of dataRows) {
    const opName = String(col(row, 'op_name') ?? '')
    const otherNames = String(col(row, 'op_otherNames') ?? '')
    const candidateNames = [...extractCandidates(opName), ...extractCandidates(otherNames)]

    let matchedCompany: (typeof companies)[number] | undefined
    for (const candidate of candidateNames) {
      const found = nameMap.get(normalizeName(candidate))
      if (found) {
        matchedCompany = found
        break
      }
    }

    if (!matchedCompany) continue

    matchCount++

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

    const effectiveDateRaw = col(row, 'op_statusEffectiveDate')
    const effectiveDate = parseFlexibleDate(effectiveDateRaw)
    if (!effectiveDate && effectiveDateRaw !== undefined && effectiveDateRaw !== '') {
      log(`  DEBUG: could not parse effective date. Raw value:`, JSON.stringify(effectiveDateRaw), 'type:', typeof effectiveDateRaw)
    }

    const certRaw = String(col(row, 'op_certificate') ?? '')
    let sourceUrl = ''
    if (certRaw.startsWith('http')) {
      sourceUrl = certRaw
    } else {
      const urlMatch = certRaw.match(/"(https:\/\/[^"]+)"/)
      if (urlMatch) sourceUrl = urlMatch[1]
    }

    if (!sourceUrl) {
      const cid = CERTIFYING_AGENT_CIDS[certifyingAgency.trim()]
      if (cid) {
        sourceUrl = `https://organic.ams.usda.gov/Integrity/Certificate.aspx?cid=${cid}&nopid=${certificateNumber}`
        fallbackUrlCount++
      } else {
        unknownAgencies.add(certifyingAgency.trim())
      }
    }

    const certData = {
      certifyingAgency,
      certificateNumber,
      certificationStatus: String(col(row, 'op_status') ?? ''),
      certifiedScopes: scopes,
      effectiveDate,
      sourceUrl,
      sourceType: 'regulatory_filing',
      dataPulledDate: new Date(),
      aiDrafted: true,
    }

    log(`MATCH: "${opName}" -> ${matchedCompany.legalName} (${matchedCompany.products.length} product(s))`)
    log(certData)

    // Auto-fill hqLocation from USDA's registered address, but ONLY if it's
    // currently blank. This is the CERTIFIED FACILITY's address, not
    // necessarily the company's actual corporate headquarters (a company can
    // be certified at a manufacturing plant far from its real HQ) — so this
    // is a reasonable placeholder when we have nothing, but should never
    // silently overwrite a manually-researched, verified hqLocation.
    if (!matchedCompany.hqLocation) {
      const city = String(col(row, 'opPA_city') ?? col(row, 'opMA_city') ?? '').trim()
      const state = String(col(row, 'opPA_state') ?? col(row, 'opMA_state') ?? '').trim()
      const country = String(col(row, 'opPA_country') ?? col(row, 'opMA_country') ?? '').trim()

      if (city) {
        const isUS = !country || country.toUpperCase().startsWith('UNITED STATES') || country.toUpperCase() === 'US' || country.toUpperCase() === 'USA'
        const derivedLocation = isUS
          ? [city, state].filter(Boolean).join(', ')
          : [city, state, country].filter(Boolean).join(', ')

        log(`  Auto-filling hqLocation with certified facility address: "${derivedLocation}" (this is the certified facility, not confirmed as corporate HQ — worth verifying)`)
        hqLocationFilledCount++

        if (!DRY_RUN) {
          await prisma.company.update({
            where: { id: matchedCompany.id },
            data: { hqLocation: derivedLocation },
          })
          // Keep the in-memory copy in sync so we don't re-trigger this for
          // the same company again later in this same run
          matchedCompany.hqLocation = derivedLocation
        }
      }
    }

    if (!sourceUrl) {
      skippedNoSourceCount++
      log(`  SKIPPED (no source URL available, and no cid mapping for "${certifyingAgency}"). Needs manual review.`)
      continue
    }

    if (!DRY_RUN) {
      for (const product of matchedCompany.products) {
        const existing = await prisma.organicCertification.findFirst({
          where: {
            productId: product.id,
            certificateNumber: certData.certificateNumber,
          },
        })

        if (existing) {
          await prisma.organicCertification.update({
            where: { id: existing.id },
            data: {
              ...certData,
              lastVerifiedDate: new Date(),
            },
          })
          log(`  Updated existing record for ${product.name}`)
        } else {
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
  if (hqLocationFilledCount > 0) {
    log(`${hqLocationFilledCount} compan(y/ies) had hqLocation auto-filled from certified facility address — worth verifying these represent actual HQ, not just a manufacturing plant.`)
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
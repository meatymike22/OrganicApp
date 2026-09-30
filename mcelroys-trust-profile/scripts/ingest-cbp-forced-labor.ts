// Loads .env into process.env (DATABASE_URL)
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { VETTED_COMPANIES } from '@/lib/vetting'
import * as fs from 'fs'
import * as path from 'path'
// Proper CSV parser — needed because company name fields in this file can
// contain commas WITHIN a single entity's name (e.g. "Co., Ltd."), so a naive
// split(',') would incorrectly break individual names apart. Install with:
//   npm install csv-parse
import { parse } from 'csv-parse/sync'

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
// CBP publishes this as a downloadable CSV with a date-stamped filename that
// changes periodically (similar to USDA's monthly export) — download the
// current file from cbp.gov's Withhold Release Orders & Findings Dashboard
// and pass its path here.
// Usage:
//   npx tsx scripts/ingest-cbp-forced-labor.ts ./data/withhold-release-orders-findings.csv
//   npx tsx scripts/ingest-cbp-forced-labor.ts ./data/withhold-release-orders-findings.csv --live
const FILE_PATH = process.argv[2]
const DRY_RUN = process.argv[3] !== '--live'

if (!FILE_PATH) {
  console.error('Please provide a file path. Example:')
  console.error('  npx tsx scripts/ingest-cbp-forced-labor.ts ./data/withhold-release-orders-findings.csv')
  console.error('  npx tsx scripts/ingest-cbp-forced-labor.ts ./data/withhold-release-orders-findings.csv --live')
  process.exit(1)
}

// Same normalization approach used in the other ingestion scripts
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(/^\s*THE\s+/, '')
    .replace(/\b(LLC|INC|INCORPORATED|CO|CORP|CORPORATION|LTD|COMPANY)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Escapes special regex characters in a string, so a company name with
// characters like "." or "&" doesn't get misinterpreted as regex syntax
// when we build a word-boundary pattern from it
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// CRITICAL SAFETY CHECK — same principle as the FDA/CPSC scripts, adapted for
// this file's messier format. The "company_names" field in this CSV isn't a
// clean delimited list (individual entity names can themselves contain
// commas, e.g. "Co., Ltd."), so instead of splitting it into an array and
// requiring exact equality, this checks whether our normalized candidate name
// appears as a genuine WHOLE-WORD match within the normalized field text.
// Word-boundary matching (\b...\b) is what actually prevents the "Honest"/
// "Honesty" style false positive here: "HONEST" with word boundaries will NOT
// match inside "HONESTY", because there's no boundary between T and Y.
function isGenuineMatch(companyNamesField: string, candidateNames: string[]): boolean {
  const normalizedField = normalizeName(companyNamesField)
  return candidateNames.some((candidate) => {
    const normalizedCandidate = normalizeName(candidate)
    if (!normalizedCandidate) return false
    const pattern = new RegExp(`\\b${escapeRegex(normalizedCandidate)}\\b`)
    return pattern.test(normalizedField)
  })
}

async function main() {
  // Vetted companies only — this script matches by NAME, and an unvetted
  // company's name is a raw brand string (see src/lib/vetting.ts).
  const companies = await prisma.company.findMany({ where: VETTED_COMPANIES })

  log('Reading CBP forced labor CSV...')
  const fileContent = fs.readFileSync(FILE_PATH, 'utf-8')

  // Based on the real file's structure: date, year, country_code, country_name,
  // type, industry, status, source_url, company_names, notes — but CBP could
  // change column order/names over time, so this reads with headers where
  // possible and falls back to positional access if headers are absent.
  const records: Record<string, string>[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  })

  log(`Loaded ${records.length} WRO/Finding record(s) from CBP.`)

  let matchCount = 0
  let rejectedCount = 0

  for (const record of records) {
    // Column names observed in the real file — adjust here if CBP changes them
    const companyNamesField = record['Entity or Company'] ?? record['company_names'] ?? record['Company'] ?? ''
    if (!companyNamesField) continue

    for (const company of companies) {
      const candidateNames = [company.legalName, ...company.dbaNames]

      if (!isGenuineMatch(companyNamesField, candidateNames)) continue

      matchCount++

      const actionType = (record['Type'] ?? '').toLowerCase().includes('finding')
        ? 'finding'
        : 'withhold_release_order'

      const actionData = {
        sourceAgency: 'CBP',
        actionType,
        referenceNumber: null,
        classification: null,
        reason: `Forced labor concern — ${record['Industry'] ?? 'industry not specified'}, ${record['Country Name'] ?? record['country_name'] ?? 'country not specified'}`,
        productDescription: record['Industry'] ?? null,
        status: record['Status'] ?? null,
        actionDate: record['Date'] ? new Date(record['Date']) : null,
        terminationDate: null,
        sourceUrl: record['Source URL'] ?? record['source_url'] ?? '',
        sourceType: 'regulatory_filing',
        dataPulledDate: new Date(),
        aiDrafted: true,
      }

      log(`MATCH: "${companyNamesField}" -> ${company.legalName}`)
      log(actionData)

      if (!actionData.sourceUrl) {
        log('  SKIPPED (no source URL in this record). Needs manual review.')
        continue
      }

      if (!DRY_RUN) {
        // No stable referenceNumber in this file, so dedupe on company + source URL
        const existing = await prisma.regulatoryAction.findFirst({
          where: {
            companyId: company.id,
            sourceUrl: actionData.sourceUrl,
          },
        })

        if (existing) {
          await prisma.regulatoryAction.update({
            where: { id: existing.id },
            data: actionData,
          })
          log('  Updated existing record')
        } else {
          await prisma.regulatoryAction.create({
            data: {
              ...actionData,
              companyId: company.id,
            },
          })
          log('  Created new record')
        }
      }
    }
  }

  log(`\nDone. ${matchCount} match(es) found across ${companies.length} companies and ${records.length} CBP records.`)
  log('Note: WROs/Findings typically target raw-material suppliers and manufacturers deep in a supply chain, not consumer-facing brands — a low or zero match count against your current company list is expected and not necessarily a bug. See SupplyChainDisclosure for the actual supply-chain-mapping work this connects to.')

  if (DRY_RUN) {
    log('DRY RUN — nothing was written. Re-run with --live to commit.')
  } else {
    await prisma.ingestionLog.create({
      data: {
        source: 'cbp_forced_labor',
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
    writeLogFile('ingest-cbp-forced-labor')
    await prisma.$disconnect()
  })

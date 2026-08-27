// Loads .env into process.env (DATABASE_URL) — needed since this script runs
// outside the Prisma CLI, which normally does this automatically
import 'dotenv/config'
// Postgres-specific driver adapter, required by Prisma 7 to actually connect
import { PrismaPg } from '@prisma/adapter-pg'
// The generated client that knows about your schema's models
import { PrismaClient } from '@prisma/client'
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
const DRY_RUN = process.argv[2] !== '--live'
const ENDPOINTS = ['food', 'drug', 'device'] as const

// openFDA returns dates as an 8-digit string like "20230115" (YYYYMMDD),
// not a normal date format. This slices that string into year/month/day
// and builds a real JavaScript Date object from it — or returns null if
// the field was missing entirely.
function parseOpenFdaDate(raw: string | undefined): Date | null {
  if (!raw || raw.length !== 8) return null
  const year = raw.slice(0, 4)
  const month = raw.slice(4, 6)
  const day = raw.slice(6, 8)
  return new Date(`${year}-${month}-${day}`)
}

// Normalizes a company name the same way the USDA script does, so we can
// compare names consistently (case, punctuation, common suffixes stripped)
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(/^\s*THE\s+/, '') // strip a leading "The"
    .replace(/\b(LLC|INC|INCORPORATED|CO|CORP|CORPORATION|LTD|COMPANY)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// CRITICAL SAFETY CHECK: openFDA's search can return results where the search
// term appears somewhere in the recalling_firm field without that field
// actually BEING our company — e.g. searching "Honest" can match an entirely
// unrelated firm whose name happens to contain the word "Honest." Short or
// generic candidate names (single common words) are especially prone to this.
// This verifies the ACTUAL recalling_firm on the record is a genuine match to
// one of our candidate names — not just that the query happened to return it —
// before we ever treat it as a real match. Exact-after-normalization is strict
// on purpose: a missed match (false negative) just means manual follow-up;
// a wrongly-attributed recall (false positive) is a false public claim about
// a real company, which is worse.
function isGenuineMatch(actualFirmName: string, candidateNames: string[]): boolean {
  const normalizedFirm = normalizeName(actualFirmName)
  return candidateNames.some((candidate) => normalizeName(candidate) === normalizedFirm)
}

async function main() {
  const companies = await prisma.company.findMany()

  let matchCount = 0
  let rejectedFalsePositiveCount = 0

  for (const company of companies) {
    const candidateNames = [company.legalName, ...company.dbaNames]
    const seenReferenceNumbers = new Set<string>()

    for (const candidate of candidateNames) {
      for (const endpoint of ENDPOINTS) {
        const query = encodeURIComponent(`recalling_firm:"${candidate}"`)
        const url = `https://api.fda.gov/${endpoint}/enforcement.json?search=${query}&limit=100`

        const response = await fetch(url)

        if (response.status === 404) continue

        if (!response.ok) {
          logError(`Error querying ${endpoint} for "${candidate}": ${response.status}`)
          continue
        }

        const data = await response.json()
        const results = data.results ?? []

        for (const record of results) {
          const referenceNumber = record.recall_number ?? record.event_id ?? ''

          // Verify the actual recalling_firm on this record is genuinely our
          // company, not just something the search happened to return
          const actualFirmName = String(record.recalling_firm ?? '')
          if (!isGenuineMatch(actualFirmName, candidateNames)) {
            rejectedFalsePositiveCount++
            log(`  REJECTED false-positive match: searched "${candidate}", but actual recalling_firm was "${actualFirmName}" (recall ${referenceNumber}) — not the same company, skipping.`)
            continue
          }

          if (seenReferenceNumbers.has(referenceNumber)) continue
          seenReferenceNumbers.add(referenceNumber)

          matchCount++

          const actionData = {
            sourceAgency: 'FDA',
            actionType: 'recall',
            referenceNumber,
            classification: record.classification ?? null,
            reason: record.reason_for_recall ?? '',
            productDescription: record.product_description ?? null,
            status: record.status ?? null,
            actionDate: parseOpenFdaDate(record.recall_initiation_date),
            terminationDate: parseOpenFdaDate(record.termination_date),
            sourceUrl: `https://api.fda.gov/${endpoint}/enforcement.json?search=recall_number:"${referenceNumber}"`,
            sourceType: 'regulatory_filing',
            dataPulledDate: new Date(),
            aiDrafted: true,
          }

          log(`MATCH (${endpoint}): "${candidate}" -> ${company.legalName} (verified recalling_firm: "${actualFirmName}")`)
          log(actionData)

          if (!DRY_RUN) {
            const existing = await prisma.regulatoryAction.findFirst({
              where: {
                companyId: company.id,
                referenceNumber,
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
    }
  }

  log(`\nDone. ${matchCount} recall record(s) found across ${companies.length} companies.`)
  if (rejectedFalsePositiveCount > 0) {
    log(`${rejectedFalsePositiveCount} candidate match(es) rejected as false positives (search returned a result, but the actual company name didn't genuinely match).`)
  }

  if (DRY_RUN) {
    log('DRY RUN — nothing was written. Re-run with --live to commit.')
  } else {
    await prisma.ingestionLog.create({
      data: {
        source: 'fda_recalls',
        recordsMatched: matchCount,
        fileName: 'openFDA API (no file — live query)',
      },
    })
    log('Logged this run to IngestionLog.')
  }
}

main()
  .catch((e) => logError(e))
  .finally(async () => {
    writeLogFile('ingest-fda-recalls')
    await prisma.$disconnect()
  })
// Ingests FDA Warning Letters (and Seizures/Injunctions) from FDA's Data
// Dashboard API into RegulatoryAction.
//
// CREDENTIALS REQUIRED: unlike openFDA, this API needs an FDA-issued key.
// Request one via the OII Unified Logon application:
//   https://www.accessdata.fda.gov/scripts/oul
// FDA emails the key to the address you register. Then add to .env:
//   FDA_DASHBOARD_USER=your-registered-email@example.com
//   FDA_DASHBOARD_KEY=the-key-fda-emailed-you
//
// SCOPE CAVEATS (from FDA's own documentation):
//   - Covers Warning Letters, Seizures, and Injunctions only. Untitled
//     Letters, Administrative Actions, and Regulatory Meetings are NOT here.
//   - Only finalized/completed actions are included.
//   - Primarily domestic — foreign firms more often receive import alerts,
//     which are a separate dataset not covered by this endpoint.
//   So "no results" here does NOT mean "no FDA enforcement history."
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { VETTED_COMPANIES } from '@/lib/vetting'
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
const DRY_RUN = process.argv[2] !== '--live'
const API_URL = 'https://api-datadashboard.fda.gov/v1/compliance_actions'
// `?? ''` makes these plain strings: TypeScript doesn't carry the missing-
// credentials check below into main(), so without it fetch() rejects the
// headers as possibly undefined. An empty string still fails that check.
const FDA_USER = process.env.FDA_DASHBOARD_USER ?? ''
const FDA_KEY = process.env.FDA_DASHBOARD_KEY ?? ''

if (!FDA_USER || !FDA_KEY) {
  console.error('Missing FDA Data Dashboard credentials.')
  console.error('Add these to your .env file:')
  console.error('  FDA_DASHBOARD_USER=your-registered-email@example.com')
  console.error('  FDA_DASHBOARD_KEY=the-key-FDA-emailed-you')
  console.error('Request credentials at: https://www.accessdata.fda.gov/scripts/oul')
  process.exit(1)
}

const DELAY_MS = 500
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Same normalization used across all the other ingestion scripts
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    // Strip parenthetical abbreviations like "(P&G)" — the CPSC script silently
    // dropped a real Procter & Gamble recall because "(P&G)" survived
    // normalization and broke the exact match. Same fix applied here.
    .replace(/\([^)]*\)/g, '')
    .replace(/[.,]/g, '')
    .replace(/^\s*THE\s+/, '')
    .replace(/\b(LLC|INC|INCORPORATED|CO|CORP|CORPORATION|LTD|COMPANY)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Same false-positive guard as the FDA recalls / CPSC scripts: verify the
// name actually returned by the API genuinely matches one of our candidate
// names, rather than trusting that a search hit means a real match. This is
// what prevented the "Honest" / "Honesty" style misattribution earlier.
function isGenuineMatch(actualFirmName: string, candidateNames: string[]): boolean {
  const normalizedFirm = normalizeName(actualFirmName)
  return candidateNames.some((candidate) => normalizeName(candidate) === normalizedFirm)
}

async function main() {
  // Vetted companies only — this script matches by NAME, and an unvetted
  // company's name is a raw brand string (see src/lib/vetting.ts).
  const companies = await prisma.company.findMany({ where: VETTED_COMPANIES })
  log(`Checking ${companies.length} companies against FDA Data Dashboard compliance actions...`)

  let matchCount = 0
  let rejectedCount = 0

  for (const company of companies) {
    const candidateNames = [company.legalName, ...company.dbaNames]

    for (const candidate of candidateNames) {
      // All Data Dashboard endpoints use POST with a JSON body.
      // A unique signature is recommended because responses are cached —
      // reusing a signature can return a stale cached result (including a
      // stale 401), which is a documented gotcha with this API.
      // Per FDA's docs, sort/sortorder/filters/columns are all REQUIRED keys,
      // and any key name not on their allowed list causes an error response.
      // ActionType is filtered server-side (valid values: Injunction, Seizure,
      // Warning Letter) rather than fetching everything and discarding.
      const requestBody = {
        start: 1,
        rows: 100,
        returntotalcount: true,
        sort: 'ActionTakenDate',
        sortorder: 'DESC',
        filters: {
          LegalName: [candidate],
          ActionType: ['Warning Letter'],
        },
        columns: [],
      }

      let response: Response
      try {
        // No query parameters — FDA's statuscode 404 means "Invalid request
        // endpoint", and appending anything to the URL triggers it.
        response = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization-User': FDA_USER,
            'Authorization-Key': FDA_KEY,
          },
          body: JSON.stringify(requestBody),
        })
      } catch (err) {
        logError(`Network error querying "${candidate}":`, err)
        await sleep(DELAY_MS)
        continue
      }

      if (!response.ok) {
        logError(`HTTP ${response.status} querying "${candidate}". A 401 means the credentials in .env were rejected.`)
        await sleep(DELAY_MS)
        continue
      }

      const data = await response.json()

      // NOTE: this API uses NON-STANDARD statuscodes in the response body.
      // Per FDA's documentation, 400 means SUCCESS (not the usual 200), and
      // 412 means "No results found" — a normal outcome, not an error.
      // Results come back under "result" (singular), unlike openFDA's "results".
      const SUCCESS_CODE = 400
      const NO_RESULTS_CODE = 412

      if (data.statuscode !== undefined && data.statuscode !== SUCCESS_CODE) {
        if (data.statuscode !== NO_RESULTS_CODE) {
          logError(`API statuscode ${data.statuscode} for "${candidate}": ${data.message ?? ''}`,
            data.invalid_filters ? `invalid_filters: ${JSON.stringify(data.invalid_filters)}` : '',
            data.invalid_parameters ? `invalid_parameters: ${JSON.stringify(data.invalid_parameters)}` : '')
        }
        await sleep(DELAY_MS)
        continue
      }

      const results = data.result ?? []
      if (!Array.isArray(results) || results.length === 0) {
        await sleep(DELAY_MS)
        continue
      }

      for (const record of results) {
        const actualFirmName = String(record.LegalName ?? '')

        // ESSENTIAL: FDA documents LegalName as a PARTIAL match (LIKE %value%),
        // so a search for "Honest" genuinely will return firms whose names
        // merely CONTAIN that string. This guard is what prevents attributing
        // another company's warning letter to one of ours.
        if (!isGenuineMatch(actualFirmName, candidateNames)) {
          rejectedCount++
          log(`  REJECTED false-positive: searched "${candidate}", actual firm was "${actualFirmName}" — not the same company.`)
          continue
        }

        matchCount++

        // CaseInjunctionID is the real ID field (there is no "ActionId").
        const referenceNumber = record.CaseInjunctionID
          ? String(record.CaseInjunctionID)
          : null

        // FirmProfile is the FDA Data Dashboard URL for this firm — the only
        // URL this dataset provides. There is NO per-letter URL field, so the
        // citation points at the firm's compliance profile rather than the
        // letter document itself. Worth noting during review.
        const sourceUrl = record.FirmProfile
          ? String(record.FirmProfile)
          : 'https://datadashboard.fda.gov/oii/cd/complianceactions.htm'

        const actionData = {
          sourceAgency: 'FDA',
          actionType: 'warning_letter',
          referenceNumber,
          classification: null,
          reason: `FDA Warning Letter${record.ProductType ? ` — product type: ${record.ProductType}` : ''}${record.Center ? ` (FDA Center: ${record.Center})` : ''}`,
          productDescription: record.ProductType ? String(record.ProductType) : null,
          status: null,
          actionDate: record.ActionTakenDate ? new Date(record.ActionTakenDate) : null,
          terminationDate: null,
          sourceUrl,
          sourceType: 'regulatory_filing',
          dataPulledDate: new Date(),
          aiDrafted: true,
        }

        log(`MATCH: "${candidate}" -> ${company.legalName} (verified firm: "${actualFirmName}")`)
        log(actionData)

        if (!DRY_RUN) {
          const existing = referenceNumber
            ? await prisma.regulatoryAction.findFirst({
                where: { companyId: company.id, referenceNumber },
              })
            : null

          if (existing) {
            await prisma.regulatoryAction.update({
              where: { id: existing.id },
              data: actionData,
            })
            log('  Updated existing record')
          } else {
            await prisma.regulatoryAction.create({
              data: { ...actionData, companyId: company.id },
            })
            log('  Created new record')
          }
        }
      }

      await sleep(DELAY_MS)
    }
  }

  log(`\nDone. ${matchCount} warning letter(s) found across ${companies.length} companies.`)
  if (rejectedCount > 0) {
    log(`${rejectedCount} candidate match(es) rejected as false positives.`)
  }
  log('Reminder: this dataset covers only finalized Warning Letters/Seizures/Injunctions and is primarily domestic. Zero results does not mean zero FDA enforcement history.')

  if (DRY_RUN) {
    log('DRY RUN — nothing was written. Re-run with --live to commit.')
  } else {
    await prisma.ingestionLog.create({
      data: {
        source: 'fda_warning_letters',
        recordsMatched: matchCount,
        fileName: 'FDA Data Dashboard API (no file — live query)',
      },
    })
    log('Logged this run to IngestionLog.')
  }
}

main()
  .catch((e) => logError(e))
  .finally(async () => {
    writeLogFile('ingest-fda-warning-letters')
    await prisma.$disconnect()
  })

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
// Collects every line we print into an array, so at the end of the run we can
// write it all to a text file — in addition to still showing it live in the terminal.
const logLines: string[] = []

function log(...args: unknown[]) {
  // Convert each argument to a readable string — objects get pretty-printed JSON
  // instead of the unreadable "[object Object]" a plain join would produce
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
// creating that folder first if it doesn't already exist
function writeLogFile(prefix: string) {
  const dir = './logs'
  fs.mkdirSync(dir, { recursive: true })
  // Timestamp with colons/periods stripped, since those aren't safe in filenames on Windows
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(dir, `${prefix}-${timestamp}.txt`)
  fs.writeFileSync(filePath, logLines.join('\n'))
  console.log(`\nFull output saved to ${filePath}`)
}

// --- CONFIG ---
// Defaults to dry-run (safe, no writes) unless --live is passed as an argument.
// process.argv[0] = "node", [1] = this script's path, [2] = your actual argument
// Usage:
//   npx tsx scripts/ingest-fda-recalls.ts            (dry run, safe, prints only)
//   npx tsx scripts/ingest-fda-recalls.ts --live      (actually writes to the DB)
const DRY_RUN = process.argv[2] !== '--live'

// openFDA splits recall data into three separate product categories, each with
// its own API endpoint. A food company probably won't show up under "drug" or
// "device", but checking all three is cheap and means we won't silently miss anything.
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

async function main() {
  // Load every company already in our database — we're checking each one
  // against the FDA's data, not the other way around
  const companies = await prisma.company.findMany()

  let matchCount = 0

  // Loop over every company one at a time
  for (const company of companies) {
    // A recall might be filed under the company's official legal name,
    // or under one of its consumer-facing brand names (dbaNames) — check both
    const candidateNames = [company.legalName, ...company.dbaNames]

    // Track which recall reference numbers we've already recorded for THIS
    // company during THIS run. Without this, if two candidate names both
    // happen to match the same recall, we'd log/save it twice.
    const seenReferenceNumbers = new Set<string>()

    // For each possible name, and for each of the three product categories...
    for (const candidate of candidateNames) {
      for (const endpoint of ENDPOINTS) {
        // Build openFDA's search syntax: field:"exact phrase"
        // encodeURIComponent makes the string safe to put inside a URL
        // (spaces, quotes, etc. get converted to their URL-safe equivalents)
        const query = encodeURIComponent(`recalling_firm:"${candidate}"`)
        const url = `https://api.fda.gov/${endpoint}/enforcement.json?search=${query}&limit=100`

        // Node has a built-in fetch() function — no extra library needed to
        // make this HTTP request
        const response = await fetch(url)

        // openFDA responds with a 404 status (not an empty result list) when
        // a search matches nothing at all. That's a normal "no results" case
        // here, not a real error — so just move on to the next endpoint.
        if (response.status === 404) continue

        // Any other non-success status IS worth flagging, so log it and continue
        if (!response.ok) {
          logError(`Error querying ${endpoint} for "${candidate}": ${response.status}`)
          continue
        }

        // Parse the JSON response body into a usable JavaScript object
        const data = await response.json()
        // openFDA nests actual results inside a "results" array —
        // "?? []" means "use an empty array if results is missing", so the
        // code below doesn't crash on an unexpected response shape
        const results = data.results ?? []

        // Loop over every recall record openFDA returned for this search
        for (const record of results) {
          // Use the official recall number if present, otherwise fall back
          // to the event_id, otherwise an empty string as a last resort
          const referenceNumber = record.recall_number ?? record.event_id ?? ''

          // Skip if we've already processed this exact recall earlier in this run
          if (seenReferenceNumbers.has(referenceNumber)) continue
          seenReferenceNumbers.add(referenceNumber)

          matchCount++

          // Map openFDA's field names onto our own schema's field names
          const actionData = {
            sourceAgency: 'FDA',
            actionType: 'recall',
            referenceNumber,
            classification: record.classification ?? null, // e.g. Class I/II/III severity
            reason: record.reason_for_recall ?? '',
            productDescription: record.product_description ?? null,
            status: record.status ?? null, // e.g. "Ongoing", "Terminated"
            actionDate: parseOpenFdaDate(record.recall_initiation_date),
            terminationDate: parseOpenFdaDate(record.termination_date),
            // Build a citable source URL — a search query that leads back to this exact record
            sourceUrl: `https://api.fda.gov/${endpoint}/enforcement.json?search=recall_number:"${referenceNumber}"`,
            sourceType: 'regulatory_filing',
            dataPulledDate: new Date(),
            aiDrafted: true, // this record was written by an automated script, not typed by hand
          }

          log(`MATCH (${endpoint}): "${candidate}" -> ${company.legalName}`)
          log(actionData)

          // Only actually touch the database if --live was passed
          if (!DRY_RUN) {
            // Check whether we already have this exact recall on file,
            // so re-running the script doesn't create duplicate rows
            const existing = await prisma.regulatoryAction.findFirst({
              where: {
                companyId: company.id,
                referenceNumber,
              },
            })

            if (existing) {
              // Already have it — update in case status/details changed since last pull
              await prisma.regulatoryAction.update({
                where: { id: existing.id },
                data: actionData,
              })
              log('  Updated existing record')
            } else {
              // New recall we haven't seen before — create it
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

  if (DRY_RUN) {
    log('DRY RUN — nothing was written. Re-run with --live to commit.')
  } else {
    // Record that this ingestion actually ran, same pattern as the USDA script,
    // so the app can later show "data last refreshed on [date]"
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

// Run everything above, log any error instead of crashing silently,
// write the collected log to a file, and always close the database connection when done
main()
  .catch((e) => logError(e))
  .finally(async () => {
    writeLogFile('ingest-fda-recalls')
    await prisma.$disconnect()
  })
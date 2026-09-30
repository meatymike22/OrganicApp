// Loads .env into process.env (DATABASE_URL)
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { VETTED_COMPANIES } from '@/lib/vetting'
import * as fs from 'fs'
import * as path from 'path'

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

let hasLoggedRawSample = false

// Normalizes a company name the same way the USDA/FDA scripts do
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    // CPSC consistently appends a location clause like ", of Cincinnati, Ohio"
    // to company names — strip it before comparing. Safe to do only here,
    // since this is a CPSC-specific formatting convention, not part of the
    // company's actual legal name.
    .replace(/,?\s+OF\s+.+$/, '')
    // Strip parenthetical abbreviations like "(P&G)". Without this,
    // "Procter & Gamble Company (P&G)" normalizes to "PROCTER & GAMBLE (P&G)"
    // and fails to match "Procter & Gamble" — a real recall silently dropped.
    // Safe: an exact match is still required after normalization.
    .replace(/\([^)]*\)/g, '')
    .replace(/[.,]/g, '')
    .replace(/^\s*THE\s+/, '') // strip a leading "The"
    .replace(/\b(LLC|INC|INCORPORATED|CO|CORP|CORPORATION|LTD|COMPANY)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// CRITICAL SAFETY CHECK — same reasoning as ingest-fda-recalls.ts: CPSC's
// Manufacturer search parameter can return records where the search term
// appears somewhere in a manufacturer/distributor/retailer name without that
// entity actually BEING our company (e.g. searching "Honest" matched an Avon
// recall because a Chinese sub-manufacturer's name happened to contain
// "Honesty"). This verifies at least one of the record's actual company names
// is a genuine match to one of our candidates before accepting it.
function isGenuineMatch(record: any, candidateNames: string[]): boolean {
  const allNamedEntities = [
    ...(Array.isArray(record.Manufacturers) ? record.Manufacturers.map((m: any) => m.Name) : []),
    ...(Array.isArray(record.Distributors) ? record.Distributors.map((d: any) => d.Name) : []),
    ...(Array.isArray(record.Importers) ? record.Importers.map((i: any) => i.Name) : []),
  ].filter(Boolean)

  return allNamedEntities.some((entityName: string) => {
    const normalizedEntity = normalizeName(entityName)
    return candidateNames.some((candidate) => normalizeName(candidate) === normalizedEntity)
  })
}

async function main() {
  // Vetted companies only — this script matches by NAME, and an unvetted
  // company's name is a raw brand string (see src/lib/vetting.ts).
  const companies = await prisma.company.findMany({ where: VETTED_COMPANIES })

  let matchCount = 0
  let rejectedFalsePositiveCount = 0

  for (const company of companies) {
    const candidateNames = [company.legalName, ...company.dbaNames]
    const seenReferenceNumbers = new Set<string>()

    // Search every ROLE a company can play on a CPSC record, not just
    // Manufacturer. A brand that has its product made overseas appears as the
    // IMPORTER (or distributor), with the foreign factory listed as the
    // manufacturer. Searching Manufacturer alone missed TOMY's Boon NURSH
    // bottle recall entirely — the bottles were made in Vietnam, so TOMY was
    // not the manufacturer of record. For baby products and toys, most of
    // which are made abroad, this would silently miss the majority of recalls.
    // isGenuineMatch() below already verifies all three roles; this just makes
    // sure those records are fetched in the first place.
    const SEARCH_ROLES = ['Manufacturer', 'Importer', 'Distributor'] as const

    for (const candidate of candidateNames) {
     for (const role of SEARCH_ROLES) {
      const query = encodeURIComponent(candidate)
      const url = `https://www.saferproducts.gov/RestWebServices/Recall?${role}=${query}&format=json`

      let response: Response
      try {
        response = await fetch(url)
      } catch (err) {
        logError(`Network error querying CPSC (${role}) for "${candidate}":`, err)
        continue
      }

      if (!response.ok) {
        logError(`Error querying CPSC (${role}) for "${candidate}": ${response.status}`)
        continue
      }

      let records: any[]
      try {
        records = await response.json()
      } catch (err) {
        const text = await response.text().catch(() => '(could not read body)')
        logError(`Could not parse JSON for "${candidate}". Raw response starts with:`, text.slice(0, 300))
        continue
      }

      if (!Array.isArray(records) || records.length === 0) continue

      if (!hasLoggedRawSample) {
        log('DEBUG — raw sample record from CPSC API (first match only, for structure verification):')
        log(records[0])
        hasLoggedRawSample = true
      }

      for (const record of records) {
        const referenceNumber = String(record.RecallNumber ?? record.RecallID ?? '')
        if (!referenceNumber) continue

        // Verify at least one real manufacturer/distributor/importer name on
        // this record genuinely matches our company, not just that the search
        // query happened to return it
        if (!isGenuineMatch(record, candidateNames)) {
          rejectedFalsePositiveCount++
          const namesOnRecord = [
            ...(record.Manufacturers ?? []).map((m: any) => m.Name),
            ...(record.Distributors ?? []).map((d: any) => d.Name),
          ].join('; ')
          log(`  REJECTED false-positive match: searched "${candidate}", but record ${referenceNumber} actual names were "${namesOnRecord}" — not the same company, skipping.`)
          continue
        }

        if (seenReferenceNumbers.has(referenceNumber)) continue
        seenReferenceNumbers.add(referenceNumber)

        matchCount++

        const productDescription = Array.isArray(record.Products)
          ? record.Products.map((p: any) => p.Name).filter(Boolean).join(', ')
          : null
        const reason = Array.isArray(record.Hazards)
          ? record.Hazards.map((h: any) => h.Name).filter(Boolean).join(', ')
          : record.Description ?? ''

        const actionDate = record.RecallDate ? new Date(record.RecallDate) : null

        const actionData = {
          sourceAgency: 'CPSC',
          actionType: 'recall',
          referenceNumber,
          classification: null,
          reason,
          productDescription,
          status: null,
          actionDate,
          terminationDate: null,
          sourceUrl: record.URL ?? url,
          sourceType: 'regulatory_filing',
          dataPulledDate: new Date(),
          aiDrafted: true,
        }

        log(`MATCH (${role}): "${candidate}" -> ${company.legalName}`)
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
    log(`${rejectedFalsePositiveCount} candidate match(es) rejected as false positives.`)
  }

  if (DRY_RUN) {
    log('DRY RUN — nothing was written. Re-run with --live to commit.')
  } else {
    await prisma.ingestionLog.create({
      data: {
        source: 'cpsc_recalls',
        recordsMatched: matchCount,
        fileName: 'saferproducts.gov API (no file — live query)',
      },
    })
    log('Logged this run to IngestionLog.')
  }
}

main()
  .catch((e) => logError(e))
  .finally(async () => {
    writeLogFile('ingest-cpsc-recalls')
    await prisma.$disconnect()
  })

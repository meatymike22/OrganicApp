// Ingests public-company filing data from the SEC EDGAR API into InvestorFiling.
//
// IMPORTANT CONTEXT: most companies in this database are PRIVATE and therefore
// have no SEC filings at all — that is the expected, correct result for them,
// not a failure. Private companies have no federal filing obligation. This
// script's honest job is as much about confirming which companies are public
// as it is about pulling data for the few that are.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { userAgent } from '@/lib/userAgent'
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
// Usage:
//   npx tsx scripts/ingest-sec-edgar.ts            (dry run, safe)
//   npx tsx scripts/ingest-sec-edgar.ts --live      (writes to DB)
const DRY_RUN = process.argv[2] !== '--live'

// SEC REQUIRES a User-Agent header identifying who you are, with a contact
// email — requests without one are commonly rejected with HTTP 403.
// Real contact address comes from CONTACT_EMAIL in .env — see src/lib/userAgent.ts
const USER_AGENT = userAgent()

// SEC asks for no more than 10 requests/second. 250ms between requests keeps
// us comfortably under that (4/sec) while still finishing quickly.
const DELAY_MS = 250
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Same normalization used in the other ingestion scripts, so company-name
// matching behaves consistently across all sources
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(/^\s*THE\s+/, '')
    .replace(/\b(LLC|INC|INCORPORATED|CO|CORP|CORPORATION|LTD|COMPANY)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

type TickerEntry = { cik_str: number; ticker: string; title: string }

async function main() {
  // Vetted companies only — this script matches by NAME, and an unvetted
  // company's name is a raw brand string (see src/lib/vetting.ts).
  const companies = await prisma.company.findMany({ where: VETTED_COMPANIES })
  log(`Checking ${companies.length} companies against SEC EDGAR...`)

  // Step 1: fetch SEC's ticker->CIK map once (a single ~1MB file covering all
  // ~10,000 SEC-registered filers), rather than querying per company
  log('Fetching SEC ticker-to-CIK map...')
  const mapResponse = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': USER_AGENT },
  })

  if (!mapResponse.ok) {
    logError(`Failed to fetch SEC ticker map: ${mapResponse.status}. If this is a 403, check that USER_AGENT is set to a real contact address.`)
    return
  }

  const tickerMap = (await mapResponse.json()) as Record<string, TickerEntry>
  const entries = Object.values(tickerMap)
  log(`Loaded ${entries.length} SEC-registered filers from the ticker map.`)

  // Build a normalized-name lookup so we can match our companies against it
  const byNormalizedName = new Map<string, TickerEntry>()
  for (const entry of entries) {
    byNormalizedName.set(normalizeName(entry.title), entry)
  }

  let publicCount = 0
  let privateCount = 0

  for (const company of companies) {
    const candidateNames = [company.legalName, ...company.dbaNames]

    let matched: TickerEntry | undefined
    for (const candidate of candidateNames) {
      const found = byNormalizedName.get(normalizeName(candidate))
      if (found) {
        matched = found
        break
      }
    }

    if (!matched) {
      privateCount++
      log(`NO SEC FILER MATCH: ${company.legalName} — not found among SEC-registered filers (expected for private companies).`)
      continue
    }

    publicCount++
    // CIK must be zero-padded to 10 digits in API URLs
    const paddedCik = String(matched.cik_str).padStart(10, '0')
    log(`SEC FILER MATCH: ${company.legalName} -> "${matched.title}" (ticker ${matched.ticker}, CIK ${paddedCik})`)

    await sleep(DELAY_MS)

    // Step 2: fetch this filer's submission history
    const subResponse = await fetch(`https://data.sec.gov/submissions/CIK${paddedCik}.json`, {
      headers: { 'User-Agent': USER_AGENT },
    })

    if (!subResponse.ok) {
      logError(`  Failed to fetch submissions for CIK ${paddedCik}: ${subResponse.status}`)
      continue
    }

    const submissions = await subResponse.json()
    const recent = submissions.filings?.recent

    if (!recent || !Array.isArray(recent.form)) {
      log('  No recent filings data returned.')
      continue
    }

    // Find the most recent DEF 14A (annual proxy statement) — this is the
    // filing that contains the "Security Ownership of Certain Beneficial
    // Owners and Management" table, i.e. the major-shareholder data.
    let proxyIndex = -1
    for (let i = 0; i < recent.form.length; i++) {
      if (recent.form[i] === 'DEF 14A') {
        proxyIndex = i
        break
      }
    }

    const filingDate = proxyIndex >= 0 ? recent.filingDate[proxyIndex] : null
    const accessionNo = proxyIndex >= 0 ? String(recent.accessionNumber[proxyIndex]).replace(/-/g, '') : null
    const primaryDoc = proxyIndex >= 0 ? recent.primaryDocument[proxyIndex] : null

    const sourceUrl = accessionNo && primaryDoc
      ? `https://www.sec.gov/Archives/edgar/data/${matched.cik_str}/${accessionNo}/${primaryDoc}`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik}&type=DEF+14A`

    const filingData = {
      ticker: matched.ticker,
      // NOTE: majorShareholders is intentionally left null. That data lives in
      // a prose/HTML table INSIDE the DEF 14A document, not in any structured
      // API field — extracting it reliably would require parsing the filing
      // itself. sourceUrl points to the right document for manual entry.
      majorShareholders: undefined,
      institutionalOwnershipPct: null,
      filingDate: filingDate ? new Date(filingDate) : null,
      publicStatus: 'public',
      parentCompany: null,
      sourceUrl,
      sourceType: 'regulatory_filing',
      dataPulledDate: new Date(),
      aiDrafted: true,
    }

    log('  Most recent DEF 14A:', proxyIndex >= 0 ? filingDate : 'none found')
    log(filingData)

    if (!DRY_RUN) {
      // Only create if this company has no InvestorFiling yet — deliberately
      // does NOT overwrite existing records, since some (e.g. Kellanova's
      // Mars acquisition) were hand-researched with detail this script cannot
      // reproduce, and clobbering that with thinner automated data would be
      // a regression.
      const existing = await prisma.investorFiling.findFirst({
        where: { companyId: company.id },
      })

      if (existing) {
        log('  SKIPPED WRITE — an InvestorFiling record already exists for this company (not overwriting hand-entered data).')
      } else {
        await prisma.investorFiling.create({
          data: { ...filingData, companyId: company.id },
        })
        log('  Created new InvestorFiling record')
      }
    }

    await sleep(DELAY_MS)
  }

  log(`\nDone. ${publicCount} SEC-registered filer(s) matched, ${privateCount} not found (expected for private companies).`)

  if (DRY_RUN) {
    log('DRY RUN — nothing was written. Re-run with --live to commit.')
  } else {
    await prisma.ingestionLog.create({
      data: {
        source: 'sec_edgar',
        recordsMatched: publicCount,
        fileName: 'SEC EDGAR API (no file — live query)',
      },
    })
    log('Logged this run to IngestionLog.')
  }
}

main()
  .catch((e) => logError(e))
  .finally(async () => {
    writeLogFile('ingest-sec-edgar')
    await prisma.$disconnect()
  })

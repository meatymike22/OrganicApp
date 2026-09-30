// Ingests USDA FSIS recalls and public health alerts into RegulatoryAction.
//
// WHY THIS EXISTS: FDA does NOT regulate meat, poultry or processed egg
// products — USDA's Food Safety and Inspection Service does. Running only
// openFDA leaves a hole rather than partial coverage: a chicken broth, a
// turkey dinner or a canned chicken product would show "no recalls" when the
// agency that actually regulates it was never queried. FDA and FSIS together
// cover the US food supply; either alone does not.
//
// Usage:
//   npx tsx scripts/ingest-fsis-recalls.ts --fields   (inspect the API's field names)
//   npx tsx scripts/ingest-fsis-recalls.ts            (dry run)
//   npx tsx scripts/ingest-fsis-recalls.ts --live
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { VETTED_COMPANIES } from '@/lib/vetting'
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

const DRY_RUN = !process.argv.includes('--live')
const FIELDS_ONLY = process.argv.includes('--fields')
const API_URL = 'https://www.fsis.usda.gov/fsis/api/recall/v/1'

// This endpoint sits behind Akamai bot protection despite being a public
// government API: a bare fetch is rejected. Sending ordinary browser headers
// is what makes it respond — not an attempt to disguise the client, just the
// minimum the CDN expects.
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
}

function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/,?\s+OF\s+.+$/, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[.,]/g, '')
    .replace(/^\s*THE\s+/, '')
    .replace(/\b(LLC|INC|INCORPORATED|CO|CORP|CORPORATION|LTD|COMPANY)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// FSIS is a Drupal-backed API and its field names are not documented on the
// public page, so detect them by pattern rather than hardcoding guesses.
// Run with --fields to see the real keys before trusting any mapping.
function pick(rec: Record<string, unknown>, patterns: RegExp[]): string {
  for (const p of patterns) {
    const key = Object.keys(rec).find((k) => p.test(k))
    if (key && rec[key] != null && String(rec[key]).trim() !== '') return String(rec[key])
  }
  return ''
}

// Strips the HTML that FSIS returns inside several text fields.
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    // FSIS returns HTML-encoded text in several fields; without decoding, a
    // product reads as: A&amp;D Foods &quot;GOAT CUT 1-1/2&quot;
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&bull;/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

// FSIS titles follow a consistent shape: the recalling company always comes
// first, followed by the action —
//   "Star Meat Delivery Inc. Recalls Raw Pork, Beef, and Goat Products..."
//   "XYZ Foods Issues Public Health Alert for..."
// field_establishment is frequently EMPTY, and the only other field carrying a
// company name (field_company_media_contact) is a contact block with a person
// and phone number in it. So the title is the most reliable company source.
function companyFromTitle(title: string): string {
  // When FSIS itself issues an alert, the company comes AFTER "for":
  //   "FSIS Issues Public Health Alert for Nurture Life Ready-To-Eat Chicken..."
  // Parsing left-to-right here would return "FSIS" as the recalling company.
  const fsisIssued = title.match(/^FSIS\s+Issues?\s+.*?\bfor\s+(.+)$/i)
  if (fsisIssued) {
    // Trim the product description that follows the company name. FSIS phrases
    // these as "<Company> <Product> Product(s) Due to ...".
    const after = fsisIssued[1].trim()
    // Not every alert names a company here. Some read "...Public Health Alert
    // for a Frozen Chicken Product", where the text after "for" is a generic
    // description. Stripping the product words then leaves the bare article
    // "a", which is worse than no answer — it matched every company whose
    // name merely contains that letter.
    if (/^(a|an|the)\s+/i.test(after)) return ''
    const trimmed = after
      .replace(/\s+(Ready-To-Eat|Frozen|Raw|Canned)\b.*$/i, '')
      .replace(/\s+Products?\b.*$/i, '')
      .replace(/\s+Due to\b.*$/i, '')
      .trim()
    // A one- or two-character remnant is parsing debris, not a company.
    return trimmed.length >= 3 ? trimmed : ''
  }
  const m = title.match(/^(.*?)\s+(Recalls|Issues|Expands|Updates|Recall of)\b/i)
  return m ? m[1].trim() : ''
}

async function main() {
  log('Fetching FSIS recall and public health alert data...')
  let response: Response
  try {
    response = await fetch(API_URL, { headers: BROWSER_HEADERS })
  } catch (err) {
    logError('Network error contacting FSIS:', err); return
  }
  if (!response.ok) {
    logError(`FSIS API returned ${response.status}. A 403 usually means the CDN rejected the request — check the headers above.`)
    return
  }

  const raw = await response.json()
  const records: Record<string, unknown>[] = Array.isArray(raw) ? raw : (raw.results ?? raw.data ?? [])
  log(`Received ${records.length} record(s).`)
  if (records.length === 0) { logError('No records returned.'); return }

  if (FIELDS_ONLY) {
    log('\nField names on the first record:')
    Object.keys(records[0]).forEach((k) => {
      const v = String(records[0][k] ?? '')
      log(`  ${k}: ${v.length > 120 ? v.slice(0, 120) + '…' : v}`)
    })
    return
  }

  // Vetted companies only — this script matches by NAME, and an unvetted
  // company's name is a raw brand string (see src/lib/vetting.ts).
  const companies = await prisma.company.findMany({ where: VETTED_COMPANIES })
  log(`Matching against ${companies.length} companies.\n`)

  let matchCount = 0
  let rejectedCount = 0

  let skippedTranslations = 0

  for (const rec of records) {
    // FSIS publishes a separate record for the Spanish translation of the same
    // recall, sharing its recall number. Ingesting both would duplicate every
    // bilingual action.
    const lang = pick(rec, [/^langcode$/i])
    if (lang && !/english/i.test(lang)) { skippedTranslations++; continue }

    // The company responsible for the recall. FSIS names the recalling
    // establishment; the title usually leads with it too.
    const title = stripHtml(pick(rec, [/^field_title$/i, /title/i]))
    // Prefer the dedicated establishment field; fall back to parsing the
    // title, which is populated far more consistently.
    const establishmentField = pick(rec, [/^field_establishment$/i])
    const titleCompany = companyFromTitle(title)
    const recallingCompany = establishmentField || titleCompany

    for (const company of companies) {
      const candidates = [company.legalName, ...company.dbaNames]

      // Match ONLY against the recalling company, and require exact equality
      // after normalization — the same rule as the FDA and CPSC scripts.
      //
      // An earlier version searched the whole title with word boundaries and
      // matched "Nurture LLC" to a public health alert for "Nurture Life", an
      // unrelated meal-delivery company: stripping "LLC" leaves "NURTURE",
      // which sits inside "NURTURE LIFE". Word boundaries are not enough when
      // one company's whole name is another's first word.
      const normalizedCompany = normalizeName(recallingCompany)
      if (!normalizedCompany) continue
      const matched = candidates.find((c) => normalizeName(c) === normalizedCompany)
      if (!matched) {
        // Count a near-miss so genuine matches aren't lost silently to an
        // unrecorded trading name.
        // Both sides need a meaningful length before a containment test means
        // anything: with a short normalizedCompany, n.includes(...) is true for
        // almost any name that happens to contain those letters.
        if (normalizedCompany.length >= 4 && candidates.some((c) => {
          const n = normalizeName(c)
          return n.length >= 4 && (normalizedCompany.includes(n) || n.includes(normalizedCompany))
        })) {
          rejectedCount++
          log(`  REJECTED: recalling company "${recallingCompany}" resembles but does not equal one of ${company.legalName}'s names. If it is genuinely them, add the exact name to dbaNames.`)
        }
        continue
      }

      // FSIS records name the ESTABLISHMENT that produced the product, which
      // is often a co-packer rather than the brand owner. A match on the title
      // alone is weaker evidence than a match on the establishment field.
      const referenceNumber = pick(rec, [/recall_number/i, /recallnumber/i, /number/i]) || null
      const classification = pick(rec, [/classification/i]) || null
      const reason = stripHtml(pick(rec, [/reason/i, /summary/i, /description/i])) || 'FSIS recall'
      const productDescription = stripHtml(pick(rec, [/product/i, /item/i])) || null
      const dateStr = pick(rec, [/recall_date/i, /date/i])
      const actionDate = dateStr && !isNaN(Date.parse(dateStr)) ? new Date(dateStr) : null
      const urlField = pick(rec, [/url/i, /link/i, /path/i])
      const sourceUrl = urlField.startsWith('http')
        ? urlField
        : urlField
          ? `https://www.fsis.usda.gov${urlField}`
          : 'https://www.fsis.usda.gov/recalls'

      // A "public health alert" is issued when a recall cannot be requested —
      // typically because the product is no longer available for recall. It is
      // a distinct action type and should not be labelled a recall.
      // field_recall_type is the authoritative status ("Active Recall",
      // "Public Health Alert", "Closed Recall"). field_active_notice is only
      // the string "True"/"False" and says nothing about what kind of action
      // this is.
      const recallType = pick(rec, [/recall_type/i])
      const riskLevel = pick(rec, [/risk_level/i])
      const isAlert = /public health alert/i.test(`${recallType} ${title}`)

      const actionData = {
        sourceAgency: 'FSIS',
        actionType: isAlert ? 'public_health_alert' : 'recall',
        referenceNumber,
        // field_risk_level is richer ("High - Class I") than the bare class.
        classification: riskLevel || classification,
        reason,
        productDescription,
        status: recallType || null,
        actionDate,
        terminationDate: null,
        sourceUrl,
        sourceType: 'regulatory_filing',
        dataPulledDate: new Date(),
        aiDrafted: true,
      }

      matchCount++
      log(`MATCH: "${matched}" -> ${company.legalName}`)
      log(`  recalling company: ${recallingCompany || '(could not determine)'}${establishmentField ? '' : ' (parsed from title; field_establishment was empty)'}`)
      log(`  title: ${title}`)
      log(actionData)

      if (!DRY_RUN) {
        const existing = referenceNumber
          ? await prisma.regulatoryAction.findFirst({ where: { companyId: company.id, referenceNumber } })
          : await prisma.regulatoryAction.findFirst({ where: { companyId: company.id, sourceUrl } })
        if (existing) {
          await prisma.regulatoryAction.update({ where: { id: existing.id }, data: actionData })
          log('  Updated existing record')
        } else {
          await prisma.regulatoryAction.create({ data: { ...actionData, companyId: company.id } })
          log('  Created new record')
        }
      }
    }
  }

  log(`\nDone. ${matchCount} FSIS action(s) matched across ${companies.length} companies.`)
  if (skippedTranslations) log(`${skippedTranslations} Spanish-language duplicate record(s) skipped.`)
  if (rejectedCount) log(`${rejectedCount} rejected as false positives.`)
  log('Note: FSIS covers meat, poultry and processed egg products only. Zero matches is an expected result for a catalogue of mostly non-meat products, and does NOT mean those products have no recall history — FDA-regulated recalls are handled by ingest-fda-recalls.ts.')

  if (DRY_RUN) {
    log('DRY RUN — nothing written. Re-run with --live to commit.')
  } else {
    await prisma.ingestionLog.create({
      data: { source: 'fsis_recalls', recordsMatched: matchCount, fileName: 'FSIS Recall API (no file — live query)' },
    })
    log('Logged this run to IngestionLog.')
  }
}

main().catch((e) => logError(e)).finally(async () => {
  writeLogFile('ingest-fsis-recalls'); await prisma.$disconnect()
})

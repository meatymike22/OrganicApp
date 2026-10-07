// PROBE THE OPEN FOOD FACTS EXPORT FOR LABEL / CERTIFICATION FIELDS.
//
// Read-only. Touches no database, writes nothing, and is safe to interrupt.
//
// WHY THIS EXISTS. Rootify holds 40 organic certification rows and 18
// non-GMO rows across 416,382 products. That is not what the world looks
// like; it is what our ingestion collected. The USDA Organic Integrity
// Database can never fix it, because that register certifies OPERATIONS
// (farms, handlers) and not retail products — so no amount of better USDA
// matching produces a per-product organic fact.
//
// The source that can is the one we already have and threw away: Open Food
// Facts records the label claims transcribed off the package. OFF's own
// data-fields documentation lists `labels`, `labels_tags` and `labels_<lc>`.
//
// AND THAT IS EXACTLY WHY THIS SCRIPT EXISTS RATHER THAN A MIGRATION.
// In October 2026 the image backfill was built around `image_front_url`
// because the OFF *API* returns it. The API computes that field per request;
// the export does not contain it. A 7-minute run found zero photographs.
// An export and an API are different artifacts, and a field documented for
// one is not evidence about the other.
//
// So this script DISCOVERS the fields instead of assuming them: it reports
// every top-level key whose name looks label-ish, how often each is
// populated, and the most common values. If `labels_tags` is absent, the
// output says so plainly and names whatever is there instead.
//
// USAGE
//   npx tsx scripts/probe-off-labels.ts ./data/openfoodfacts-products.jsonl.gz
//   npx tsx scripts/probe-off-labels.ts ./data/...jsonl.gz --lines 500000
//   npx tsx scripts/probe-off-labels.ts ./data/...jsonl.gz --all
//
// Default is 200,000 lines, which takes well under a minute and is already
// conclusive about whether a field exists. --all counts the whole file.
//
// Writes logs/probe-off-labels-<timestamp>.txt as it goes, like every other
// script here. The first version of this file printed to stdout only, which
// meant the one person who could run it had to copy a terminal buffer back
// — and if they had closed it, the run was gone.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { StringDecoder } from 'node:string_decoder'

const args = process.argv.slice(2)
const FILE = args.find((a) => !a.startsWith('--'))
const ALL = args.includes('--all')
const LINES = ALL
  ? Infinity
  : Number(args[args.indexOf('--lines') + 1] ?? NaN) || 200_000

// Any top-level key that might carry a label, certification or claim. Kept
// deliberately wide — the point is to find what IS there, not to confirm a
// guess about what should be.
const INTERESTING = /label|certif|claim|organic|gmo|ecoscore|eco_score/i

// Tags we specifically care about, as OFF writes them. Counted separately so
// the report answers "how many organic products would this give us".
const ORGANIC_TAGS = /^(en:)?(organic|usda-organic|eu-organic|ab-agriculture-biologique|canada-organic|bio)$/i
const NONGMO_TAGS = /^(en:)?(non-gmo-project|non-gmo-project-verified|no-gmos|non-gmo)$/i

async function* readLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  // Pull-based so memory stays flat on a 7 GB gzip stream — same reason as
  // backfill-off-images.ts.
  const decoder = new StringDecoder('utf8')
  let carry = ''
  for await (const chunk of stream) {
    carry += decoder.write(chunk as Buffer)
    let nl = carry.indexOf('\n')
    while (nl !== -1) {
      yield carry.slice(0, nl)
      carry = carry.slice(nl + 1)
      nl = carry.indexOf('\n')
    }
  }
  carry += decoder.end()
  if (carry) yield carry
}

// --- LOGGING, same convention as every other script in scripts/: written as
// it goes, so an interrupted run still leaves a record of how far it got.
const LOG_FILE = path.join(
  './logs',
  `probe-off-labels-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
)
fs.mkdirSync('./logs', { recursive: true })

function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

function logError(...parts: unknown[]) {
  const line = parts
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')
  console.error(line)
  fs.appendFileSync(LOG_FILE, '[ERROR] ' + line + '\n')
}

function bump(m: Map<string, number>, k: string, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by)
}

function top(m: Map<string, number>, n: number): string {
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
  if (rows.length === 0) return '    (none)'
  return rows.map(([k, v]) => `    ${v.toLocaleString().padStart(10)}  ${k}`).join('\n')
}

async function main() {
  if (!FILE || !fs.existsSync(FILE)) {
    logError(`Export file not found: ${FILE ?? '(none given)'}`)
    logError('Pass the path to openfoodfacts-products.jsonl.gz (do not unzip it).')
    process.exitCode = 1
    return
  }

  log(`Probing ${FILE}${ALL ? ' (whole file)' : ` (first ${LINES.toLocaleString()} lines)`}\n`)

  let lines = 0
  let parsed = 0
  let withBarcode = 0
  const keyPresent = new Map<string, number>()   // key exists and is non-empty
  const keyEmpty = new Map<string, number>()     // key exists but is empty
  const labelTagValues = new Map<string, number>()
  const rawLabelsSamples: string[] = []
  let anyOrganic = 0
  let anyNonGmo = 0
  let organicWithBarcode = 0

  const started = Date.now()
  const input = fs.createReadStream(FILE).pipe(zlib.createGunzip())

  for await (const raw of readLines(input)) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    lines++
    if (line.trim()) {
      let rec: Record<string, unknown> | null = null
      try {
        rec = JSON.parse(line) as Record<string, unknown>
      } catch {
        /* a truncated line at a boundary is not worth failing over */
      }
      if (rec) {
        parsed++
        const code = typeof rec.code === 'string' ? rec.code : null
        if (code) withBarcode++

        for (const k of Object.keys(rec)) {
          if (!INTERESTING.test(k)) continue
          const v = rec[k]
          const empty =
            v == null ||
            (typeof v === 'string' && v.trim() === '') ||
            (Array.isArray(v) && v.length === 0)
          bump(empty ? keyEmpty : keyPresent, k)
        }

        // The tag array, whatever it turns out to be called.
        const tags = rec.labels_tags
        if (Array.isArray(tags)) {
          let org = false
          let ngm = false
          for (const t of tags) {
            if (typeof t !== 'string') continue
            bump(labelTagValues, t)
            if (ORGANIC_TAGS.test(t)) org = true
            if (NONGMO_TAGS.test(t)) ngm = true
          }
          if (org) {
            anyOrganic++
            if (code) organicWithBarcode++
          }
          if (ngm) anyNonGmo++
        }

        // Keep a few raw values so a surprise shape explains itself rather
        // than sending us back to guess at field names.
        if (rawLabelsSamples.length < 6 && typeof rec.labels === 'string' && rec.labels.trim()) {
          rawLabelsSamples.push(`${code ?? '(no code)'}  labels = ${JSON.stringify(rec.labels).slice(0, 220)}`)
        }
      }
    }
    if (lines % 250_000 === 0) {
      const mins = ((Date.now() - started) / 60000).toFixed(1)
      log(`  ...${lines.toLocaleString()} lines (${mins} min)`)
    }
    if (lines >= LINES) break
  }
  input.destroy()

  const mins = ((Date.now() - started) / 60000).toFixed(1)
  const pct = (n: number) => (parsed ? `${((n / parsed) * 100).toFixed(1)}%` : '—')

  log(`\n===== LABEL FIELD PROBE (${mins} min) =====`)
  log(`Lines read:        ${lines.toLocaleString()}`)
  log(`Records parsed:    ${parsed.toLocaleString()}`)
  log(`With a barcode:    ${withBarcode.toLocaleString()}`)

  log(`\nLabel-ish keys PRESENT and non-empty (this is the answer):`)
  log(top(keyPresent, 25))

  log(`\nLabel-ish keys present but EMPTY:`)
  log(top(keyEmpty, 15))

  if (!keyPresent.has('labels_tags') && !keyEmpty.has('labels_tags')) {
    log(`\n!! labels_tags DOES NOT EXIST in this export.`)
    log(`   Do not build the labels import until the list above is read.`)
    log(`   Whatever is listed as present is what we actually have.`)
  }

  log(`\nWhat an organic / non-GMO filter would be worth:`)
  log(`  products tagged organic:            ${anyOrganic.toLocaleString()}  (${pct(anyOrganic)})`)
  log(`    ...of those, with a barcode:      ${organicWithBarcode.toLocaleString()}`)
  log(`  products tagged non-GMO:            ${anyNonGmo.toLocaleString()}  (${pct(anyNonGmo)})`)
  log(`  (a barcode is required to match one of our products)`)

  log(`\nMost common label tags:`)
  log(top(labelTagValues, 40))

  if (rawLabelsSamples.length > 0) {
    log(`\nRaw \`labels\` from a few records:`)
    for (const s of rawLabelsSamples) log(`    ${s}`)
  }

  log(
    `\nNOTE: a label tag is a CLAIM TRANSCRIBED FROM THE PACKAGE by an Open Food`
  )
  log(`Facts contributor. It is not a certification record and nobody audited it.`)
  log(`It belongs in its own column with its own wording ("the label says organic"),`)
  log(`never merged into the USDA certification rows.`)
}

main()
  .then(() => {
    log(`\nLog written to ${LOG_FILE}`)
  })
  .catch((e) => {
    logError(e)
    logError(`Log written to ${LOG_FILE}`)
    process.exitCode = 1
  })

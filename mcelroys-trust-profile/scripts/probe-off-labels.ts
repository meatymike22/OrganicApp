// PROBE THE OPEN FOOD FACTS EXPORT FOR EVERY FIELD PHASE 1 NEEDS.
//
// STILL CALLED probe-off-labels.ts, and widened 2026-10-13 rather than
// renamed, because five documents cite it by name and a stale reference in a
// plan is worse than an imperfect filename. It began as a labels probe; it is
// now the probe for the whole export pass.
//
// WHY ONE PROBE AND NOT NINE. Nine separate backlog items read this same
// file: the label claims, the allergen statement, the additive numbers, the
// raw ingredient text, the ingredient language, the nested-parenthesis
// parse, the comma-split repair, the image dimensions and the image
// three-state re-run. Each was logged in a different review round, so they
// look like nine jobs. The 7 GB read is the expensive part, not the parsing,
// and discovering on job seven that a field is absent would mean redoing the
// six before it.
//
// So this answers, in one run, whether each of those is buildable.
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
// every top-level key whose name looks relevant, how often each is
// populated, and the most common values. If a field is absent, the output
// says so plainly and names whatever is there instead.
//
// WHAT EACH SECTION OF THE REPORT DECIDES
//   labels        -> item 18. Organic / non-GMO / gluten-free as claimed.
//   additives     -> the INS / E-number work. If `additives_tags` is here,
//                    the hand-maintained keyword classifier can be deleted
//                    rather than extended, which is the difference between
//                    a fix and an architecture.
//   allergens     -> item 22, the highest-value item on the list for a
//                    reader who needs it to be right. The label's own
//                    "Contains:" line, not our reading of an ingredient list.
//   ingredients   -> items 33, 36, 39 and 40. Whether we can store the raw
//                    text, tell which language it is in, and reparse the
//                    nesting instead of flattening it.
//
// NOTHING HERE WRITES. Read-only, no database, safe to interrupt.
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
const INTERESTING =
  /label|certif|claim|organic|gmo|ecoscore|eco_score|additive|allergen|trace|ingredient|^lang|^lc$/i

// Tags we specifically care about, as OFF writes them. Counted separately so
// the report answers "how many organic products would this give us".
const ORGANIC_TAGS = /^(en:)?(organic|usda-organic|eu-organic|ab-agriculture-biologique|canada-organic|bio)$/i
const NONGMO_TAGS = /^(en:)?(non-gmo-project|non-gmo-project-verified|no-gmos|non-gmo)$/i
const GLUTENFREE_TAGS = /^(en:)?(gluten-free|no-gluten|sans-gluten)$/i

// An INS / E-number tag as OFF writes it: "en:e322", sometimes with a letter
// suffix ("en:e160a"). Counted so the report says how many products would
// gain a standards-based additive identity, which is the whole question.
const ENUMBER_TAG = /^en:e(\d{3,4})([a-z]{0,2})$/i

// The nine US major allergens, as the tags OFF uses. Sesame was added by
// the FASTER Act in 2021 and is in the list for that reason.
const MAJOR_ALLERGENS = new Set([
  'en:milk', 'en:eggs', 'en:fish', 'en:crustaceans', 'en:tree-nuts',
  'en:peanuts', 'en:soybeans', 'en:gluten', 'en:sesame-seeds',
])

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
  let anyGlutenFree = 0
  let organicWithBarcode = 0

  // --- additives: the INS / E-number question
  const additiveTagValues = new Map<string, number>()
  let withAdditives = 0
  let withAdditivesAndBarcode = 0
  let additiveTagsTotal = 0
  const enumberShapes = new Map<string, number>()
  const additiveSamples: string[] = []

  // --- allergens: the label's own "Contains:" statement
  const allergenTagValues = new Map<string, number>()
  const traceTagValues = new Map<string, number>()
  let withAllergens = 0
  let withAllergensAndBarcode = 0
  let withTraces = 0
  let withMajorAllergen = 0

  // --- ingredients: text, language, nesting
  const langValues = new Map<string, number>()
  const ingTextKeys = new Map<string, number>()
  let withIngText = 0
  let withIngTextEn = 0
  // The case that produced the Norwegian Snickers: there IS ingredient text,
  // but not in English, so our importer stored Norwegian ingredient rows.
  let ingTextButNoEnglish = 0
  let ingTextWithParens = 0
  let ingTextWithNestedParens = 0
  // OFF sometimes carries a PARSED ingredient tree. If it does, item 39 is
  // not a parser we have to write.
  let withStructuredIngredients = 0
  let structuredWithChildren = 0
  const structuredSample: string[] = []
  const nonEnglishSamples: string[] = []

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
          let glf = false
          for (const t of tags) {
            if (typeof t !== 'string') continue
            bump(labelTagValues, t)
            if (ORGANIC_TAGS.test(t)) org = true
            if (NONGMO_TAGS.test(t)) ngm = true
            if (GLUTENFREE_TAGS.test(t)) glf = true
          }
          if (org) {
            anyOrganic++
            if (code) organicWithBarcode++
          }
          if (ngm) anyNonGmo++
          // Counted, and NOT a gluten-free filter on its own. A transcribed
          // "gluten free" on a package is a claim; the audited certifications
          // (GFCO, CSA) are a different grade of record, and our wheat filter
          // is not a gluten filter at all — barley and rye are not in it and
          // no ingredient list can see cross-contamination. See item 31.
          if (glf) anyGlutenFree++
        }

        // Keep a few raw values so a surprise shape explains itself rather
        // than sending us back to guess at field names.
        if (rawLabelsSamples.length < 6 && typeof rec.labels === 'string' && rec.labels.trim()) {
          rawLabelsSamples.push(`${code ?? '(no code)'}  labels = ${JSON.stringify(rec.labels).slice(0, 220)}`)
        }

        // ---------------------------------------------------- additives
        const addTags = rec.additives_tags
        if (Array.isArray(addTags) && addTags.length > 0) {
          withAdditives++
          if (code) withAdditivesAndBarcode++
          for (const t of addTags) {
            if (typeof t !== 'string') continue
            additiveTagsTotal++
            bump(additiveTagValues, t)
            const m = ENUMBER_TAG.exec(t)
            // Counted by SHAPE as well as by value: whether these are
            // e-numbers at all is the thing being tested, and a tag like
            // "en:flavouring" would pass the array check and fail the format.
            bump(enumberShapes, m ? `e-number (${m[1].length} digits${m[2] ? ' + letter' : ''})` : 'NOT an e-number')
          }
          if (additiveSamples.length < 6) {
            additiveSamples.push(`${code ?? '(no code)'}  ${JSON.stringify(addTags).slice(0, 220)}`)
          }
        }

        // ---------------------------------------------------- allergens
        const algTags = rec.allergens_tags
        if (Array.isArray(algTags) && algTags.length > 0) {
          withAllergens++
          if (code) withAllergensAndBarcode++
          let major = false
          for (const t of algTags) {
            if (typeof t !== 'string') continue
            bump(allergenTagValues, t)
            if (MAJOR_ALLERGENS.has(t.toLowerCase())) major = true
          }
          if (major) withMajorAllergen++
        }
        const trcTags = rec.traces_tags
        if (Array.isArray(trcTags) && trcTags.length > 0) {
          withTraces++
          for (const t of trcTags) if (typeof t === 'string') bump(traceTagValues, t)
        }

        // -------------------------------------------------- ingredients
        if (typeof rec.lang === 'string' && rec.lang.trim()) bump(langValues, rec.lang.trim())

        // Every ingredients_text* key this record has, so the per-language
        // suffixes show up by name instead of being guessed at.
        for (const k of Object.keys(rec)) {
          if (!k.startsWith('ingredients_text')) continue
          const v = rec[k]
          if (typeof v === 'string' && v.trim()) bump(ingTextKeys, k)
        }

        const ingText = typeof rec.ingredients_text === 'string' ? rec.ingredients_text.trim() : ''
        const ingTextEn =
          typeof rec.ingredients_text_en === 'string' ? rec.ingredients_text_en.trim() : ''
        if (ingText) {
          withIngText++
          if (ingText.includes('(')) ingTextWithParens++
          // A second '(' before the first ')' closes means a nested list,
          // which is the MILK CHOCOLATE (SUGAR, ...) shape our importer
          // flattened. Cheap test, and only needs to be indicative.
          const close = ingText.indexOf(')')
          const second = ingText.indexOf('(', ingText.indexOf('(') + 1)
          if (second !== -1 && close !== -1 && second < close) ingTextWithNestedParens++
        }
        if (ingTextEn) withIngTextEn++
        if (ingText && !ingTextEn) {
          ingTextButNoEnglish++
          if (nonEnglishSamples.length < 8 && typeof rec.lang === 'string' && rec.lang !== 'en') {
            nonEnglishSamples.push(
              `${code ?? '(no code)'}  lang=${rec.lang}  ${JSON.stringify(ingText).slice(0, 160)}`
            )
          }
        }

        // The parsed tree, if OFF ships one.
        const structured = rec.ingredients
        if (Array.isArray(structured) && structured.length > 0) {
          withStructuredIngredients++
          const nested = structured.some(
            (x) =>
              typeof x === 'object' &&
              x !== null &&
              Array.isArray((x as { ingredients?: unknown }).ingredients)
          )
          if (nested) {
            structuredWithChildren++
            if (structuredSample.length < 3) {
              structuredSample.push(`${code ?? '(no code)'}  ${JSON.stringify(structured).slice(0, 400)}`)
            }
          }
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

  log(`\nWhat an organic / non-GMO / gluten-free filter would be worth:`)
  log(`  products tagged organic:            ${anyOrganic.toLocaleString()}  (${pct(anyOrganic)})`)
  log(`    ...of those, with a barcode:      ${organicWithBarcode.toLocaleString()}`)
  log(`  products tagged non-GMO:            ${anyNonGmo.toLocaleString()}  (${pct(anyNonGmo)})`)
  log(`  products tagged gluten-free:        ${anyGlutenFree.toLocaleString()}  (${pct(anyGlutenFree)})`)
  log(`  (a barcode is required to match one of our products)`)
  log(`  Today we hold 40 organic rows and 18 non-GMO rows across 416,382 products.`)

  log(`\nMost common label tags:`)
  log(top(labelTagValues, 40))

  if (rawLabelsSamples.length > 0) {
    log(`\nRaw \`labels\` from a few records:`)
    for (const s of rawLabelsSamples) log(`    ${s}`)
  }

  // ============================================= ADDITIVES (INS / E-numbers)
  log(`\n===== ADDITIVES: can the keyword classifier be deleted? =====`)
  log(`  products with additives_tags:       ${withAdditives.toLocaleString()}  (${pct(withAdditives)})`)
  log(`    ...of those, with a barcode:      ${withAdditivesAndBarcode.toLocaleString()}`)
  log(`  additive tags seen in total:        ${additiveTagsTotal.toLocaleString()}`)
  log(`  distinct additive tags:             ${additiveTagValues.size.toLocaleString()}`)
  log(`\n  Tag SHAPES (this is the test \u2014 an array is not an e-number):`)
  log(top(enumberShapes, 10))
  log(`\n  Most common additive tags:`)
  log(top(additiveTagValues, 30))
  if (additiveSamples.length) {
    log(`\n  Raw additives_tags from a few records:`)
    for (const x of additiveSamples) log(`    ${x}`)
  }
  if (withAdditives === 0) {
    log(`\n  !! additives_tags is ABSENT or always empty in this export.`)
    log(`     The keyword classifier in ingredientClassification.ts stays, and`)
    log(`     the INS work needs a different source (Codex CXG 36 directly).`)
  } else {
    log(`\n  Each e-number maps to one additive AND one Codex functional class,`)
    log(`  which is the standards-based replacement for CLASSIFICATION_RULES.`)
    log(`  That list is keyword-matched by hand: it is why palm kernel oil sat`)
    log(`  uncategorised on 5,488 products and why 355 hydrogenated names still do.`)
  }

  // ======================================================== ALLERGENS
  log(`\n===== ALLERGENS: the label's own "Contains:" line =====`)
  log(`  products with allergens_tags:       ${withAllergens.toLocaleString()}  (${pct(withAllergens)})`)
  log(`    ...of those, with a barcode:      ${withAllergensAndBarcode.toLocaleString()}`)
  log(`  ...naming a US major allergen:      ${withMajorAllergen.toLocaleString()}`)
  log(`  products with traces_tags:          ${withTraces.toLocaleString()}  (${pct(withTraces)})`)
  log(`\n  Most common allergen tags:`)
  log(top(allergenTagValues, 20))
  log(`\n  Most common traces tags ("may contain"):`)
  log(top(traceTagValues, 15))
  log(`\n  TODAY our allergen filter is DERIVED from ingredient names by`)
  log(`  src/lib/allergens.ts. That derivation inverts the house exclusion rule`)
  log(`  on purpose \u2014 unknown counts as present \u2014 but inverting a derivation is`)
  log(`  not the same as holding the record. traces_tags is the cross-contact`)
  log(`  warning, which we hold none of and cannot derive at all.`)

  // ====================================================== INGREDIENTS
  log(`\n===== INGREDIENTS: text, language and nesting =====`)
  log(`  with ingredients_text:              ${withIngText.toLocaleString()}  (${pct(withIngText)})`)
  log(`  with ingredients_text_en:           ${withIngTextEn.toLocaleString()}  (${pct(withIngTextEn)})`)
  log(`  text but NO English text:           ${ingTextButNoEnglish.toLocaleString()}  (${pct(ingTextButNoEnglish)})`)
  log(`      ^ this is the Norwegian-Snickers number: where our importer`)
  log(`        stored foreign-language ingredient rows that join to nothing.`)
  log(`  text containing "(":                ${ingTextWithParens.toLocaleString()}`)
  log(`  text with a NESTED "(":             ${ingTextWithNestedParens.toLocaleString()}`)
  log(`      ^ the MILK CHOCOLATE (SUGAR, ...) shape we flatten today, which`)
  log(`        is why \`coloring\` is an ingredient on 803 products.`)
  log(`\n  Every ingredients_text* key found, by name:`)
  log(top(ingTextKeys, 25))
  log(`\n  Record language (lang):`)
  log(top(langValues, 15))
  log(`\n  with a PARSED ingredients array:    ${withStructuredIngredients.toLocaleString()}  (${pct(withStructuredIngredients)})`)
  log(`    ...of those, with nested children: ${structuredWithChildren.toLocaleString()}`)
  if (structuredWithChildren > 0) {
    log(`\n  !! OFF SHIPS THE TREE. If this number is large, item 39 is not a`)
    log(`     parser we have to write \u2014 the nesting is already structured, and`)
    log(`     the job becomes storing a parent link rather than guessing at`)
    log(`     brackets. Read these samples before writing any parser:`)
    for (const x of structuredSample) log(`    ${x}`)
  }
  if (nonEnglishSamples.length) {
    log(`\n  Records with non-English ingredient text and no English field:`)
    for (const x of nonEnglishSamples) log(`    ${x}`)
  }

  log(
    `\nNOTE: a label tag is a CLAIM TRANSCRIBED FROM THE PACKAGE by an Open Food`
  )
  log(`Facts contributor. It is not a certification record and nobody audited it.`)
  log(`It belongs in its own column with its own wording ("the label says organic"),`)
  log(`never merged into the USDA certification rows. The same applies to every`)
  log(`field above: each needs its own column, its own source and its own date,`)
  log(`in the three-state shape, so "we looked and the label claims nothing"`)
  log(`never collapses into "nobody has looked". That collapse is the mistake`)
  log(`item 27 already made, and 34,624 products are still wearing it.`)
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

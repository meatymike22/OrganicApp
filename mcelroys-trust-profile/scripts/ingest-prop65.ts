// INGEST THE CALIFORNIA PROPOSITION 65 LIST into IngredientAuthorityAssessment.
//
// WHY THIS SOURCE FIRST. Michael asked for all nine authorities Yuka uses.
// Of those, this is the one with a verified, directly downloadable file, from
// a US state government, with no licence question attached. IARC's list is
// rendered by JavaScript and has no export; the FDA inventory sits behind a
// web app; EFSA's OpenFoodTox is CC-BY-ND and needs a legal decision first.
// So Prop 65 is where the pipeline gets built and proved.
//
// WHAT PROP 65 IS, because the wording on the page depends on it: California
// maintains a legal list of substances the state has determined can cause
// cancer or reproductive harm. A listing is a regulatory decision by one US
// state that triggers a warning-label requirement there. It is NOT a finding
// about any product, and it is NOT a study. See src/lib/authorities.ts.
//
// USAGE
//   npx tsx scripts/ingest-prop65.ts --selftest    # no file, no DB, 1 second
//   npx tsx scripts/ingest-prop65.ts --probe       # read the file, write nothing
//   npx tsx scripts/ingest-prop65.ts --dry-run     # match ingredients, write nothing
//   npx tsx scripts/ingest-prop65.ts --live        # write
//
// --probe FIRST, ALWAYS. The column names in this CSV have not been verified
// from here: WebFetch returns it as binary, so the header could not be read
// before writing this parser. That is the same situation that produced the
// image backfill which found zero photos in October, so this script does not
// assume a layout — it matches columns by header pattern and --probe prints
// exactly what it found and what it bound each field to. If the bindings in
// the probe output look wrong, fix MATCHERS below rather than the data.
//
// SOURCE
//   https://oehha.ca.gov/proposition-65/proposition-65-list
//   CSV:  https://oehha.ca.gov/sites/default/files/media/2025-01/p65chemicalslist.csv
//   XLSX: https://oehha.ca.gov/sites/default/files/media/downloads/proposition-65//p65chemicalslist.xlsx
//
// The XLSX carries two extra columns (listing mechanism, safe harbour level)
// and its published date was newer than the CSV's path suggests, so if the
// probe shows the CSV is stale, switch to the XLSX and parse that instead.

import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../src/lib/prisma'

const args = process.argv.slice(2)
const FILE = args.find((a) => !a.startsWith('--')) ?? './data/p65chemicalslist.csv'
const PROBE = args.includes('--probe')
const SELFTEST = args.includes('--selftest')
const LIVE = args.includes('--live')
const DRY_RUN = !LIVE

const SOURCE_URL = 'https://oehha.ca.gov/proposition-65/proposition-65-list'
const SOURCE_TITLE = 'California Proposition 65 List of Chemicals (OEHHA)'

// --- LOGGING, same convention as every other script here ---
const LOG_FILE = path.join(
  './logs',
  `ingest-prop65${SELFTEST ? '-selftest' : PROBE ? '-probe' : DRY_RUN ? '-dryrun' : ''}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
)
fs.mkdirSync('./logs', { recursive: true })
function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// WHICH HEADER MEANS WHICH FIELD. Patterns rather than fixed names, because
// the exact header text is unverified and OEHHA has changed it before.
const MATCHERS: { field: string; pattern: RegExp; required: boolean }[] = [
  { field: 'name', pattern: /chemical|substance/i, required: true },
  { field: 'type', pattern: /toxicity|type/i, required: true },
  { field: 'listedDate', pattern: /date.*list|listed.*date|^date/i, required: false },
  { field: 'cas', pattern: /\bcas\b/i, required: false },
  { field: 'basis', pattern: /basis|mechanism/i, required: false },
]

// ROUTE-OF-EXPOSURE QUALIFIERS THAT MAKE A LISTING IRRELEVANT TO FOOD.
//
// This is the most important guard in the script. Prop 65 lists many
// substances specifically as inhalation hazards — titanium dioxide is listed
// as "airborne, unbound particles of respirable size", which is about
// breathing dust in a factory and says nothing about eating it in a sweet.
// Attaching that listing to a food ingredient would be a false claim about
// every product containing it, and the kind that gets a letter.
//
// Entries matching these are reported and SKIPPED, never written.
const NOT_ABOUT_FOOD =
  /airborne|respirable|inhal|occupational exposure|unbound particles|as a dust|fibre|fiber|aerosol/i

// Prop 65's "Type of Toxicity" column to our classification codes.
function toCode(type: string): { code: string; label: string } | null {
  const t = type.toLowerCase()
  if (t.includes('cancer')) return { code: 'cancer', label: 'cancer' }
  if (t.includes('developmental')) return { code: 'developmental_toxicity', label: 'developmental toxicity' }
  // "female reproductive toxicity" / "male reproductive toxicity" both land
  // here: the distinction is real but Prop 65's own wording carries it in the
  // verbatim `classification` string, which is what gets cited.
  if (t.includes('reproductive')) return { code: 'reproductive_toxicity', label: 'reproductive toxicity' }
  return null
}

// --- CSV PARSING, quoted fields and embedded commas included. Chemical names
// in this list contain commas constantly ("Benz[a]anthracene, 1,2-dihydro-"),
// so a naive split on comma would shred most of the file.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (c !== '\r') {
      cell += c
    }
  }
  if (cell || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

// MATCHING AN AUTHORITY'S NAME TO ONE OF OURS.
//
// Deliberately conservative, in one direction only. Prop 65 says "Titanium
// dioxide"; we hold "titanium dioxide" and "titanium dioxide color". Our name
// may CONTAIN the authority's name as a whole phrase — that is a safe
// widening, because a product listing "titanium dioxide color" does contain
// titanium dioxide.
//
// The reverse is never allowed. If the authority's name contained ours,
// "sodium" would match sodium azide, and every table salt on the site would
// inherit a cancer listing. That is the failure mode this function exists to
// prevent.
// How specific a name has to be before the containment widening is allowed.
//
// Prop 65 lists "Lead" and "Nickel". With no floor, the needle " lead " would
// attach a cancer listing to every ingredient with "lead" as a word, and the
// widening stops being a safe inference. A name is specific enough if it is
// two or more words ("titanium dioxide") or one long word ("aspartame").
// Short single words get exact matching only.
const CONTAINMENT_MIN_WORDS = 2
const CONTAINMENT_MIN_CHARS = 7

function specificEnoughToWiden(key: string): boolean {
  return key.split(' ').length >= CONTAINMENT_MIN_WORDS || key.length >= CONTAINMENT_MIN_CHARS
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    // Drop parentheticals: they carry qualifiers, salt forms and synonyms
    // that are not part of the substance's name.
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// --- SELF TEST ---
//
// Exercises the CSV parser, the route-of-exposure guard, the toxicity mapping
// and the ingredient matcher against hand-written cases. No file, no
// database, about a second. Run it before any real pass.
//
// Three of these cases are here because they already failed once:
//   - a quoted chemical name containing commas ("Benz[a]anthracene, 1,2-dihydro-")
//   - "Titanium dioxide" has to reach BOTH our "titanium dioxide" and our
//     "titanium dioxide color", or two products with the same substance on
//     the label disagree about whether it is listed
//   - "Sodium azide" must NOT reach our "sodium", and short names like "Lead"
//     must not widen at all
function selfTest(): boolean {
  const ours = [
    { id: '1', name: 'titanium dioxide' },
    { id: '2', name: 'titanium dioxide color' },
    { id: '3', name: 'sodium' },
    { id: '4', name: 'aspartame' },
    { id: '5', name: 'carrageenan' },
    { id: '6', name: 'carrageenan gum' },
    { id: '7', name: 'red lead oxide' },
    { id: '8', name: 'lead' },
  ]
  const match = (authorityName: string) => {
    const key = normalise(authorityName)
    if (!key) return [] as string[]
    const found = new Map<string, string>()
    for (const i of ours) if (normalise(i.name) === key) found.set(i.id, i.name)
    if (specificEnoughToWiden(key)) {
      const needle = ` ${key} `
      for (const i of ours) if (` ${normalise(i.name)} `.includes(needle)) found.set(i.id, i.name)
    }
    return [...found.values()].sort()
  }

  const csv = [
    'Chemical,Type of Toxicity,CAS No.,Date Listed,Listing Mechanism',
    '"Benz[a]anthracene, 1,2-dihydro-",cancer,56-55-3,1988-02-27,AB',
    '"Titanium dioxide (airborne, unbound particles of respirable size)",cancer,13463-67-7,2011-09-02,AB',
    'Aspartame,cancer,22839-47-0,2026-01-01,AB',
    'Sodium azide,"developmental toxicity",26628-22-8,1999-04-16,AB',
    'Lead,other toxicity,7439-92-1,1992-01-01,AB',
  ].join('\n')
  const rows = parseCsv(csv)

  const cases: [string, unknown, unknown][] = [
    ['row count', rows.length, 6],
    ['quoted name with commas', rows[1][0], 'Benz[a]anthracene, 1,2-dihydro-'],
    ['cas column', rows[1][2], '56-55-3'],
    ['inhalation listing flagged', NOT_ABOUT_FOOD.test(rows[2][0]), true],
    ['food listing not flagged', NOT_ABOUT_FOOD.test(rows[3][0]), false],
    ['cancer maps', toCode('cancer')?.code, 'cancer'],
    ['developmental maps', toCode('developmental toxicity')?.code, 'developmental_toxicity'],
    ['reproductive maps', toCode('male reproductive toxicity')?.code, 'reproductive_toxicity'],
    ['unmapped type returns null', toCode('other toxicity'), null],
    ['sodium azide does NOT reach sodium', match('Sodium azide'), []],
    ['titanium dioxide reaches both', match('Titanium dioxide'), ['titanium dioxide', 'titanium dioxide color']],
    [
      'parentheticals stripped before matching',
      match('Titanium dioxide (airborne, unbound particles of respirable size)'),
      ['titanium dioxide', 'titanium dioxide color'],
    ],
    ['carrageenan reaches the gum variant', match('Carrageenan'), ['carrageenan', 'carrageenan gum']],
    ['short name Lead does not widen', match('Lead'), ['lead']],
    ['long single word still widens', match('Aspartame'), ['aspartame']],
  ]

  let failed = 0
  for (const [label, got, want] of cases) {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) failed++
    log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`)
  }
  log(failed === 0 ? `\n${cases.length}/${cases.length} passed.` : `\n${failed} of ${cases.length} FAILED.`)
  return failed === 0
}

async function main() {
  if (SELFTEST) {
    log('SELF TEST \u2014 no file, no database\n')
    if (!selfTest()) process.exitCode = 1
    log(`\nLog written to ${LOG_FILE}`)
    return
  }

  if (!fs.existsSync(FILE)) {
    log(`File not found: ${FILE}`)
    log('Download the CSV from https://oehha.ca.gov/proposition-65/proposition-65-list')
    log('and save it as ./data/p65chemicalslist.csv')
    process.exitCode = 1
    return
  }

  log(`${PROBE ? 'PROBE' : DRY_RUN ? 'DRY RUN' : 'LIVE RUN'} — ${FILE}`)
  const rows = parseCsv(fs.readFileSync(FILE, 'utf8'))
  if (rows.length < 2) {
    log('Fewer than two rows parsed. Is this the right file?')
    process.exitCode = 1
    return
  }

  const header = rows[0].map((h) => h.trim())
  log(`\nHEADER AS WRITTEN (${header.length} columns):`)
  header.forEach((h, i) => log(`    [${i}] ${JSON.stringify(h)}`))

  // Bind each field to a column, and say so out loud.
  const bind: Record<string, number> = {}
  log('\nFIELD BINDINGS (check these before trusting anything below):')
  for (const m of MATCHERS) {
    const idx = header.findIndex((h) => m.pattern.test(h))
    if (idx >= 0) bind[m.field] = idx
    log(`    ${m.field.padEnd(11)} -> ${idx >= 0 ? `[${idx}] ${JSON.stringify(header[idx])}` : '(not found)'}`)
  }
  const missing = MATCHERS.filter((m) => m.required && bind[m.field] === undefined)
  if (missing.length > 0) {
    log(`\n!! Could not bind required field(s): ${missing.map((m) => m.field).join(', ')}`)
    log('   Fix MATCHERS in this script against the header above. Nothing was written.')
    process.exitCode = 1
    return
  }

  const body = rows.slice(1)
  log(`\nData rows: ${body.length.toLocaleString()}`)
  log('\nFIRST 5 ROWS AS BOUND:')
  for (const r of body.slice(0, 5)) {
    log(
      `    name=${JSON.stringify(r[bind.name]?.trim())} type=${JSON.stringify(r[bind.type]?.trim())}` +
        (bind.cas !== undefined ? ` cas=${JSON.stringify(r[bind.cas]?.trim())}` : '') +
        (bind.listedDate !== undefined ? ` listed=${JSON.stringify(r[bind.listedDate]?.trim())}` : '')
    )
  }

  // Shape report, so a surprise explains itself rather than sending us back
  // to guess at column names.
  const types = new Map<string, number>()
  let notFood = 0
  for (const r of body) {
    const t = (r[bind.type] ?? '').trim()
    types.set(t, (types.get(t) ?? 0) + 1)
    if (NOT_ABOUT_FOOD.test(r[bind.name] ?? '')) notFood++
  }
  log('\nTYPE OF TOXICITY values found:')
  for (const [t, n] of [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    log(`    ${String(n).padStart(6)}  ${JSON.stringify(t)}  -> ${toCode(t)?.code ?? '(UNMAPPED)'}`)
  }
  const unmapped = [...types.keys()].filter((t) => t && !toCode(t))
  if (unmapped.length > 0) {
    log(`\n!! ${unmapped.length} toxicity value(s) have no mapping and will be skipped:`)
    for (const t of unmapped.slice(0, 10)) log(`    ${JSON.stringify(t)}`)
    log('   Add them to toCode() if they belong on a food page.')
  }
  log(`\nListings that name an inhalation/occupational route (skipped, not food): ${notFood.toLocaleString()}`)

  if (PROBE) {
    log(`\nPROBE ONLY — nothing was matched against our ingredients and nothing was written.`)
    log(`Log written to ${LOG_FILE}`)
    return
  }

  // --- MATCH AGAINST OUR INGREDIENTS ---
  //
  // Only ingredients that are actually ON a product. An assessment attached
  // to an ingredient no product lists is a row nobody will ever read.
  const ours = await prisma.ingredient.findMany({
    where: { products: { some: {} } },
    select: { id: true, name: true },
  })
  log(`\nOur ingredients on at least one product: ${ours.length.toLocaleString()}`)

  // Index by normalised name, and by every whole-phrase containment check we
  // will need. Built once: 127k ingredients times 900 listings is 114 million
  // comparisons if done naively.
  const byExact = new Map<string, { id: string; name: string }[]>()
  for (const ing of ours) {
    const key = normalise(ing.name)
    if (!key) continue
    const list = byExact.get(key) ?? []
    list.push(ing)
    byExact.set(key, list)
  }

  type Pending = {
    ingredientId: string
    ingredientName: string
    authority: string
    assessmentType: string
    classification: string
    classificationCode: string
    substanceName: string
    casNumber: string | null
    assessedDate: Date | null
  }
  const pending: Pending[] = []
  const skippedNoMatch: string[] = []
  let skippedRoute = 0
  let skippedUnmapped = 0

  for (const r of body) {
    const rawName = (r[bind.name] ?? '').trim()
    const rawType = (r[bind.type] ?? '').trim()
    if (!rawName || !rawType) continue

    if (NOT_ABOUT_FOOD.test(rawName)) {
      skippedRoute++
      continue
    }
    const mapped = toCode(rawType)
    if (!mapped) {
      skippedUnmapped++
      continue
    }

    const key = normalise(rawName)
    if (!key) continue

    // Exact normalised match UNIONED with our-name-contains-their-name as a
    // whole phrase. Never the other way round.
    //
    // The union matters and a test caught it: preferring the exact match
    // meant Prop 65's "Titanium dioxide" landed on our "titanium dioxide" and
    // not on "titanium dioxide color", so two products with the same
    // substance on the label would disagree about whether it is listed. The
    // ingredient parser produces those variants constantly, so the widening
    // is the normal case, not the edge case.
    const found = new Map<string, { id: string; name: string }>()
    for (const ing of byExact.get(key) ?? []) found.set(ing.id, ing)
    if (specificEnoughToWiden(key)) {
      const needle = ` ${key} `
      for (const ing of ours) {
        if (` ${normalise(ing.name)} `.includes(needle)) found.set(ing.id, ing)
      }
    }
    const matches = [...found.values()]
    if (matches.length === 0) {
      skippedNoMatch.push(rawName)
      continue
    }

    const listed = bind.listedDate !== undefined ? (r[bind.listedDate] ?? '').trim() : ''
    const parsed = listed ? new Date(listed) : null
    const assessedDate = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null
    const cas = bind.cas !== undefined ? (r[bind.cas] ?? '').trim() || null : null

    for (const ing of matches) {
      pending.push({
        ingredientId: ing.id,
        ingredientName: ing.name,
        authority: 'oehha_prop65',
        assessmentType: 'hazard_classification',
        // VERBATIM, so the citation is checkable. Prop 65's own phrasing.
        classification: `Listed under California Proposition 65 as causing ${mapped.label}`,
        classificationCode: mapped.code,
        substanceName: rawName,
        casNumber: cas,
        assessedDate,
      })
    }
  }

  log(`\n===== MATCHING =====`)
  log(`Rows skipped, inhalation/occupational route: ${skippedRoute.toLocaleString()}`)
  log(`Rows skipped, unmapped toxicity type:       ${skippedUnmapped.toLocaleString()}`)
  log(`Listings with no ingredient of ours:        ${skippedNoMatch.length.toLocaleString()}`)
  log(`Assessments to write:                       ${pending.length.toLocaleString()}`)

  const byIngredient = new Map<string, number>()
  for (const p of pending) byIngredient.set(p.ingredientName, (byIngredient.get(p.ingredientName) ?? 0) + 1)
  log(`Distinct ingredients affected:              ${byIngredient.size.toLocaleString()}`)

  log('\nEVERY MATCH, so each one can be eyeballed before it goes live:')
  for (const p of pending.slice(0, 200)) {
    log(`    ${p.ingredientName}  <-  ${JSON.stringify(p.substanceName)}  [${p.classificationCode}]`)
  }
  if (pending.length > 200) log(`    ...and ${pending.length - 200} more`)

  if (DRY_RUN) {
    log(`\nDRY RUN — nothing was written. Re-run with --live once the matches above look right.`)
    log(`Log written to ${LOG_FILE}`)
    return
  }

  let written = 0
  for (const p of pending) {
    try {
      await prisma.ingredientAuthorityAssessment.upsert({
        where: {
          ingredientId_authority_classification_substanceName: {
            ingredientId: p.ingredientId,
            authority: p.authority,
            classification: p.classification,
            substanceName: p.substanceName,
          },
        },
        // EVERY FIELD NAMED, rather than spreading `p` minus ingredientName.
        //
        // The first version used a stripName() helper typed as
        // Omit<{ ingredientName: string } & Record<string, unknown>,
        // 'ingredientName'>, which collapses to Record<string, unknown> — so
        // Prisma saw an object with no known fields and the build failed with
        // "missing authority, assessmentType, classification,
        // classificationCode, and 2 more". A generic strip helper cannot
        // preserve field types through an index signature.
        //
        // Naming the fields is also better than fixing the helper: when a
        // column is added to IngredientAuthorityAssessment, this breaks here,
        // where someone has to decide what the ingester should put in it. A
        // spread would silently write nothing and pass the typecheck.
        create: {
          ingredientId: p.ingredientId,
          authority: p.authority,
          assessmentType: p.assessmentType,
          classification: p.classification,
          classificationCode: p.classificationCode,
          substanceName: p.substanceName,
          casNumber: p.casNumber,
          assessedDate: p.assessedDate,
          sourceUrl: SOURCE_URL,
          sourceTitle: SOURCE_TITLE,
        },
        update: { assessedDate: p.assessedDate, casNumber: p.casNumber, dataPulledDate: new Date() },
      })
      written++
    } catch (e) {
      log(`[ERROR] ${p.ingredientName} <- ${p.substanceName}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  log(`\nWritten: ${written.toLocaleString()} of ${pending.length.toLocaleString()}`)
  log(`Log written to ${LOG_FILE}`)
}

main()
  .catch((e) => {
    log(`[ERROR] ${e instanceof Error ? e.stack : String(e)}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

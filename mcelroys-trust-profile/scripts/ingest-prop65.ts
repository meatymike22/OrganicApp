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
// DATABASE CONNECTION — the house pattern for every script in this folder.
//
// Prisma 7 needs an explicit Postgres driver adapter; a bare
// `new PrismaClient()` throws "PrismaClient was instantiated without any
// options. A driver adapter is required to connect to your database."
//
// And `import 'dotenv/config'` is NOT optional. A standalone tsx script does
// not load .env by itself, so without it `process.env.DATABASE_URL` is
// undefined and the adapter is built with no connection string. This is also
// why no script here imports `src/lib/prisma` — that module builds the same
// adapter but never loads .env, because Next.js has already done it by the
// time the app uses it. Correct for the app, useless from the command line.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const args = process.argv.slice(2)
const FILE = args.find((a) => !a.startsWith('--')) ?? './data/p65chemicalslist.csv'
const PROBE = args.includes('--probe')
const SELFTEST = args.includes('--selftest')
const LIVE = args.includes('--live')
const DRY_RUN = !LIVE
// THE CSV CANNOT SAY WHICH LISTINGS WERE REMOVED.
//
// This file's own preamble: "chemicals or endpoints shown in STRIKEOUT were
// placed on the Proposition 65 list on the date noted, and have subsequently
// been removed." Strikeout is cell formatting. CSV carries no formatting, so
// a delisted chemical -- or a single delisted endpoint inside a multi-value
// row -- is byte-identical here to an active one.
//
// Writing from the CSV therefore publishes removed listings as current state
// findings on product pages. The XLSX keeps the formatting and can be read
// for it; the CSV structurally cannot. So --live is refused on a .csv unless
// the caller says, in the command, that they accept it.
const ALLOW_UNMARKED_DELISTINGS = args.includes('--allow-unmarked-delistings')

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

// PROP 65'S OWN VOCABULARY, which is not the one this script first assumed.
//
// The "Type of Toxicity" column holds a comma-separated SET drawn from four
// terms only: cancer, developmental, female, male. Measured against the
// 31-Jul-26 file, every one of the 15 distinct values is a combination of
// those.
//
// IT NEVER CONTAINS THE WORD "REPRODUCTIVE". The original version of this
// function tested `t.includes('reproductive')`, which is dead code on this
// file, so 44 rows -- 29 "male", 9 "female, male", 6 "female" -- were counted
// as unmapped and skipped. They are real reproductive-toxicity listings.
//
// "female" and "male" abbreviate the two reproductive endpoints. Expanding
// them is faithful to the source's own words, not our gloss: the document is
// titled "PROPOSITION 65 LIST OF CARCINOGENS OR REPRODUCTIVE TOXICANTS" and
// its preamble describes the list as chemicals known to cause "cancer or
// reproductive toxicity".
//
// A SET, NOT A SINGLE VALUE. 84 rows carry more than one endpoint, and
// first-match-wins stored only the first -- "cancer, developmental, female,
// male" is four findings and three were being dropped. That is the
// gap-as-claim mistake in the direction that happens to look safe.
//
// The word boundary on /\bmale\b/ is load-bearing: "female" contains "male"
// as a substring, and a test below pins it.
const TOXICITY_TERMS: { term: RegExp; code: string; label: string }[] = [
  { term: /\bcancer\b/, code: 'cancer', label: 'cancer' },
  { term: /\bdevelopmental\b/, code: 'developmental_toxicity', label: 'developmental toxicity' },
  { term: /\bfemale\b/, code: 'reproductive_toxicity', label: 'female reproductive toxicity' },
  { term: /\bmale\b/, code: 'reproductive_toxicity', label: 'male reproductive toxicity' },
]

function toCodes(type: string): { code: string; label: string }[] {
  const t = type.toLowerCase()
  return TOXICITY_TERMS.filter((x) => x.term.test(t)).map(({ code, label }) => ({ code, label }))
}

// THE HEADER IS NOT THE FIRST ROW, and --probe proved it on 2026-10-19:
// binding against rows[0] found nothing because rows[0] is
// "STATE OF CALIFORNIA" followed by eight empty columns. OEHHA ships the file
// with its letterhead above the table -- four lines of department name, the
// revision date, and two paragraphs of explanatory prose.
//
// So find the header rather than assume it. A row is the header when every
// REQUIRED field binds, each to a DIFFERENT column, and each matched cell is
// short.
//
// THE DISTINCTNESS TEST IS WHAT MAKES THIS SAFE. The explanatory paragraph
// contains both "chemicals" and "reproductive toxicity", so `name` and `type`
// would both bind to column 0 and a looser check would accept prose as a
// header. Requiring distinct columns rejects it; the length cap rejects it
// twice.
const HEADER_MAX_CELL = 60

function findHeaderRow(rows: string[][]): number {
  const required = MATCHERS.filter((m) => m.required)
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map((c) => c.trim())
    const bound = new Map<string, number>()
    for (const m of required) {
      const idx = cells.findIndex((c) => c.length > 0 && c.length <= HEADER_MAX_CELL && m.pattern.test(c))
      if (idx >= 0) bound.set(m.field, idx)
    }
    if (bound.size === required.length && new Set(bound.values()).size === bound.size) return i
  }
  return -1
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

// ===================== WITHDRAWN LISTINGS =====================
//
// THE PROBLEM THIS SOLVES. The CSV's preamble says removed chemicals and
// removed endpoints are "shown in strikeout". Strikeout is cell formatting and
// CSV carries none, so a withdrawn listing is byte-identical to an active one.
// Publishing from the CSV alone would state retired findings as current.
//
// WHY THE TABLE IS HERE RATHER THAN READ FROM THE XLSX. The XLSX does carry
// the formatting, but `xlsx` (SheetJS) 0.18.5 -- already a dependency --
// cannot see it in the community build. Measured 2026-10-19 against this exact
// file: `cell.s` holds only `patternType`, no font, and the HTML export of the
// partially-struck cell B284 emits
//     developmental<span style="font-size:12pt;">,   male   </span>
// with no line-through anywhere. Run-level strikeout is simply absent.
//
// So the formatting was read once, out of band, with Python openpyxl (which
// reads whole-cell `font.strike` AND rich-text runs), and the result is
// recorded here as reviewable reference data -- the same pattern as
// authorities.ts.
//
// WHAT WAS FOUND in the 31-Jul-26 XLSX across 1,021 data rows:
//     1  chemical struck entirely        -> 'ALL'
//     25 whose only endpoint was struck  -> that endpoint
//     4  with one of several struck      -> that endpoint, the others kept
//
// SACCHARIN IS IN HERE. It and sodium saccharin were delisted in 2001 and
// 2003. Before this table, the only thing preventing a published cancer claim
// on a common sweetener was an accident: the delisting notice sits inline in
// the chemical name, so normalise() produced "saccharin delisted april 6
// 2001", which matched nothing. stemOf() below removes that accident on
// purpose -- the listing now matches properly and is excluded deliberately.
//
// PINNED TO ONE REVISION. The table is only true for the edition it was read
// from, so --live refuses a file whose stated revision differs. That is the
// safety property: this data cannot go stale silently behind the code.
const WITHDRAWN_SOURCE_REVISION = '31-Jul-26'

const WITHDRAWN: Record<string, string[]> = {
  '1 3 5 triglycidyl s triazinetrione': ['male reproductive toxicity'],
  '2 4 d butyric acid': ['developmental toxicity'],
  '2 4 dp': ['developmental toxicity'],
  '2 ethylhexanoic acid': ['developmental toxicity'],
  '4 vinylcyclohexene': ['male reproductive toxicity'],
  '5 nitro o anisidine': ['cancer'],
  'allyl chloride': ['cancer'],
  'chloramphenicol': ['cancer'],
  'chlorodibromomethane': ['cancer'],
  'chlorsulfuron': ['developmental toxicity', 'female reproductive toxicity', 'male reproductive toxicity'],
  'cyclohexanol': ['male reproductive toxicity'],
  'diaminotoluene': ['cancer'],
  'dienestrol': ['cancer'],
  'diglycidyl ether': ['male reproductive toxicity'],
  'ethyl tert butyl ether': ['male reproductive toxicity'],
  'isosafrole': ['cancer'],
  'methyl isopropyl ketone': ['developmental toxicity'],
  'methyl styrene': ['female reproductive toxicity'],
  'n butyl glycidyl ether': ['male reproductive toxicity'],
  'p p oxybis': ['developmental toxicity'],
  'para toluidine': ['cancer'],
  'phenyl glycidyl ether': ['ALL'],
  'phenylphosphine': ['developmental toxicity'],
  'saccharin': ['cancer'],
  'saccharin sodium': ['cancer'],
  'tert amyl methyl ether': ['developmental toxicity'],
  'toluene': ['female reproductive toxicity'],
  'tris p benzoquinone': ['cancer'],
  'vinyl cyclohexene dioxide': ['male reproductive toxicity'],
  'zineb': ['cancer'],
}

// The key both the WITHDRAWN lookup and the matcher use.
//
// Most delisted rows carry their notice as inline text in the chemical name,
// which normalise() keeps, yielding a stem that matches nothing. Relying on
// that would be relying on a typographic accident: four of the thirty put the
// notice in brackets instead, which normalise() strips, and Toluene is
// precisely how a withdrawn endpoint reached the r24 match list.
//
// So: strip the notice, match the real chemical name, exclude from the table.
// Correct by construction rather than by luck.
function stemOf(authorityName: string): string {
  return normalise(authorityName.replace(/\bdelisted\b[\s\S]*$/i, ' '))
}

// ===================== THE THREE MATCHING GUARDS =====================
//
// All three were added in r24 after the first dry run produced 262
// assessments of which the clear majority were false. Every one of them can
// only ever PREVENT a claim; none creates one.

// GUARD 1 -- A PARENTHETICAL THAT NARROWS THE LISTING.
//
// `normalise()` strips parentheticals, on the reasoning that they carry
// synonyms and salt forms. For most of this file that is true:
// "DDT (Dichlorodiphenyl-trichloroethane)" is one substance under two names.
//
// BUT FOR SOME IT IS THE WHOLE POINT. Prop 65 lists
// "Chromium (hexavalent compounds)" -- industrial Cr(VI). Stripped to
// "chromium", it matched 47 of our ingredients across 919 product links:
// chromium picolinate, gtf chromium, chromium chloride. Those are trivalent
// chromium, a dietary trace mineral. NONE of the 47 contains the word
// "hexavalent". Every one of those 919 links would have carried a false
// cancer claim, and the restriction that says so was written in the source's
// own name.
//
// So: when a listing carries one of these qualifiers, the bare stem IS NOT
// the listed substance. Our name must carry the qualifier too, or there is no
// match -- and that gates the EXACT path as well as the widened one, because
// we hold an ingredient named plainly "chromium" (145 products) that exact
// match would otherwise reach.
//
// This list is deliberately short, explicit and reviewable rather than a
// clever heuristic, and every skip is reported so it can grow from evidence.
// A parenthetical NOT on this list keeps the old stripping behaviour.
const RESTRICTIVE_QUALIFIER =
  /\b(hexavalent|trivalent|inorganic|anhydrous|hydrated|technical grade|internal use|average chain length|metallic|soluble)\b/gi

function restrictiveTokens(authorityName: string): string[] {
  const out: string[] = []
  // A "(NOTE: ...)" parenthetical is explanatory, never restrictive. Aspirin's
  // listing carries a whole paragraph of advice about late pregnancy; treating
  // that as a qualifier would drop a true positive.
  const searchable = authorityName.replace(/\(\s*NOTE[^)]*\)/gi, ' ')
  for (const m of searchable.matchAll(RESTRICTIVE_QUALIFIER)) out.push(normalise(m[0]))
  return [...new Set(out)].filter(Boolean)
}

// GUARD 1b -- A NOTE SAYING THE ENDPOINT WAS REMOVED.
//
// Found in the r24 dry run, and it is the worst thing in this file:
//
//   "Toluene [Click here for the basis for the removal of female
//    reproductive endpoint effective March 7, 2014]"   -> reproductive_toxicity
//
// The source says that endpoint was withdrawn in 2014 and we were about to
// publish it as a current state finding. So delisting IS partly expressed in
// the CSV -- as a bracketed note inside the chemical name, which normalise()
// strips before anything reads it.
//
// This does NOT solve the strikeout problem in general (see the --live refusal
// above); a chemical removed by strikeout alone still looks active here. It
// removes the subset that says so in words.
//
// "Basis for listing CHANGED" is not a removal -- ethylene oxide and nitrous
// oxide both carry that note and both are still listed. Only removal wording
// counts, and only for the endpoint it names.
const REMOVAL_NOTE = /\b(removal|removed|delisted|withdrawn)\b/i

function removedLabels(authorityName: string): string[] {
  if (!REMOVAL_NOTE.test(authorityName)) return []
  const n = authorityName.toLowerCase()
  const out: string[] = []
  // \bmale\b does not fire inside "female" -- same boundary the toxicity
  // vocabulary depends on.
  if (/\bfemale\b/.test(n)) out.push('female reproductive toxicity')
  if (/\bmale\b/.test(n)) out.push('male reproductive toxicity')
  if (/\bcancer\b/.test(n)) out.push('cancer')
  if (/\bdevelopmental\b/.test(n)) out.push('developmental toxicity')
  return out
}

// GUARD 1c -- NAMES WHERE A LONGER NAME IS A DIFFERENT CHEMICAL.
//
// Containment widening assumes a longer name is the same substance with a
// function word attached: "titanium dioxide" -> "titanium dioxide color",
// "carrageenan" -> "carrageenan gum". For chemical nomenclature that
// assumption inverts, because names compose:
//
//   Styrene         -> styrene/butadiene, styrene/acrylates copolymer
//                      (a polymer is not its monomer)
//   Isoprene        -> styrene isoprene styrene block polymer
//   Benzophenone    -> benzophenone-4            (sulisobenzone)
//   2-Nitropropane  -> 2-bromo-2-nitropropane-1  (bronopol)
//   Toluene         -> bht-butyl hydroxi toluene  (BHT)
//
// Every entry below traces to a specific false match in the r24 dry run.
// Deliberately a short evidence-built list rather than a rule about chemical
// names in general, because the general version lost 10 true positives to
// catch 9 false ones when measured against this file's real pairs.
//
// Nothing is lost by it: where a longer form IS genuinely listed, Prop 65
// lists it separately ("Potassium bromate" alongside "Bromate"), and the
// exact path reaches it with the more specific citation.
//
// THE REAL FIX IS CAS NUMBERS. This file publishes them in column [3] and we
// bind them already; our Ingredient rows have none. Matching on CAS instead
// of strings removes this whole class of error, and the additives reference
// file in Phase 2 is where those numbers would live.
const EXACT_ONLY = new Set([
  'styrene',
  'isoprene',
  'toluene',
  'benzophenone',
  '2 nitropropane',
])

// GUARD 2 -- NEGATION ON OUR SIDE OF THE MATCH.
//
// "bromate-free wheat flour" normalises to "bromate free wheat flour", which
// contains "bromate" and means the exact opposite. This is the same failure
// as `non-hydrogenated` matching `hydrogenated` in r23, and 1,105 of our
// ingredient names carry "free" as a word.
function negatesKey(ourNormalised: string, key: string): boolean {
  return (
    ourNormalised.includes(`${key} free`) ||
    ourNormalised.includes(`free of ${key}`) ||
    ourNormalised.includes(`free from ${key}`) ||
    ourNormalised.includes(`no ${key}`) ||
    ourNormalised.includes(`without ${key}`) ||
    ourNormalised.includes(`not ${key}`)
  )
}

// GUARD 3 -- OUR "INGREDIENT" IS ACTUALLY A WARNING LABEL.
//
// The ingredient parser captured Prop 65 warning text off packaging and
// stored it as ingredient names: "women should not drink alcoholic beverages
// during preg", "consuming this product including acrylamide". They then
// match the very listings they are warning about, which is circular and
// indefensible on a page. 11 such rows, 11 product links.
//
// Excluded from the candidate pool entirely rather than per-listing, and
// reported, because the real fix is in the ingredient parser.
const WARNING_PROSE =
  /should not|consuming this|during preg|birth defects|known to the state|reproductive harm|this product contains/i

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
    // r24: the chromium case. Dietary Cr(III) under many names, none
    // hexavalent, plus one that genuinely is.
    { id: '9', name: 'chromium' },
    { id: '10', name: 'chromium picolinate' },
    { id: '11', name: 'hexavalent chromium' },
    { id: '12', name: 'bromate' },
    { id: '13', name: 'bromate-free wheat flour' },
    { id: '14', name: 'potassium bromate' },
    // r24: nomenclature traps and an unknown-form metal.
    { id: '15', name: 'styrene/butadiene' },
    { id: '16', name: 'styrene' },
    { id: '17', name: 'nickel' },
  ]
  const match = (authorityName: string) => {
    const key = normalise(authorityName)
    if (!key) return [] as string[]
    const found = new Map<string, string>()
    for (const i of ours) if (normalise(i.name) === key) found.set(i.id, i.name)
    if (specificEnoughToWiden(key) && !EXACT_ONLY.has(key)) {
      const needle = ` ${key} `
      for (const i of ours) if (` ${normalise(i.name)} `.includes(needle)) found.set(i.id, i.name)
    }
    return [...found.values()].sort()
  }

  // The same pipeline the live run uses: raw match, then guards 1 and 2.
  const matchGuarded = (authorityName: string) => {
    const key = normalise(authorityName)
    const raw = ours.filter((i) => match(authorityName).includes(i.name))
    const required = restrictiveTokens(authorityName)
    let kept = raw
    if (required.length > 0) {
      kept = kept.filter((i) => {
        const n = normalise(i.name)
        return required.every((t) => n.includes(t))
      })
    }
    kept = kept.filter((i) => !negatesKey(normalise(i.name), key))
    return kept.map((i) => i.name).sort()
  }

  const codes = (t: string) => toCodes(t).map((c) => c.code)
  const labels = (t: string) => toCodes(t).map((c) => c.label)

  // The real file's shape: letterhead, then an explanatory paragraph that
  // contains BOTH "chemicals" and "reproductive toxicity" in one cell, then
  // the header. The paragraph is why findHeaderRow requires distinct columns.
  const preambleRows: string[][] = [
    ['STATE OF CALIFORNIA', '', '', '', ''],
    [
      'The Safe Drinking Water and Toxic Enforcement Act of 1986, also known as Proposition 65, requires the list of chemicals known to the State to cause cancer or reproductive toxicity.',
      '', '', '', '',
    ],
    ['Chemical', 'Type of Toxicity', 'Listing Mechanism', 'CAS No.', 'Date Listed'],
  ]

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
    // THE VOCABULARY. Every case here is a value that actually occurs in the
    // 31-Jul-26 file, plus the two traps.
    ['cancer maps', codes('cancer'), ['cancer']],
    ['developmental maps', codes('developmental'), ['developmental_toxicity']],
    // Was silently skipped before: the column never says "reproductive".
    ['bare "male" maps to reproductive', codes('male'), ['reproductive_toxicity']],
    ['bare "female" maps to reproductive', codes('female'), ['reproductive_toxicity']],
    // "female" CONTAINS "male" as a substring. If the word boundary is lost,
    // every female-only listing silently gains a male finding.
    ['"female" does NOT also match male', labels('female'), ['female reproductive toxicity']],
    ['"male" label is male-specific', labels('male'), ['male reproductive toxicity']],
    // 84 rows are multi-valued and used to store only the first endpoint.
    ['multi-value keeps all four', labels('cancer, developmental, female, male'), [
      'cancer', 'developmental toxicity', 'female reproductive toxicity', 'male reproductive toxicity',
    ]],
    ['female+male are two findings', labels('female, male'), [
      'female reproductive toxicity', 'male reproductive toxicity',
    ]],
    ['irregular whitespace still parses', codes('developmental,   male'), [
      'developmental_toxicity', 'reproductive_toxicity',
    ]],
    ['missing comma still parses', codes('developmental male'), [
      'developmental_toxicity', 'reproductive_toxicity',
    ]],
    ['unmapped type yields no codes', codes('other toxicity'), []],
    ['empty type yields no codes', codes(''), []],
    // The header is row 8 of this file, not row 0.
    ['header found below the preamble', findHeaderRow(preambleRows), 2],
    ['prose is not accepted as a header', findHeaderRow([preambleRows[1]]), -1],
    ['sodium azide does NOT reach sodium', match('Sodium azide'), []],
    ['titanium dioxide reaches both', match('Titanium dioxide'), ['titanium dioxide', 'titanium dioxide color']],
    // r24: THIS CASE USED TO ASSERT THE BUG.
    //
    // It read "parentheticals stripped before matching" and required the
    // airborne titanium dioxide listing to reach both our titanium dioxide
    // names. It passed, and it was wrong twice over: that listing is dropped
    // upstream by NOT_ABOUT_FOOD, and the same stripping is what sent
    // "Chromium (hexavalent compounds)" onto 919 product links of dietary
    // chromium. A test written from the code's behaviour proves only that the
    // behaviour has not changed.
    ['a synonym parenthetical is still stripped', restrictiveTokens('DDT (Dichlorodiphenyl-trichloroethane)'), []],
    ['a NOTE parenthetical is not a qualifier', restrictiveTokens('Aspirin (NOTE:  do not use when hydrated)'), []],
    ['hexavalent is read as a qualifier', restrictiveTokens('Chromium (hexavalent compounds)'), ['hexavalent']],
    // GUARD 1, the 919-link bug.
    ['Cr(VI) does NOT reach dietary chromium', matchGuarded('Chromium (hexavalent compounds)'), ['hexavalent chromium']],
    ['the stem alone would have reached it', match('Chromium (hexavalent compounds)').includes('chromium picolinate'), true],
    // GUARD 2, the bromate-free bug.
    ['"bromate-free" is not bromate', negatesKey(normalise('bromate-free wheat flour'), 'bromate'), true],
    ['"potassium bromate" is bromate', negatesKey(normalise('potassium bromate'), 'bromate'), false],
    ['Bromate skips the free variant', matchGuarded('Bromate'), ['bromate', 'potassium bromate']],
    // GUARD 3.
    // THE WITHDRAWN TABLE and the stem it is keyed by.
    //
    // stemOf must strip the inline delisting notice, or the chemical never
    // matches and the exclusion never fires -- which is the accident that was
    // standing between us and a published cancer claim on saccharin.
    ['stemOf strips an inline delisting notice', stemOf('Saccharin  Delisted April 6, 2001  [Click here for the basis for delisting]'), 'saccharin'],
    ['stemOf leaves an active name alone', stemOf('Bromate'), 'bromate'],
    ['saccharin is recorded as withdrawn', WITHDRAWN['saccharin'], ['cancer']],
    ['sodium saccharin too', WITHDRAWN['saccharin sodium'], ['cancer']],
    ['a wholly struck chemical is ALL', WITHDRAWN['phenyl glycidyl ether'], ['ALL']],
    ['an active listing is absent from the table', WITHDRAWN['bromate'], undefined],
    // Row 838: "changed" wording over a struck endpoint. The text route misses
    // it by design; the table is why it is still caught.
    ['the text route misses Phenylphosphine', removedLabels('Phenylphosphine [Basis for listing changed effective June 1, 2012]'), []],
    ['the table catches Phenylphosphine', WITHDRAWN['phenylphosphine'], ['developmental toxicity']],
    // GUARD 1b -- the withdrawn endpoint. This one was about to be published.
    [
      'a removed endpoint is dropped',
      removedLabels('Toluene [Click here for the basis for the removal of female reproductive endpoint effective March 7, 2014]'),
      ['female reproductive toxicity'],
    ],
    // "basis changed" is not "removed" -- both of these are still listed.
    ['"basis changed" is not a removal', removedLabels('Ethylene oxide [Basis for listing changed effective November 22, 2013]'), []],
    ['a removal note names only its own endpoint', removedLabels('Something [removal of the cancer endpoint]'), ['cancer']],
    // GUARD 1c -- a polymer is not its monomer.
    ['Styrene does not reach a copolymer', matchGuarded('Styrene'), ['styrene']],
    ['metallic is read as a qualifier', restrictiveTokens('Nickel (Metallic)'), ['metallic']],
    ['soluble is read as a qualifier', restrictiveTokens('Nickel (soluble compounds)'), ['soluble']],
    ['Nickel of unknown form is not claimed', matchGuarded('Nickel (Metallic)'), []],
    ['warning prose is detected', WARNING_PROSE.test('women should not drink alcoholic beverages during preg'), true],
    ['a real ingredient is not prose', WARNING_PROSE.test('potassium bromate'), false],
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
  // The file carries a UTF-8 BOM, which would otherwise ride along on the
  // first cell of the first row.
  const rows = parseCsv(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
  if (rows.length < 2) {
    log('Fewer than two rows parsed. Is this the right file?')
    process.exitCode = 1
    return
  }

  const headerIdx = findHeaderRow(rows)
  if (headerIdx < 0) {
    log('\nNo row in this file binds every required field to a distinct column.')
    log('Rows seen (first 12), so the shape is visible:')
    for (const r of rows.slice(0, 12)) log(`    ${JSON.stringify(r.map((c) => c.trim().slice(0, 40)))}`)
    log('Fix MATCHERS or findHeaderRow against the rows above. Nothing was written.')
    process.exitCode = 1
    return
  }
  if (headerIdx > 0) {
    log(`\nSKIPPED ${headerIdx} PREAMBLE ROW(S) above the header:`)
    for (const r of rows.slice(0, headerIdx)) log(`    ${JSON.stringify(r[0]?.trim().slice(0, 110) ?? '')}`)
  }
  log(`\nHeader found at row index ${headerIdx}.`)

  // THE REVISION GATE.
  //
  // The WITHDRAWN table above was read from the strikeout formatting of one
  // specific edition of this list. It is reference data with an expiry date,
  // and the expiry is not a date -- it is this string, which OEHHA prints in
  // its own letterhead above the table.
  //
  // If the file in hand is a different revision, the strikeouts may have moved
  // and the table no longer describes it, so writing would risk publishing a
  // listing that was withdrawn after the table was built. Re-read the XLSX
  // with openpyxl, regenerate WITHDRAWN, and bump WITHDRAWN_SOURCE_REVISION.
  const stated = rows
    .slice(0, headerIdx)
    .flat()
    .map((c) => c.trim())
    .find((c) => /^\d{1,2}-[A-Za-z]{3}-\d{2}$/.test(c))
  log(`Revision stated in the file:  ${stated ?? '(none found)'}`)
  log(`Revision WITHDRAWN built from: ${WITHDRAWN_SOURCE_REVISION}  (${Object.keys(WITHDRAWN).length} entries)`)

  if (LIVE && stated !== WITHDRAWN_SOURCE_REVISION && !ALLOW_UNMARKED_DELISTINGS) {
    log('')
    log('REFUSING TO WRITE: this file is a different revision from the one the')
    log('withdrawn-listings table was built from, so the table may no longer')
    log('describe which listings have been removed.')
    log('')
    log('Fix: download the XLSX, re-read its strikeout formatting with openpyxl,')
    log('regenerate WITHDRAWN and bump WITHDRAWN_SOURCE_REVISION to the new one.')
    log('  https://oehha.ca.gov/sites/default/files/media/downloads/proposition-65//p65chemicalslist.xlsx')
    log('')
    log('Override only if the strikeouts have been accounted for another way:')
    log('  --live --allow-unmarked-delistings')
    process.exitCode = 1
    return
  }

  const header = rows[headerIdx].map((h) => h.trim())
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

  const body = rows.slice(headerIdx + 1)
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
    const cs = toCodes(t)
    log(`    ${String(n).padStart(6)}  ${JSON.stringify(t)}  -> ${cs.length ? cs.map((c) => c.label).join(' + ') : '(UNMAPPED)'}`)
  }
  const unmapped = [...types.keys()].filter((t) => t && toCodes(t).length === 0)
  if (unmapped.length > 0) {
    log(`\n!! ${unmapped.length} toxicity value(s) have no mapping and will be skipped:`)
    for (const t of unmapped.slice(0, 10)) log(`    ${JSON.stringify(t)}`)
    log('   Add them to TOXICITY_TERMS if they belong on a food page.')
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
  // WHY productCount AND NOT `products: { some: {} }`.
  //
  // The relation filter makes Prisma emit a correlated EXISTS against
  // ProductIngredient. The planner answers it with a nested-loop semi join --
  // a parallel seq scan over all 127,268 ingredients, each row probing
  // ProductIngredient's index -- because its row estimate for the semi join
  // is 5,561 against an actual 127,268, wrong by 23x.
  //
  // Measured 2026-10-19: statement timeout (57014), from this script AND from
  // a direct SQL client. Not a Prisma problem; the query shape.
  //
  // `productCount` is the same fact already materialised, and Phase 1 verified
  // it exact across all 127,268 rows (0 wrong, worst gap 0). Plain seq scan
  // over a 3,850-buffer table: 53ms, all cache hits. No index needed or
  // wanted -- the predicate currently selects every row, so an index would be
  // read overhead for nothing.
  //
  // THE SAME LESSON AS THE r23 OUTAGE: the fix was not a better index, it was
  // not asking the database to recompute a column we already keep.
  let ours = await prisma.ingredient.findMany({
    where: { productCount: { gt: 0 } },
    select: { id: true, name: true },
  })
  log(`\nOur ingredients on at least one product: ${ours.length.toLocaleString()}`)

  // GUARD 3 applied once, here, so the exclusion is visible and counted.
  const prose = ours.filter((i) => WARNING_PROSE.test(i.name))
  if (prose.length > 0) {
    log(`\nEXCLUDED ${prose.length} "ingredient" name(s) that are warning-label prose, not ingredients:`)
    for (const i of prose.slice(0, 20)) log(`    ${JSON.stringify(i.name)}`)
    log('    (the real fix belongs in the ingredient parser -- see features-to-add)')
  }
  const proseIds = new Set(prose.map((i) => i.id))
  ours = ours.filter((i) => !proseIds.has(i.id))

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

  // NORMALISE EVERY NAME ONCE.
  //
  // The containment check below runs per listing, so calling normalise()
  // inside it is exactly the "114 million comparisons" the comment above
  // warns against — 127k ingredients x ~900 listings, each one running a
  // four-step regex chain and allocating four strings. Precomputing the
  // padded form collapses that to 127k normalise() calls and leaves only the
  // substring test in the hot loop.
  const oursPadded = ours.map((ing) => ({ ing, padded: ` ${normalise(ing.name)} ` }))

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
  const skippedQualifier: string[] = []
  const skippedRemoved: string[] = []
  const skippedNegated: string[] = []
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
    // Declared before the withdrawal guard, which looks WITHDRAWN up by it.
    // (It used to sit below, and the dry run died on the temporal dead zone:
    // "Cannot access 'key' before initialization". The selftest cannot reach
    // this loop and the probe returns before it -- a typecheck would have
    // caught it as TS2448, and now does.)
    const key = stemOf(rawName)
    if (!key) continue

    let mappedCodes = toCodes(rawType)
    if (mappedCodes.length === 0) {
      skippedUnmapped++
      continue
    }

    // GUARD 1b: an endpoint the source says was removed is not a finding.
    //
    // TWO SOURCES, deliberately both. WITHDRAWN is authoritative, read from
    // the XLSX's strikeout. removedLabels() reads removal wording out of the
    // name text; it is kept because it needs no out-of-band step and caught
    // all four bracketed cases independently -- including Toluene, where the
    // live OEHHA page confirmed it drops only the named endpoint and leaves
    // "Cancer and Female Reproductive Toxicity" standing.
    //
    // THE TEXT ROUTE IS NOT SUFFICIENT ALONE. Row 838, "Phenylphosphine
    // [Basis for listing changed effective June ...]", has a struck
    // developmental endpoint behind wording that says "changed", not
    // "removed". The assumption that those two differ is wrong, and only the
    // formatting shows it.
    const tableLabels = WITHDRAWN[key] ?? []
    if (tableLabels.includes('ALL')) {
      skippedRemoved.push(`${rawName.slice(0, 80)}  [chemical withdrawn entirely]`)
      continue
    }
    const removed = [...new Set([...tableLabels, ...removedLabels(rawName)])]
    if (removed.length > 0) {
      const before = mappedCodes.length
      mappedCodes = mappedCodes.filter((c) => !removed.includes(c.label))
      if (before > mappedCodes.length) {
        skippedRemoved.push(`${rawName.slice(0, 100)}  [removed: ${removed.join(', ')}]`)
      }
      if (mappedCodes.length === 0) continue
    }


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
    if (specificEnoughToWiden(key) && !EXACT_ONLY.has(key)) {
      const needle = ` ${key} `
      for (const o of oursPadded) {
        if (o.padded.includes(needle)) found.set(o.ing.id, o.ing)
      }
    }
    let matches = [...found.values()]

    // GUARD 1: the listing is narrower than its stem.
    const required = restrictiveTokens(rawName)
    if (required.length > 0) {
      const before = matches.length
      matches = matches.filter((ing) => {
        const n = normalise(ing.name)
        return required.every((t) => n.includes(t))
      })
      if (before > matches.length) {
        skippedQualifier.push(
          `${rawName}  [requires ${required.join(' + ')}]  dropped ${before - matches.length}`
        )
      }
    }

    // GUARD 2: our name negates the substance it names.
    const negated = matches.filter((ing) => negatesKey(normalise(ing.name), key))
    if (negated.length > 0) {
      for (const ing of negated) skippedNegated.push(`${ing.name}  <-  ${JSON.stringify(rawName)}`)
      const negatedIds = new Set(negated.map((i) => i.id))
      matches = matches.filter((ing) => !negatedIds.has(ing.id))
    }

    if (matches.length === 0) {
      skippedNoMatch.push(rawName)
      continue
    }

    const listed = bind.listedDate !== undefined ? (r[bind.listedDate] ?? '').trim() : ''
    const parsed = listed ? new Date(listed) : null
    const assessedDate = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null
    const cas = bind.cas !== undefined ? (r[bind.cas] ?? '').trim() || null : null

    // ONE ROW PER (INGREDIENT, ENDPOINT). A listing of "cancer,
    // developmental, female, male" is four separate findings by the state and
    // the unique key carries `classification`, so all four coexist rather
    // than overwriting each other.
    for (const ing of matches) {
      for (const mapped of mappedCodes) {
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
  }

  log(`\n===== MATCHING =====`)
  log(`Rows skipped, inhalation/occupational route: ${skippedRoute.toLocaleString()}`)
  log(`Rows skipped, unmapped toxicity type:       ${skippedUnmapped.toLocaleString()}`)
  log(`Listings with no ingredient of ours:        ${skippedNoMatch.length.toLocaleString()}`)
  log(`Listings narrowed by a qualifier:           ${skippedQualifier.length.toLocaleString()}`)
  log(`Endpoints dropped as REMOVED by the source: ${skippedRemoved.length.toLocaleString()}`)
  log(`Matches dropped as negated ("X-free"):      ${skippedNegated.length.toLocaleString()}`)

  if (skippedRemoved.length > 0) {
    log('\nDROPPED AS WITHDRAWN (the source says this endpoint was removed):')
    for (const x of skippedRemoved) log(`    ${x}`)
  }
  if (skippedQualifier.length > 0) {
    log('\nDROPPED BY A RESTRICTIVE QUALIFIER (the stem is not the listed substance):')
    for (const x of skippedQualifier) log(`    ${x}`)
  }
  if (skippedNegated.length > 0) {
    log('\nDROPPED AS NEGATED (our name says the substance is absent):')
    for (const x of skippedNegated.slice(0, 40)) log(`    ${x}`)
    if (skippedNegated.length > 40) log(`    ...and ${skippedNegated.length - 40} more`)
  }
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

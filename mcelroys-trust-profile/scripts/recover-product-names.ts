// RECOVER A REAL PRODUCT NAME for records whose name is just the company name.
//
// WHY. Michael, on Vercel comment Tm_0VJusD8nD: "'Celsius' is the company,
// not the beverage. This needs serious fixing." 2,296 products have a name
// identical to their company's name, so the title tells a reader nothing the
// line above it did not already say.
//
// His rule, 2026-10-25: such a record "shouldnt go into the database because
// its not a real product unless the photo or barcode gives us more
// information about it in which case we should try to research to get the
// product name. If we cant in the end then it should be in a part of the
// database that has a 'missing info' category and doesnt get displayed."
//
// THIS IS THE RESEARCH STEP, and it runs BEFORE anything is withheld. Of the
// 2,296, 1,782 have a package photograph and 935 a disclosed ingredient list,
// so most fall on the "research it" branch. Hiding first would have thrown
// away 935 ingredient lists, which is the main thing the site is for.
//
// ---------------------------------------------------------------- VERSION 2
//
// V1 USED THE FDC API, ONE LOOKUP PER PRODUCT, AND TOOK 169 MINUTES to adopt
// 190 names out of 2,296. Reading the log afterwards found two bugs in the
// guard and one in the approach. All three are fixed here:
//
//   1. IT ONLY LOOKED AT ONE BRAND FIELD. V1 did `brandOwner ?? brandName`,
//      so whenever brand_owner was present brand_name was never consulted —
//      and brand_owner is routinely the CORPORATE PARENT while brand_name is
//      the brand we actually hold. "Pringles" was rejected against
//      "Kellogg Company US" while a brand_name column sat unread. 86 of the
//      429 rejections were this parent-company shape. All three brand columns
//      are compared now.
//   2. AN EMPTY FDC BRAND AUTO-REJECTED. 13 records had no brand at all, 10
//      of which had the company name sitting inside the description
//      ("DUBBLE BUBBLE BUBBLE GUM"). A description containing our company
//      name is corroboration of exactly the same kind as a brand match, so it
//      is now a fallback.
//   3. THE API WAS THE WRONG SOURCE. 1,666 of the 2,296 are not in FDC at
//      all — FDC is US-only and Open Food Facts is global — and each miss
//      cost up to five HTTP requests a second apart. The same data is already
//      on disk as the FDC bulk CSVs, which this version streams ONCE. Minutes
//      instead of hours, no API key, no rate limit, and three extra columns
//      the API response did not give us: subbrand_name, branded_food_category
//      and market_country.
//
// IDENTITY IS CORROBORATED BY BRAND, NOT BY NAME, and that is the whole
// design. scripts/ingest-fooddata-central.ts guards identity by comparing
// product NAMES, and its comment records what the alternative cost: "if our
// record is on the wrong barcode, our ingredients came from that same wrong
// barcode, so they will 'agree' with USDA and the agreement will read as
// validation." But for THESE records the name is precisely what we know is
// worthless — "Celsius" against "Energy Drink, Orange" shares no tokens — so
// that guard would reject exactly what this script exists to fix.
//
// The guard still matters, and the v1 log proved it. Two real mismatches it
// caught: "LoSalt" whose FDC brand owner is Starbuzz Tobacco Inc., and
// "Libby's" (canned vegetables) against a mac-and-cheese dinner under a brand
// spelled "Easdg". A barcode match alone would have published both.
//
// WHAT IT DOES NOT DO. Where the barcode matches but nothing corroborates the
// brand, the record is LEFT ALONE and reported. Those are not failures to
// retry harder at — "NACHO CHEESE TORTILLA CHIPS" under Frito-Lay could be
// Doritos or Santitas or Tostitos, and no rule separates it from the LoSalt
// case. They are the best candidates for the photograph pass, where the job
// is to CONFIRM this candidate name rather than invent one, because two
// independent sources agreeing is corroboration that a single source is not.
//
// WHAT IT WRITES
//   name           FDC's `description` from food.csv, VERBATIM
//   nameSource     'usda_fooddata_central'
//   nameSourceUrl  the FDC food-details page
//   nameCheckedAt  now
//
// VERBATIM INCLUDING THE SHOUTING. FDC descriptions are usually all caps
// ("CELSIUS LIVE FIT SPARKLING ORANGE"). That is the record, so that is what
// is stored; src/lib/productName.ts runs titleCaseName() on the way to the
// screen. Store the record, present it nicely.
//
// 58% of v1's adoptions also carried a REDUNDANT TAIL CLAUSE — FDC's
// "DESCRIPTION, MODIFIER" convention, where the modifier repeats
// ("SWEETENED RICE CEREAL, SWEETENED"). Still stored verbatim; trimming it is
// a display concern for productName.ts, and the trim has to be conservative
// because a genuine flavour list would otherwise lose its last item.
//
// EVERY ADOPTION IS LOGGED, before and after, not just a sample. This changes
// the most visible field on the page, so the log is the audit trail that
// makes a bad adoption findable and reversible.
//
// GET THE FILES: the FDC "Branded foods" CSV download, already unpacked at
//   ./data/FoodData_Central_branded_food_csv_<date>/
// Pass that DIRECTORY. The script reads branded_food.csv and food.csv from it
// and VALIDATES THEIR HEADERS before doing anything, printing what it actually
// found if a column it needs is missing. Refusing to run beats guessing at a
// format — the Prop 65 ingest earned that rule.
//
// USAGE
//   npx tsc --noEmit
//   npx tsx scripts/recover-product-names.ts --selftest
//   npx tsx scripts/recover-product-names.ts ./data/FoodData_Central_branded_food_csv_2025-12-18
//   npx tsx scripts/recover-product-names.ts <dir> --live --limit 50
//   npx tsx scripts/recover-product-names.ts <dir> --live
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse'
import * as fs from 'fs'
import * as path from 'path'
import { normalizeUpc, upcQueryForms } from '@/lib/upc'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const clientOptions = {
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0]
const prisma = new PrismaClient(clientOptions)

const args = process.argv.slice(2)
const DIR = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a))
const DRY_RUN = !args.includes('--live')
const SELFTEST = args.includes('--selftest')
function argValue(name: string): string | null {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] ?? null : null
}
const LIMIT = argValue('--limit') ? Number(argValue('--limit')) : Infinity
const NAME_SOURCE = 'usda_fooddata_central'

// Columns this script cannot work without. Checked against the real header
// before either file is streamed.
const BRANDED_REQUIRED = [
  'fdc_id', 'brand_owner', 'brand_name', 'subbrand_name', 'gtin_upc',
  'branded_food_category', 'market_country', 'discontinued_date', 'modified_date',
] as const
const FOOD_REQUIRED = ['fdc_id', 'description'] as const

const LOG_FILE = path.join(
  './logs',
  `${DRY_RUN ? 'recover-product-names-dryrun' : 'recover-product-names'}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
)
fs.mkdirSync('./logs', { recursive: true })
function writeLine(line: string) {
  fs.appendFileSync(LOG_FILE, line + '\n')
}
function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  writeLine(line)
}
function logError(...parts: unknown[]) {
  const line = parts
    .map((a) =>
      a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a)
    )
    .join(' ')
  console.error(line)
  writeLine('[ERROR] ' + line)
}
function detach(s: string): string {
  return (' ' + s).slice(1)
}

// WHERE THE LOG IS, SAID BEFORE ANYTHING ELSE HAPPENS.
//
// Michael, 2026-10-27: "for scripts like this in the future please add a log
// function so i dont have to copy and paste". The log was always being
// written — this script just never said so, which made the terminal the only
// obvious place to read it from. backfill-off-images.ts prints its path at
// the end and that is where the habit came from; printing it at the START
// too matters more, because a run that dies halfway still leaves a file worth
// reading and the terminal scrollback may not survive.
//
// At module scope on purpose: this runs before main(), so it prints even if
// argument parsing or the database connection throws.
log(`Log file: ${path.resolve(LOG_FILE)}`)


// --- NORMALISING AND TOKENISING ---
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Words that carry no identity. Without these, "Generic Foods Inc" would
// corroborate "Unrelated Foods Inc" on the shared token "foods".
const NOISE = new Set([
  'the', 'and', 'with', 'organic', 'inc', 'llc', 'ltd', 'co', 'corp', 'corporation',
  'company', 'brands', 'brand', 'foods', 'food', 'holdings', 'group', 'usa',
  'international', 'products', 'sales', 'north', 'america',
])
// THE SAME STRING WITH EVERYTHING BUT LETTERS AND DIGITS REMOVED.
//
// tokens() below drops anything shorter than three characters, which is right
// for ignoring noise words but destroys a whole class of brand: "M&M's"
// becomes "m m s" and then nothing, so an EXACT match against FDC's "M&M'S"
// produced two empty sets and an automatic rejection. The v3 log had six of
// them — H-E-B against brand "H-E-B", four M&M's against "M&M'S", and
// "da fruta" against "DAFRUTA", all rejected while being the same brand.
//
// So exact equality is tested first, on a form that ignores punctuation and
// spacing entirely. It is the strongest evidence available and it was being
// thrown away.
//
// It stays strict about spelling: our "Tolberone" does NOT equal FDC's
// "TOBLERONE", so that record remains rejected — correctly, because the
// misspelling is in our own data and adopting on a near-miss is how the wrong
// product name ends up on a barcode.
function tight(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function tokens(s: string): Set<string> {
  return new Set(
    norm(s)
      .split(/\s+/)
      .filter((t) => t.length > 2 && !NOISE.has(t))
      .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t))
  )
}

// --- GUARD 1: DOES ANYTHING CORROBORATE THE IDENTITY? ---
//
// Checks ALL THREE brand columns, not the first non-empty one — the v1 bug.
// brand_owner is often the corporate parent ("Kellogg Company US") while
// brand_name or subbrand_name is the brand we hold ("Pringles").
//
// The description fallback exists because 13 records carry no brand at all,
// and a description that CONTAINS our company name ("DUBBLE BUBBLE BUBBLE
// GUM" for Dubble Bubble) is corroboration of the same kind. One-sided on
// purpose: the reverse — our company name containing the whole description —
// means the description says nothing, and guard 2 rejects it.
export function corroboration(
  fdc: { brandOwner: string; brandName: string; subbrandName: string; description: string },
  legalName: string,
  dbaNames: string[],
  // Every brand token FDC lists ANYWHERE under this brand_owner — see
  // ownerBrands in main(). Optional so the selftest can supply one directly.
  ownerBrandTokens?: Set<string>
): string | null {
  const ourNames = [legalName, ...dbaNames].filter(Boolean)

  // GUARD 0: the brand string IS our company name, punctuation aside.
  // Checked before tokenising because tokenising can reduce a short brand to
  // nothing — see tight() above.
  for (const [field, value] of [
    ['brand_name', fdc.brandName],
    ['subbrand_name', fdc.subbrandName],
    ['brand_owner', fdc.brandOwner],
  ] as const) {
    if (!value) continue
    const v = tight(value)
    if (!v) continue
    for (const n of ourNames) if (tight(n) === v) return `${field} matches exactly`
  }

  const ours = new Set<string>()
  for (const n of ourNames) for (const t of tokens(n)) ours.add(t)
  // Every token was noise or too short. Guard 0 above already had its chance
  // at an exact match, so there is nothing left to compare.
  if (ours.size === 0) return null

  for (const [field, value] of [
    ['brand_name', fdc.brandName],
    ['subbrand_name', fdc.subbrandName],
    ['brand_owner', fdc.brandOwner],
  ] as const) {
    if (!value) continue
    for (const t of tokens(value)) if (ours.has(t)) return field
  }

  // THIS ROW'S BRAND COLUMNS ARE BLANK, BUT THE FILE KNOWS THE OWNER'S BRANDS.
  //
  // FDC populates brand_name inconsistently across rows from the same owner.
  // The v2 log showed it three lines apart — same owner, same product line:
  //
  //   0018400312944  owner="Massimo Zanetti..."  brand="HILLS BROS."  ADOPTED
  //   0018400312593  owner="Massimo Zanetti..."  brand=""             rejected
  //   0018400313712  owner="Massimo Zanetti..."  brand=""             rejected
  //
  // So the evidence is already in the file, one hop away: this owner is known
  // to FDC as a producer of HILLS BROS., which corroborates the rows where the
  // column happens to be empty. Same KIND of evidence as a direct brand match,
  // derived from the dataset itself rather than from any outside list of brand
  // ownership — and it is what rescues the licensing relationships the
  // tokeniser cannot see (Seneca Foods for Libby's, Tootsie Roll for Junior
  // Mints, Glaceau for Smartwater).
  //
  // IT DOES NOT WEAKEN THE GUARD. Starbuzz Tobacco is nowhere in FDC listed as
  // producing LoSalt, so that mismatch still fails — which is the point of
  // deriving this from the data instead of assuming a parent-child link.
  if (ownerBrandTokens && ownerBrandTokens.size > 0) {
    for (const t of ours) {
      if (ownerBrandTokens.has(t)) return 'brand listed under this owner elsewhere in FDC'
    }
  }

  // No brand agreed. Does the description carry our company name?
  const d = norm(fdc.description)
  const c = norm(legalName)
  if (c && d.includes(c)) return 'description contains the company name'

  return null
}

// --- GUARD 2: DOES THE NEW NAME ACTUALLY SAY MORE? ---
//
// FDC's description is sometimes just the brand again. One-sided containment:
// a description that CONTAINS the company name is the good case and must be
// kept; only the reverse is worthless.
export function nameAddsInformation(description: string, legalName: string): string | null {
  const d = norm(description)
  const c = norm(legalName)
  if (!d) return 'empty'
  if (d === c) return 'identical to the company name'
  if (c.includes(d)) return 'already contained in the company name'
  if (!/[a-z]{3}/.test(d)) return 'no word of three or more letters'
  if (description.length > 200) return 'longer than 200 chars'
  return null
}

type Candidate = {
  id: string
  name: string
  upc: string
  legalName: string
  dbaNames: string[]
}

async function loadCandidates(): Promise<Candidate[]> {
  // Raw SQL because the comparison is between two columns across a join,
  // which a Prisma where clause cannot express.
  return prisma.$queryRaw<Candidate[]>`
    SELECT p.id, p.name, p.upc, c."legalName", c."dbaNames"
      FROM "Product" p
      JOIN "Company" c ON c.id = p."companyId"
     WHERE p.upc IS NOT NULL
       AND p."nameCheckedAt" IS NULL
       AND lower(regexp_replace(p.name,        '[^a-zA-Z0-9]+', '', 'g'))
         = lower(regexp_replace(c."legalName", '[^a-zA-Z0-9]+', '', 'g'))
     ORDER BY p.id
  `
}

type FdcRow = {
  fdcId: string
  brandOwner: string
  brandName: string
  subbrandName: string
  category: string
  marketCountry: string
  discontinued: string
  modified: string
}

// Streams a CSV, validating the header first. `onRow` is called with each
// record as an object keyed by column name.
function streamCsv(
  file: string,
  required: readonly string[],
  onRow: (row: Record<string, string>) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let headerChecked = false
    const parser = parse({
      columns: (header: string[]) => {
        headerChecked = true
        const missing = required.filter((c) => !header.includes(c))
        if (missing.length > 0) {
          // Refuse rather than guess. The Prop 65 ingest earned this rule:
          // assuming an export's shape cost a run and a day.
          reject(
            new Error(
              `${path.basename(file)} is missing required column(s): ${missing.join(', ')}\n` +
                `  Header actually found (${header.length} columns):\n    ${header.join(', ')}`
            )
          )
        }
        return header
      },
      skip_empty_lines: true,
      relax_column_count: true,
    })
    parser.on('readable', () => {
      let r: Record<string, string> | null
      while ((r = parser.read() as Record<string, string> | null) !== null) onRow(r)
    })
    parser.on('error', reject)
    parser.on('end', () => {
      if (!headerChecked) reject(new Error(`${path.basename(file)} appears to be empty.`))
      else resolve()
    })
    fs.createReadStream(file).pipe(parser)
  })
}

function selfTest(): boolean {
  let failures = 0
  function check(label: string, got: unknown, want: unknown) {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) failures++
    log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}  (expected ${JSON.stringify(want)}, got ${JSON.stringify(got)})`)
  }
  const fdc = (o: Partial<Parameters<typeof corroboration>[0]>) => ({
    brandOwner: '', brandName: '', subbrandName: '', description: '', ...o,
  })

  log('\nCorroboration — all three brand columns, not the first non-empty')
  check('brand_owner matches',
    corroboration(fdc({ brandOwner: 'Celsius Holdings Inc' }), 'Celsius', []), 'brand_owner')
  // THE V1 BUG, pinned. brand_owner is present and unrelated, brand_name is
  // ours. V1 did `brandOwner ?? brandName` and never read the second.
  // THESE THREE REPORT "matches exactly" RATHER THAN THE BARE FIELD NAME,
  // because guard 0 fires first when the brand string equals our company name
  // once punctuation is ignored. The expectations below originally said
  // 'brand_name' / 'subbrand_name' and the selftest caught them the moment
  // guard 0 landed — which is the point of pinning the return value and not
  // just truthiness.
  check('brand_name matches while brand_owner is the corporate parent',
    corroboration(fdc({ brandOwner: 'Kellogg Company US', brandName: 'Pringles' }), 'Pringles', []),
    'brand_name matches exactly')
  check('subbrand_name matches',
    corroboration(fdc({ brandOwner: 'PepsiCo Inc', subbrandName: 'Tostitos' }), 'Tostitos', []),
    'subbrand_name matches exactly')
  check('brand matches a dba name',
    corroboration(fdc({ brandName: 'Kool-Aid' }), 'Kraft Heinz', ['Kool Aid']),
    'brand_name matches exactly')

  // AND THE TOKEN PATH STILL NEEDS COVER. Guard 0 now short-circuits every
  // exact case above, so without these the token comparison would have no
  // test at all — the brand string here is longer than our company name, so
  // tight() cannot match and it has to fall through to tokens.
  check('brand_name matches on a token when the strings differ',
    corroboration(fdc({ brandOwner: 'Kellogg Company US', brandName: 'Pringles Snack Stacks' }), 'Pringles', []),
    'brand_name')
  check('subbrand_name matches on a token when the strings differ',
    corroboration(fdc({ brandOwner: 'PepsiCo Inc', subbrandName: 'Tostitos Scoops' }), 'Tostitos', []),
    'subbrand_name')

  log('\nCorroboration — description fallback when no brand is given')
  check('empty brand, description carries the company name',
    corroboration(fdc({ description: 'DUBBLE BUBBLE BUBBLE GUM, 16 OZ' }), 'Dubble Bubble', []),
    'description contains the company name')
  check('empty brand, description unrelated',
    corroboration(fdc({ description: 'IODIZED REDUCED SODIUM SALT ALTERNATIVE' }), 'LoSalt', []), null)

  log('\nCorroboration — exact brand match, which tokenising used to destroy')
  // The six v3 false negatives, pinned.
  check('M&M\'s vs M&M\'S',
    corroboration(fdc({ brandOwner: 'Mars Chocolate North America LLC', brandName: "M&M'S" }), "M&M's", []),
    'brand_name matches exactly')
  check('H-E-B vs H-E-B',
    corroboration(fdc({ brandOwner: 'H E Butt Grocery Company', brandName: 'H-E-B' }), 'H-E-B', []),
    'brand_name matches exactly')
  check('"da fruta" vs "DAFRUTA" — spacing ignored',
    corroboration(fdc({ brandOwner: 'Liberty Imports', brandName: 'DAFRUTA' }), 'da fruta', []),
    'brand_name matches exactly')
  // STILL STRICT ABOUT SPELLING. Our record says "Tolberone"; FDC says
  // "TOBLERONE". A near-miss must not corroborate — the misspelling is ours,
  // and adopting on it is how a wrong name lands on a barcode.
  check('our misspelling "Tolberone" does NOT match "TOBLERONE"',
    corroboration(fdc({ brandOwner: 'Kraft Foods Schweiz Holding GmbH', brandName: 'TOBLERONE', description: 'SWISS MILK CHOCOLATE WITH HONEY & ALMOND NOUGAT BARS' }), 'Tolberone', []),
    null)

  log('\nCorroboration — the owner-brand index, for rows whose brand column is blank')
  // The Hills Bros. case from the v2 log, pinned. This row's brand columns are
  // empty and the owner shares no token with us; the only evidence is that FDC
  // lists HILLS BROS. under this owner on OTHER rows.
  check('blank brand, but the owner is known to carry our brand',
    corroboration(
      fdc({ brandOwner: 'Massimo Zanetti Beverage USA, Inc.', description: 'DOUBLE MOCHA CAPPUCCINO CAFE STYLE DRINK MIX' }),
      'Hills Bros.', [], new Set(['hill', 'bro'])
    ),
    'brand listed under this owner elsewhere in FDC')
  check('a licensing relationship the tokeniser cannot see',
    corroboration(
      fdc({ brandOwner: 'Seneca Foods Corporation', description: 'FRENCH STYLE GREEN BEANS' }),
      "Libby's", [], new Set(['libby'])
    ),
    'brand listed under this owner elsewhere in FDC')
  // AND IT MUST NOT RESCUE A REAL MISMATCH. Starbuzz is nowhere in FDC listed
  // as producing LoSalt, so its token set does not contain ours.
  check('the index does NOT rescue LoSalt from the tobacco company',
    corroboration(
      fdc({ brandOwner: 'Starbuzz Tobacco Inc.', description: 'IODIZED REDUCED SODIUM SALT ALTERNATIVE' }),
      'LoSalt', [], new Set(['starbuzz', 'hookah'])
    ),
    null)
  check('an empty index changes nothing',
    corroboration(fdc({ brandOwner: 'Unrelated Inc' }), 'Celsius', [], new Set()), null)

  log('\nCorroboration — the real mismatches v1 correctly caught')
  check('LoSalt vs a tobacco company',
    corroboration(fdc({ brandOwner: 'Starbuzz Tobacco Inc.', description: 'IODIZED REDUCED SODIUM SALT ALTERNATIVE' }), 'LoSalt', []),
    null)
  check('Libby\'s vs "Easdg" mac and cheese',
    corroboration(fdc({ brandOwner: 'Easdg', description: 'CLASSIC MAC & CHEESE FLAVORED DINNER' }), "Libby's", []),
    null)
  check('legal-entity noise alone is not a match',
    corroboration(fdc({ brandOwner: 'Generic Foods Inc' }), 'Unrelated Foods Inc', []), null)
  check('no company tokens at all never corroborates',
    corroboration(fdc({ brandOwner: 'Celsius' }), 'Inc', []), null)

  log('\nDoes the new name say more?')
  check('real description kept',
    nameAddsInformation('CELSIUS LIVE FIT SPARKLING ORANGE', 'Celsius'), null)
  check('description that is just the brand',
    nameAddsInformation('Celsius', 'Celsius'), 'identical to the company name')
  // Regression witness: this is the useful direction. Comparing both ways
  // would discard every record this script exists to fix.
  check('company name inside the description is KEPT',
    nameAddsInformation('Celsius Energy Drink', 'Celsius'), null)
  check('punctuation only', nameAddsInformation('12 oz', 'Celsius'), 'no word of three or more letters')
  check('empty', nameAddsInformation('   ', 'Celsius'), 'empty')

  log(failures === 0 ? '\nAll self-tests passed.' : `\n${failures} self-test(s) FAILED.`)
  return failures === 0
}

async function main() {
  if (SELFTEST) {
    log('SELF TEST — no files, no database')
    if (!selfTest()) process.exitCode = 1
    return
  }
  if (!DIR || !fs.existsSync(DIR)) {
    logError(`FDC directory not found: ${DIR ?? '(none given)'}`)
    logError('Pass the unpacked FoodData_Central_branded_food_csv_<date> directory.')
    process.exitCode = 1
    return
  }
  const brandedFile = path.join(DIR, 'branded_food.csv')
  const foodFile = path.join(DIR, 'food.csv')
  for (const f of [brandedFile, foodFile]) {
    if (!fs.existsSync(f)) {
      logError(`Missing ${path.basename(f)} in ${DIR}`)
      process.exitCode = 1
      return
    }
  }

  const candidates = await loadCandidates()
  log(`${DRY_RUN ? 'DRY RUN' : 'LIVE RUN'} — ${candidates.length.toLocaleString()} products whose name is their company name and whose name has never been checked.`)
  if (candidates.length === 0) {
    log('Nothing to do.')
    return
  }

  // Index our candidates by EVERY spelling of their barcode, so one pass over
  // the CSV can match whichever form FDC happens to hold. This is the whole
  // reason the CSV approach is fast: v1 asked the API five times per product,
  // this asks the file once for all of them.
  const byBarcode = new Map<string, Candidate>()
  for (const c of candidates) {
    for (const form of upcQueryForms(c.upc)) {
      const n = normalizeUpc(form)
      if (n.ok) byBarcode.set(n.upc, c)
      byBarcode.set(form, c)
    }
  }
  log(`Indexed ${byBarcode.size.toLocaleString()} barcode spellings for ${candidates.length.toLocaleString()} products.`)

  const started = Date.now()
  const hits = new Map<string, FdcRow>() // product id -> best FDC row
  let brandedRows = 0

  // EVERY BRAND FDC LISTS UNDER EACH OWNER, built from the whole file rather
  // than only from our matches — because the row that names the brand is
  // usually a DIFFERENT row from the one we matched. Tokenised on the way in
  // so the lookup later is a set membership test.
  //
  // Cost: distinct owners in the branded set number in the tens of thousands,
  // each with a handful of brand tokens, so this is a few MB — cheap enough
  // not to warrant a second pass over 2 million rows to narrow it.
  const ownerBrands = new Map<string, Set<string>>()
  function noteOwnerBrand(owner: string, brand: string) {
    if (!owner || !brand) return
    const key = norm(owner)
    if (!key) return
    let set = ownerBrands.get(key)
    if (!set) {
      set = new Set<string>()
      ownerBrands.set(key, set)
    }
    for (const t of tokens(brand)) set.add(t)
  }

  log(`\nPass 1 of 2: ${path.basename(brandedFile)} (${(fs.statSync(brandedFile).size / 1e9).toFixed(2)} GB)`)
  await streamCsv(brandedFile, BRANDED_REQUIRED, (r) => {
    brandedRows++
    // Learn this owner's brands from EVERY row, matched or not.
    noteOwnerBrand(r.brand_owner ?? '', r.brand_name ?? '')
    noteOwnerBrand(r.brand_owner ?? '', r.subbrand_name ?? '')

    const gtin = (r.gtin_upc ?? '').trim()
    if (!gtin) return
    const n = normalizeUpc(gtin)
    const c = (n.ok ? byBarcode.get(n.upc) : undefined) ?? byBarcode.get(gtin)
    if (!c) return

    const row: FdcRow = {
      fdcId: detach(r.fdc_id ?? ''),
      brandOwner: detach((r.brand_owner ?? '').trim()),
      brandName: detach((r.brand_name ?? '').trim()),
      subbrandName: detach((r.subbrand_name ?? '').trim()),
      category: detach((r.branded_food_category ?? '').trim()),
      marketCountry: detach((r.market_country ?? '').trim()),
      discontinued: detach((r.discontinued_date ?? '').trim()),
      modified: detach((r.modified_date ?? '').trim()),
    }
    // A barcode can appear more than once in FDC. Prefer a record that is not
    // discontinued, then the most recently modified — the one most likely to
    // describe what is on a shelf now.
    const prev = hits.get(c.id)
    if (!prev) { hits.set(c.id, row); return }
    const prevDisc = prev.discontinued !== ''
    const thisDisc = row.discontinued !== ''
    if (prevDisc && !thisDisc) { hits.set(c.id, row); return }
    if (prevDisc === thisDisc && row.modified > prev.modified) hits.set(c.id, row)
  })
  log(`  ${brandedRows.toLocaleString()} rows read, ${hits.size.toLocaleString()} of our products matched by barcode.`)
  log(`  Learned brands for ${ownerBrands.size.toLocaleString()} distinct brand_owners along the way.`)

  if (hits.size === 0) {
    log('\nNo barcode matches at all. Nothing further to do.')
    return
  }

  // Pass 2: the product NAME lives in food.csv, keyed by fdc_id.
  const wantedFdcIds = new Set([...hits.values()].map((h) => h.fdcId))
  const descriptions = new Map<string, string>()
  let foodRows = 0
  log(`\nPass 2 of 2: ${path.basename(foodFile)} (${(fs.statSync(foodFile).size / 1e9).toFixed(2)} GB), looking for ${wantedFdcIds.size.toLocaleString()} fdc_ids`)
  await streamCsv(foodFile, FOOD_REQUIRED, (r) => {
    foodRows++
    const id = (r.fdc_id ?? '').trim()
    if (!wantedFdcIds.has(id)) return
    descriptions.set(detach(id), detach((r.description ?? '').trim()))
  })
  log(`  ${foodRows.toLocaleString()} rows read, ${descriptions.size.toLocaleString()} descriptions found.`)

  // --- DECIDE ---
  const byId = new Map(candidates.map((c) => [c.id, c]))
  let adopted = 0, noCorroboration = 0, noDescription = 0, uselessDescription = 0
  let considered = 0, allCaps = 0, redundantTail = 0
  const corroboratedBy = new Map<string, number>()
  const rejectReason = new Map<string, number>()
  const marketOfMisses = new Map<string, number>()
  const toWrite: { id: string; name: string; url: string }[] = []

  for (const [productId, row] of hits) {
    if (considered >= LIMIT) break
    considered++
    const c = byId.get(productId)!
    const description = descriptions.get(row.fdcId) ?? ''
    const sourceUrl = `https://fdc.nal.usda.gov/food-details/${row.fdcId}/nutrients`

    if (!description) {
      noDescription++
      log(`NO DESCRIPTION  ${c.upc}  fdc_id ${row.fdcId} matched in branded_food.csv but food.csv has no description.`)
      continue
    }

    const why = corroboration(
      { brandOwner: row.brandOwner, brandName: row.brandName, subbrandName: row.subbrandName, description },
      c.legalName,
      c.dbaNames,
      ownerBrands.get(norm(row.brandOwner))
    )
    if (!why) {
      noCorroboration++
      log(
        `NO CORROBORATION  ${c.upc}  ours="${c.legalName}"  ` +
          `owner="${row.brandOwner}" brand="${row.brandName}" subbrand="${row.subbrandName}"  desc="${description}"`
      )
      log('  Left alone. Barcode agreement alone is not identity — best candidate for the photograph pass.')
      continue
    }

    const bad = nameAddsInformation(description, c.legalName)
    if (bad) {
      uselessDescription++
      rejectReason.set(bad, (rejectReason.get(bad) ?? 0) + 1)
      continue
    }

    adopted++
    corroboratedBy.set(why, (corroboratedBy.get(why) ?? 0) + 1)
    if (/[A-Z]/.test(description) && description === description.toUpperCase()) allCaps++
    if (description.includes(',')) {
      const [head, tail] = [description.slice(0, description.lastIndexOf(',')), description.slice(description.lastIndexOf(',') + 1)]
      if (norm(tail) && norm(head).includes(norm(tail))) redundantTail++
    }
    log(
      `ADOPT  ${c.upc}  "${c.name}"  ->  "${description}"   ` +
        `(corroborated by ${why}; owner="${row.brandOwner}" brand="${row.brandName}" subbrand="${row.subbrandName}"; fdc_id ${row.fdcId}${row.marketCountry ? `; ${row.marketCountry}` : ''}${row.discontinued ? '; DISCONTINUED' : ''})`
    )
    toWrite.push({ id: c.id, name: description, url: sourceUrl })
  }

  // Why the unmatched ones were unmatched, as far as the file can say.
  for (const c of candidates) {
    if (hits.has(c.id)) continue
    marketOfMisses.set('not in branded_food.csv', (marketOfMisses.get('not in branded_food.csv') ?? 0) + 1)
  }

  if (!DRY_RUN && toWrite.length > 0) {
    log(`\nWriting ${toWrite.length.toLocaleString()} names...`)
    let written = 0
    for (const w of toWrite) {
      try {
        await prisma.product.update({
          where: { id: w.id },
          data: {
            name: w.name,
            nameSource: NAME_SOURCE,
            nameSourceUrl: w.url,
            nameCheckedAt: new Date(),
          },
        })
        written++
      } catch (e) {
        logError(`Update failed for ${w.id}:`, e)
      }
    }
    log(`  ${written.toLocaleString()} written.`)
  }

  const mins = ((Date.now() - started) / 60000).toFixed(1)
  log(`\n===== ${DRY_RUN ? 'DRY RUN — nothing was written' : 'RECOVERY COMPLETE'} (${mins} min) =====`)
  log(`Candidates: ${candidates.length.toLocaleString()}`)
  log(`  matched by barcode in FDC: ${hits.size.toLocaleString()}`)
  log(`  name adopted: ${adopted.toLocaleString()}`)
  log(`  matched but nothing corroborated the brand: ${noCorroboration.toLocaleString()}`)
  log(`  matched but description added nothing: ${uselessDescription.toLocaleString()}`)
  log(`  matched but food.csv had no description: ${noDescription.toLocaleString()}`)
  log(`  not in FDC at all: ${(candidates.length - hits.size).toLocaleString()}`)

  if (corroboratedBy.size > 0) {
    log('\nWhat corroborated the adoptions:')
    for (const [k, v] of [...corroboratedBy.entries()].sort((a, b) => b[1] - a[1])) {
      log(`    ${String(v).padStart(7)}  ${k}`)
    }
    log('    (brand_name and subbrand_name hits are records v1 rejected outright:')
    log('     it only ever read brand_owner. The owner-index line is rows whose')
    log('     own brand column is blank, corroborated from other rows by the')
    log('     same owner.)')
  }
  if (rejectReason.size > 0) {
    log('\nWhy descriptions were rejected:')
    for (const [k, v] of [...rejectReason.entries()].sort((a, b) => b[1] - a[1])) {
      log(`    ${String(v).padStart(7)}  ${k}`)
    }
  }
  if (allCaps > 0) {
    log(`\nAdoptions that are ALL CAPS: ${allCaps.toLocaleString()} — stored verbatim; titleCaseName() handles display.`)
  }
  if (redundantTail > 0) {
    log(`Adoptions with FDC's redundant tail clause ("X, X"): ${redundantTail.toLocaleString()}`)
    log('    Also stored verbatim. Trimming it belongs in productName.ts, and the')
    log('    trim must require full containment or a real flavour list loses its')
    log('    last item.')
  }
  log(`\nStill unnamed after this pass: ${(candidates.length - adopted).toLocaleString()}`)
  log('    The NO CORROBORATION ones have a candidate name worth CONFIRMING')
  log('    against the package photograph. The rest need a name read from it.')
  log('    Whatever survives both is what classify-unnameable-products.ts')
  log('    withholds as missing_info.')
  if (DRY_RUN) log('\nNothing was written. Read the ADOPT lines before running --live.')
  log(`\nLog written to ${path.resolve(LOG_FILE)}`)
}

main()

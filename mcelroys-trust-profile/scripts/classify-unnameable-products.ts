// WITHHOLD PRODUCT RECORDS THAT CANNOT SAY WHAT THE PRODUCT IS.
//
// Michael, 2026-10-25: "if the title is the same as the product without any
// additional information then it shouldnt go into the database because its
// not a real product unless the photo or barcode gives us more information
// about it in which case we should try to research to get the product name.
// If we cant in the end then it should be in a part of the database that has
// a 'missing info' category and doesnt get displayed on the website."
//
// This is the last step of that rule, and it runs AFTER the research steps.
// It sets Product.publicationStatus = 'missing_info', which the gate in
// src/lib/publication.ts keeps out of search, browse, related products, a
// company's product list and the product page itself.
//
// SCOPE: a product whose name, punctuation and case ignored, is IDENTICAL to
// its company's name. "Celsius" made by Celsius. The title repeats the line
// above it and tells a reader nothing.
//
// Deliberately not widened beyond that. A name like "Bla" on a pizza sauce is
// just as useless, but Michael's rule names one specific shape and widening a
// WITHHOLDING rule on my own judgement is not the kind of decision to take
// quietly — see the open question at the bottom of the report.
//
// WHAT SAVES A RECORD FROM BEING WITHHELD
//
// Anything in it that identifies the product independently of the name: a
// package photograph, an ingredient list, parsed ingredient categories,
// additives, label allergens, or label claims. Those are the records Michael's
// rule sends to research rather than to the bin, and as of 2026-10-27 that is
// 1,378 of 1,685 — overwhelmingly because they have a photograph, which is
// exactly the research step he named.
//
// So this script withholds only the records with NOTHING to research. 307 of
// them. Withholding the rest before the photograph pass has run would skip
// the step the rule specifies, and would take 525 ingredient lists off the
// site to fix a title.
//
// IT RUNS IN BOTH DIRECTIONS, and that matters more than the withholding.
//
// A gate that can only close is a trap: the barcode and the company in these
// records are real, and later passes — USDA, a package photograph, a user's
// camera — are expected to recover names. So every run also PROMOTES BACK any
// record already marked 'missing_info' whose name is no longer its company's
// name. Re-running this after any naming pass is how a recovered product
// returns to the site, and nobody has to remember to do it by hand.
//
// It only promotes records whose publicationNote is one of the name-related
// reasons, so a record withheld in future for some other cause cannot be
// released by accident.
//
// USAGE
//   npx tsc --noEmit
//   npx tsx scripts/classify-unnameable-products.ts --selftest
//   npx tsx scripts/classify-unnameable-products.ts            # dry run
//   npx tsx scripts/classify-unnameable-products.ts --live
//
// SAFE TO RE-RUN. Idempotent in both directions.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { PUBLICATION_NOTES, PUBLICATION_STATUSES } from '@/lib/publication'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const clientOptions = {
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0]
const prisma = new PrismaClient(clientOptions)

const args = process.argv.slice(2)
const DRY_RUN = !args.includes('--live')
const SELFTEST = args.includes('--selftest')

// NOTE: src/lib/publication.ts says display queries must filter through
// PUBLISHED_PRODUCTS and that scripts must NOT. This script is the reason the
// second half of that rule exists — it has to see withheld records in order to
// promote them back.
const PUBLISHED = PUBLICATION_STATUSES[0] // 'published'
const MISSING_INFO = PUBLICATION_STATUSES[1] // 'missing_info'

// The notes this script is allowed to release a record from. A record
// withheld in future for an unrelated reason must not be promoted just
// because it happens to have a name now.
const RELEASABLE_NOTES: string[] = [
  PUBLICATION_NOTES.nameIsCompanyName,
  PUBLICATION_NOTES.nameNotRecovered,
]

const LOG_FILE = path.join(
  './logs',
  `${DRY_RUN ? 'classify-unnameable-dryrun' : 'classify-unnameable'}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
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

// Said before anything else happens, so a run that dies early still points at
// a file worth reading.
log(`Log file: ${path.resolve(LOG_FILE)}`)

// --- THE TWO PREDICATES, kept pure so the selftest can reach them ---

/**
 * Same name, punctuation and case ignored. "M&M's" === "M&M'S" === "m m s".
 *
 * KEEPS LETTERS IN EVERY SCRIPT, drops only punctuation and spacing. An
 * earlier `[^a-z0-9]` deleted whole writing systems before comparing, so
 * "Doritos 美式 辣 起 士 口味" ("American spicy cheese flavour") tightened to
 * "doritos" and read as identical to company "Doritos" — a title that does
 * identify the product, judged to carry nothing. Same for "CJ 햇 고등어"
 * ("fresh mackerel") under company "CJ".
 *
 * Only 2 records today, but OFF is a global dataset and this is the gate's
 * core predicate: it must not conclude "this name says nothing" from
 * characters it declined to read. Accents survive on both sides, so the
 * apostrophe and accent cases in the selftest are unaffected.
 */
export function nameIsCompanyName(productName: string, legalName: string): boolean {
  const tight = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const a = tight(productName)
  const b = tight(legalName)
  return a.length > 0 && a === b
}

// --- DOES THE NAME ITSELF NAME A FOOD? ---
//
// WHY THIS EXISTS. The first dry run would have withheld 307 records, and
// reading the sample showed 64 of them (21%) had names that tell a reader
// exactly what the product is:
//
//   "Russet Potatoes"  "Bowl Noodles"      "Great American Shrimp"
//   "Lion Raisins"     "Compound Coffee"   "Hillandale Brick Cheese"
//   "Peedan Preserved Egg"                 "Corn"
//
// These records are identical by construction — the Company row was created
// FROM the Open Food Facts free-text brand field, so name and company match
// whatever the name says. So "name equals company name" is only a PROXY for
// "the title carries no product information", and for a fifth of them the
// proxy is wrong.
//
// Michael's rule is "the same as the product WITHOUT ANY ADDITIONAL
// INFORMATION". "Russet Potatoes" is additional information, so this check
// implements the rule more faithfully rather than overriding it.
//
// THE VOCABULARY IS DERIVED FROM OUR OWN DATA, not hand-written: single-word
// ingredient names that appear on enough products to be real, plus every
// Product.category word. Same principle as the owner→brand index in
// recover-product-names.ts — derive the test from the dataset so it stays
// current instead of drifting from a list someone typed once.
//
// SINGLE-WORD VOCABULARY ENTRIES ONLY. Splitting multi-word entries pulls in
// "live" (from "live active cultures"), "natural", "modified", "color" and
// "flavor", none of which are food nouns, and all of which would make brand
// names look descriptive.
//
// IT ERRS TOWARD KEEPING, which is the right direction for a rule that hides
// things. "Dr. Pepper" matches on "pepper" and is not really a pepper
// product — so it stays published. A false keep costs a slightly thin page; a
// false withhold removes a page a reader could have used.
//
// SCOPE — READ BEFORE CALLING. This is only meaningful on a name that DIFFERS
// from its company name. Where name == company name, every word in the name is
// the company's own word, so a food word here is a brand's word and says
// nothing about the product; calling it there published 301 pages whose whole
// content was a brand name. It is retained, exported and tested for the
// widened rule (names like "Bla" or a bare "Berry" that are NOT the company
// name), where a food word genuinely is additional information.
export function nameNamesAFood(productName: string, vocabulary: Set<string>): string | null {
  const words = productName
    .replace(/[^a-zA-Z]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3)
  for (const w of words) {
    if (vocabulary.has(w)) return w
    // Crude de-pluralising, checked against the vocabulary rather than
    // applied blindly: "Potatoes" -> potato, "Noodles" -> noodle,
    // "Raisins" -> raisin, "Fruits" -> fruit.
    if (w.length > 3 && w.endsWith('es') && vocabulary.has(w.slice(0, -2))) return w.slice(0, -2)
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && vocabulary.has(w.slice(0, -1))) {
      return w.slice(0, -1)
    }
  }
  return null
}

export type Identifiers = {
  imageUrl: string | null
  ingredientsTextRaw: string | null
  ingredientCategories: string[]
  additiveENumbers: string[]
  labelAllergens: string[]
  labelClaims: string[]
}

/**
 * Does this record carry anything that says what the product is, apart from
 * its name? If so Michael's rule sends it to research, not to missing_info.
 */
export function identifiesTheProduct(p: Identifiers): string | null {
  if (p.imageUrl && p.imageUrl.trim() !== '') return 'has a package photograph'
  if (p.ingredientsTextRaw && p.ingredientsTextRaw.trim() !== '') return 'has an ingredient list'
  if (p.ingredientCategories.length > 0) return 'has parsed ingredient categories'
  if (p.additiveENumbers.length > 0) return 'has additives on file'
  if (p.labelAllergens.length > 0) return 'has label allergens on file'
  if (p.labelClaims.length > 0) return 'has label claims on file'
  return null
}

// Built from the database so it cannot drift. The threshold keeps one-off
// junk ingredient rows out: a word has to appear on 300+ products to count as
// a food noun the catalogue actually uses.
const VOCAB_MIN_PRODUCTS = 300

// PRODUCT-TYPE NOUNS THE INGREDIENT TABLE CANNOT SUPPLY.
//
// The derived vocabulary is built from `Ingredient` and `Product.category`,
// and that is the right source for INGREDIENT words — but these names are
// about PRODUCT TYPES, and nobody lists "muesli" or "pizza" as an ingredient.
// The first run with the derived vocabulary alone would still have withheld:
//
//   "Hatch Chile World"         (the table has "chili", not "chile")
//   "Colorado Mountain Muesli"  (muesli is not an ingredient at any threshold)
//   "Pure protein"              (only "milk protein", "whey protein", ...)
//
// So this is hand-written, and deliberately so — it is the one part of the
// vocabulary that cannot be derived. Kept short and restricted to words that
// are unambiguously a kind of food or drink: a long list becomes its own
// liability, and anything debatable belongs in the derived half or nowhere.
//
// Adding a word here can only ever KEEP a record published, never withhold
// one, so the failure mode of a wrong entry is a slightly thin page.
export const PRODUCT_TYPE_WORDS = [
  // the three the first run got wrong
  'chile', 'muesli', 'protein',
  // prepared and packaged foods
  'pizza', 'ramen', 'noodle', 'pasta', 'jerky', 'donut', 'doughnut', 'bagel',
  'taco', 'burrito', 'salsa', 'hummus', 'granola', 'sausage', 'salami',
  'tofu', 'tempeh', 'kimchi', 'miso', 'curry', 'pesto', 'falafel', 'dumpling',
  'sushi', 'burger', 'nugget', 'patty', 'stew', 'chowder', 'oatmeal',
  'porridge', 'waffle', 'pancake', 'biscuit', 'cracker', 'chip', 'crisp',
  'pretzel', 'popcorn', 'brownie', 'muffin', 'scone', 'croissant', 'tortilla',
  // dairy and desserts
  'gelato', 'sorbet', 'pudding', 'custard', 'kefir', 'ghee', 'curd', 'paneer',
  'feta', 'brie', 'cheddar', 'gouda', 'mozzarella', 'ricotta',
  // drinks
  'smoothie', 'latte', 'espresso', 'cappuccino', 'matcha', 'chai', 'lemonade',
  'kombucha', 'seltzer', 'cider', 'ale', 'lager', 'stout', 'wine', 'whisky',
  'whiskey', 'vodka', 'tequila', 'rum', 'gin',
] as const

export async function loadFoodVocabulary(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ w: string }[]>`
    SELECT DISTINCT lower(name) AS w
      FROM "Ingredient"
     WHERE "productCount" >= ${VOCAB_MIN_PRODUCTS}
       AND name !~ '\s'
    UNION
    SELECT DISTINCT lower(w) FROM (
      SELECT unnest(string_to_array(regexp_replace(category, '[^a-zA-Z ]', ' ', 'g'), ' ')) AS w
        FROM "Product" WHERE category IS NOT NULL
    ) c
     WHERE length(w) >= 3
  `
  const v = new Set<string>()
  for (const r of rows) {
    const w = r.w.trim()
    if (w.length >= 3 && !/\s/.test(w)) v.add(w)
  }
  for (const w of PRODUCT_TYPE_WORDS) v.add(w)
  return v
}

type Row = {
  id: string
  name: string
  upc: string | null
  legalName: string
  publicationStatus: string
  publicationNote: string | null
  imageUrl: string | null
  ingredientsTextRaw: string | null
  ingredientCategories: string[]
  additiveENumbers: string[]
  labelAllergens: string[]
  labelClaims: string[]
}

// Raw SQL because the name/company comparison is between two columns across a
// join, which a Prisma where clause cannot express. Loads BOTH directions in
// one query: everything whose name matches its company (candidates to
// withhold) and everything already withheld (candidates to promote).
async function load(): Promise<Row[]> {
  return prisma.$queryRaw<Row[]>`
    SELECT p.id, p.name, p.upc, c."legalName",
           p."publicationStatus", p."publicationNote",
           p."imageUrl", p."ingredientsTextRaw",
           p."ingredientCategories", p."additiveENumbers",
           p."labelAllergens", p."labelClaims"
      FROM "Product" p
      JOIN "Company" c ON c.id = p."companyId"
     WHERE lower(regexp_replace(p.name,        '[^a-zA-Z0-9]+', '', 'g'))
         = lower(regexp_replace(c."legalName", '[^a-zA-Z0-9]+', '', 'g'))
        OR p."publicationStatus" <> ${PUBLISHED}
     ORDER BY p.id
  `
}

// The company name is printed only when it differs in spelling from the
// product name — they are equal by the rule that selected these rows, so
// repeating an identical string on every line is noise.
function a_eq(a: string, b: string): boolean {
  return a === b
}

function selfTest(): boolean {
  let failures = 0
  function check(label: string, got: unknown, want: unknown) {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) failures++
    log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}  (expected ${JSON.stringify(want)}, got ${JSON.stringify(got)})`)
  }
  const bare: Identifiers = {
    imageUrl: null, ingredientsTextRaw: null,
    ingredientCategories: [], additiveENumbers: [], labelAllergens: [], labelClaims: [],
  }

  log('\nIs the name just the company name?')
  check('exact', nameIsCompanyName('Celsius', 'Celsius'), true)
  check('case ignored', nameIsCompanyName('hills bros', 'Hills Bros'), true)
  check('punctuation ignored', nameIsCompanyName("M&M's", 'M&M’S'), true)
  check('spacing ignored', nameIsCompanyName('da fruta', 'DaFruta'), true)
  // Must NOT fire: the name says more than the company does. These are the
  // records the whole exercise is for, and withholding one would be the
  // opposite of the intent.
  check('name says more', nameIsCompanyName('Celsius Energy Drink', 'Celsius'), false)
  check('company says more', nameIsCompanyName('Celsius', 'Celsius Holdings Inc'), false)
  check('different', nameIsCompanyName('Oreo', 'Mondelez'), false)
  // A near-miss is not a match — our "Tolberone" typo must not be treated as
  // equal to anything.
  check('misspelling', nameIsCompanyName('Tolberone', 'Toblerone'), false)
  check('empty name never matches', nameIsCompanyName('', ''), false)
  check('punctuation-only name never matches', nameIsCompanyName('---', '---'), false)
  // Non-Latin descriptive text is information, not noise. A tightener that
  // deletes the script it cannot read concludes "this name says nothing"
  // about a name that says plenty.
  check('CJK flavour text is not the bare brand',
    nameIsCompanyName('Doritos 美式 辣 起 士 口味', 'Doritos'), false)
  check('Hangul product text is not the bare brand',
    nameIsCompanyName('CJ 햇 고등어', 'CJ'), false)
  // ...while the cases the old tightener got right must stay right: a curly
  // apostrophe against a straight one is still the same name.
  check('curly vs straight apostrophe still matches',
    nameIsCompanyName('Welch\u2019s', "Welch's"), true)
  check('accents match themselves', nameIsCompanyName('Nescafé', 'NESCAFÉ'), true)

  log('\nDoes the name itself name a food?')
  const v = new Set(['potato', 'noodle', 'shrimp', 'cheese', 'raisin', 'coffee', 'egg', 'corn', 'pepper'])
  // The 21% the first dry run would have wrongly withheld.
  check('Russet Potatoes', nameNamesAFood('Russet Potatoes', v), 'potato')
  check('Bowl Noodles', nameNamesAFood('Bowl Noodles', v), 'noodle')
  check('Great American Shrimp', nameNamesAFood('Great American Shrimp', v), 'shrimp')
  check('Lion Raisins', nameNamesAFood('Lion Raisins', v), 'raisin')
  check('Peedan Preserved Egg', nameNamesAFood('Peedan Preserved Egg', v), 'egg')
  check('Corn (one word, no plural)', nameNamesAFood('Corn', v), 'corn')
  // Must NOT fire on brand names that happen to look wordy.
  check('Bertzgni', nameNamesAFood('Bertzgni', v), null)
  check('Bowl & Basket', nameNamesAFood('Bowl & Basket', v), null)
  check('Bubblr', nameNamesAFood('Bubblr', v), null)
  // Words under three letters are ignored, so an initialism cannot match.
  check('BSN', nameNamesAFood('BSN', v), null)
  // De-pluralising is checked against the vocabulary, never applied blindly:
  // "Potatoe" is not a word and "pota" is not in the vocabulary.
  check('a non-word is not forced into a match', nameNamesAFood('Zephyrhills', v), null)
  check('empty name', nameNamesAFood('', v), null)
  check('an empty vocabulary matches nothing', nameNamesAFood('Russet Potatoes', new Set()), null)

  // WHY THIS FUNCTION IS NOT IN THE DECISION PATH. Each of these names is
  // identical to its company name, so the food word it matches on is the
  // brand's own word and tells a reader nothing about the product. These
  // assertions are not describing desired behaviour — they are recording the
  // behaviour that published 301 brand-name-only pages, so that wiring this
  // back into the name==company branch fails review instead of shipping.
  const brandVocab = new Set(['oat', 'protein', 'chile', 'muesli'])
  check('"Quaker Oats" would fire on its own brand word', nameNamesAFood('Quaker Oats', brandVocab), 'oat')
  check('"Pure Protein" would fire on its own brand word', nameNamesAFood('Pure Protein', brandVocab), 'protein')
  check('"Hatch Chile World" would fire on its own brand word', nameNamesAFood('Hatch Chile World', brandVocab), 'chile')
  check('"Colorado Mountain Muesli" would fire on its own brand word', nameNamesAFood('Colorado Mountain Muesli', brandVocab), 'muesli')

  log('\nDoes the record identify the product some other way?')
  check('nothing at all', identifiesTheProduct(bare), null)
  check('a photograph saves it',
    identifiesTheProduct({ ...bare, imageUrl: 'https://images.openfoodfacts.org/x.jpg' }),
    'has a package photograph')
  check('an ingredient list saves it',
    identifiesTheProduct({ ...bare, ingredientsTextRaw: 'water, sugar' }),
    'has an ingredient list')
  check('parsed categories save it',
    identifiesTheProduct({ ...bare, ingredientCategories: ['sweetener'] }),
    'has parsed ingredient categories')
  check('additives save it',
    identifiesTheProduct({ ...bare, additiveENumbers: ['e330'] }), 'has additives on file')
  check('allergens save it',
    identifiesTheProduct({ ...bare, labelAllergens: ['milk'] }), 'has label allergens on file')
  check('claims save it',
    identifiesTheProduct({ ...bare, labelClaims: ['en:organic'] }), 'has label claims on file')
  // An empty string is not a photograph. The column is nullable AND the
  // backfill writes '' in some older rows, so both have to count as absent or
  // a record with no photo would be treated as researchable forever.
  check('empty-string photo does NOT save it',
    identifiesTheProduct({ ...bare, imageUrl: '   ' }), null)
  check('empty-string ingredients do NOT save it',
    identifiesTheProduct({ ...bare, ingredientsTextRaw: '' }), null)

  log(failures === 0 ? '\nAll self-tests passed.' : `\n${failures} self-test(s) FAILED.`)
  return failures === 0
}

async function main() {
  if (SELFTEST) {
    log('SELF TEST — no database')
    if (!selfTest()) process.exitCode = 1
    return
  }

  log(`${DRY_RUN ? 'DRY RUN' : 'LIVE RUN'} — classifying products whose name is their company name.`)
  const rows = await load()
  log(`Loaded ${rows.length.toLocaleString()} rows (name matches its company, or already withheld).`)

  const toWithhold: Row[] = []
  const toPromote: Row[] = []
  let researchable = 0
  let alreadyCorrect = 0
  let heldForAnotherReason = 0
  // Rows the SQL loaded on a loose match that the exact predicate then
  // rejected. Counted so every loaded row lands in exactly one bucket and
  // the totals close against "Loaded N rows" — a report whose numbers do not
  // reconcile hides the next real bug in the gap.
  let noLongerInScope = 0
  const savedBy = new Map<string, number>()
  const samplesWithhold: string[] = []
  const samplesPromote: string[] = []

  for (const r of rows) {
    const unnameable = nameIsCompanyName(r.name, r.legalName)

    if (!unnameable) {
      // Only reachable for rows loaded by the second half of the WHERE: this
      // record is withheld but its name is no longer its company's name, so a
      // naming pass has fixed it.
      if (r.publicationStatus === MISSING_INFO) {
        if (r.publicationNote && RELEASABLE_NOTES.includes(r.publicationNote)) {
          toPromote.push(r)
          if (samplesPromote.length < 15) {
            samplesPromote.push(`${r.upc ?? '(no barcode)'}  "${r.name}"  (was withheld as: ${r.publicationNote})`)
          }
        } else {
          heldForAnotherReason++
        }
      } else {
        // Published, and its name is NOT its company's name — so the gate has
        // no business with it. Reached because the loader's SQL comparison is
        // looser than nameIsCompanyName: it is how "Doritos 美式 辣 起 士 口味"
        // and "CJ 햇 고등어" leave scope now that the predicate reads every
        // script instead of deleting the ones it cannot.
        noLongerInScope++
      }
      continue
    }

    // NO FOOD-WORD GUARD HERE, AND THIS IS DELIBERATE.
    //
    // Reaching this line means nameIsCompanyName(r.name, r.legalName) is true:
    // the product name IS the company name, character for character once case
    // and punctuation are ignored. So any food word found in the name is a food
    // word in the COMPANY'S OWN NAME, and it is not additional information
    // about the product by definition — there is no room in the string for
    // any.
    //
    // "Quaker Oats" does not say whether the record is instant oatmeal,
    // steel-cut oats or a granola bar. "Pure Protein" does not say whether it
    // is a bar or a shake. "Hatch Chile World" is a company. Keeping these
    // published on the strength of "oats", "protein" and "chile" published 301
    // pages whose entire content was a brand name — exactly the faulty record
    // the rule exists to prevent.
    //
    // nameNamesAFood is kept and still tested, because it IS valid on a name
    // that differs from the company name (the widened rule in the open
    // question below). It is simply void on this population.
    const saved = identifiesTheProduct(r)
    if (saved) {
      researchable++
      savedBy.set(saved, (savedBy.get(saved) ?? 0) + 1)
      // A record that is researchable must be PUBLISHED. If a previous run
      // withheld it and it has since gained a photograph, release it.
      if (r.publicationStatus === MISSING_INFO && r.publicationNote && RELEASABLE_NOTES.includes(r.publicationNote)) {
        toPromote.push(r)
        if (samplesPromote.length < 15) {
          samplesPromote.push(`${r.upc ?? '(no barcode)'}  "${r.name}"  (now ${saved})`)
        }
      }
      continue
    }

    if (r.publicationStatus === MISSING_INFO) {
      alreadyCorrect++
      continue
    }
    toWithhold.push(r)
  }

  log(`\nTo withhold: ${toWithhold.length.toLocaleString()}`)
  log(`To promote back: ${toPromote.length.toLocaleString()}`)
  log(`Already withheld and still correct: ${alreadyCorrect.toLocaleString()}`)
  log(`Name still useless but researchable, left published: ${researchable.toLocaleString()}`)
  if (heldForAnotherReason > 0) {
    log(`Withheld for a reason this script does not release: ${heldForAnotherReason.toLocaleString()}`)
  }
  if (noLongerInScope > 0) {
    log(`Loaded but not actually named after their company, left alone: ${noLongerInScope.toLocaleString()}`)
  }
  const accounted =
    toWithhold.length + toPromote.length + alreadyCorrect + researchable +
    heldForAnotherReason + noLongerInScope
  if (accounted !== rows.length) {
    log(`\n!! ACCOUNTING DOES NOT CLOSE: ${accounted.toLocaleString()} of ${rows.length.toLocaleString()} loaded rows are accounted for.`)
    log('   Every loaded row must land in exactly one bucket. A gap here means')
    log('   a branch is falling through silently — fix that before trusting')
    log('   any number above.')
    process.exitCode = 1
  } else {
    log(`(All ${rows.length.toLocaleString()} loaded rows accounted for.)`)
  }

  if (savedBy.size > 0) {
    log('\nWhat is keeping the researchable ones published:')
    for (const [k, v] of [...savedBy.entries()].sort((a, b) => b[1] - a[1])) {
      log(`    ${String(v).padStart(7)}  ${k}`)
    }
    log('    These go to the photograph pass; withholding them now would skip')
    log('    the research step the rule specifies.')
    log('')
    log('    CAVEAT on "has a package photograph", which is doing most of the')
    log('    work above: we cannot yet tell a photograph of the PACKAGE from a')
    log('    photograph of the NUTRITION PANEL. A page titled with nothing but')
    log('    a brand name, over a picture of a nutrition label, is a faulty')
    log('    record by our own standard. The image classifier is what closes')
    log('    this, and until it runs these keeps are provisional.')
  }

  if (toWithhold.length > 0) {
    // EVERY ONE, not a sample. These are pages that will stop existing, the
    // list is short enough to read, and no heuristic should get the last word
    // on it. If a name in here still tells you what the product is, the
    // vocabulary is missing a word and that is a one-line fix — which is
    // exactly the kind of thing a 20-row sample hides.
    log(`\nEVERY record that would be withheld (${toWithhold.length.toLocaleString()}) — read this before --live:`)
    for (const r of [...toWithhold].sort((a, b) => a.name.localeCompare(b.name))) {
      const same = a_eq(r.name, r.legalName) ? '' : `  (company "${r.legalName}")`
      log(`    ${(r.upc ?? '(no barcode)').padEnd(15)}  "${r.name}"${same}`)
    }
  }
  if (samplesPromote.length > 0) {
    log('\nSamples of what would be promoted back:')
    for (const s of samplesPromote) log(`    ${s}`)
  }

  if (!DRY_RUN) {
    if (toWithhold.length > 0) {
      log(`\nWithholding ${toWithhold.length.toLocaleString()}...`)
      let n = 0
      for (const r of toWithhold) {
        try {
          await prisma.product.update({
            where: { id: r.id },
            data: {
              publicationStatus: MISSING_INFO,
              publicationNote: PUBLICATION_NOTES.nameIsCompanyName,
            },
          })
          n++
        } catch (e) {
          logError(`Withhold failed for ${r.id}:`, e)
        }
      }
      log(`  ${n.toLocaleString()} withheld.`)
    }
    if (toPromote.length > 0) {
      log(`\nPromoting ${toPromote.length.toLocaleString()} back...`)
      let n = 0
      for (const r of toPromote) {
        try {
          await prisma.product.update({
            where: { id: r.id },
            data: { publicationStatus: PUBLISHED, publicationNote: null },
          })
          n++
        } catch (e) {
          logError(`Promote failed for ${r.id}:`, e)
        }
      }
      log(`  ${n.toLocaleString()} promoted.`)
    }
  }

  log(`\n===== ${DRY_RUN ? 'DRY RUN — nothing was written' : 'CLASSIFICATION COMPLETE'} =====`)
  log('\nOPEN QUESTION for Michael, not decided here. This withholds only the')
  log('one shape his rule named: a name identical to the company name. A name')
  log('like "Bla" on a pizza sauce, or a bare "Berry", is just as useless to a')
  log('reader but is not covered, and widening a rule that HIDES records is')
  log('not a call to make quietly. If it should widen, the measurement to ask')
  log('for first is how many such records also have nothing else on file.')
  if (DRY_RUN) log('\nNothing was written. Read the samples above before running --live.')
  log(`\nLog written to ${path.resolve(LOG_FILE)}`)
}

main()

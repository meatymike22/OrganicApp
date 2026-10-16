// BACKFILL THE PRODUCT-LEVEL COLUMNS FROM THE OPEN FOOD FACTS EXPORT.
//
// Phase 1 step 3. Written 2026-10-13, after scripts/probe-off-labels.ts
// measured the export and reported what is actually in it.
//
// WHAT THIS WRITES, and the backlog item each one closes:
//
//   labelClaims            item 18   organic / non-GMO / gluten-free as the
//                                    LABEL claims them. 6.1% of export
//                                    records carry an organic tag; we hold
//                                    40 organic rows across 416,382 products.
//   additiveENumbers       item NEW  INS numbers (= EU E-numbers), on 56.1%
//                                    of records.
//   labelAllergens         item 22   the label's own "Contains:" line, on
//                                    55.1% of records.
//   labelAllergenTraces    item 22   the "may contain" line. Only 2.4% of
//                                    records, and we cannot derive it at all.
//   ingredientsTextRaw     item 40   the ingredient list verbatim, so our
//                                    transcription becomes auditable.
//   ingredientsTextLang    item 36   the Norwegian-Snickers bug: 4.4% of
//                                    records have ingredient text but no
//                                    English text.
//   imageWidth/Height      item 32   if the export carries sizes. See below.
//
// WHAT THIS DELIBERATELY DOES NOT WRITE, and why that is not a shortcut:
//
//   THE NESTED INGREDIENT TREE (item 39) and Ingredient.offTaxonomyId. The
//   export does ship the tree, which is the best news the probe found: 90.6%
//   of records carry a parsed `ingredients` array and 115,774 of those
//   already have nested children. But storing it means resolving ingredient
//   names against our 127,268-row Ingredient table and possibly creating
//   rows in it, and that table feeds every allergen and exclusion filter on
//   the site. It gets its own script and its own dry run read by a person.
//   Round 13's lesson is the reason: a dry run that prints the largest
//   changes is a good report and a bad audit, and the ingredient graph is
//   where that costs the most.
//
//   THE IMAGE RE-RUN (item 27, the 34,624 products still stamped "never
//   looked"). scripts/backfill-off-images.ts already does that job correctly.
//   A second implementation of the same matching and the same host allowlist
//   would disagree with the first eventually — that is item 20's lesson, and
//   this project has now paid it four times. This script REPORTS whether the
//   export carries image sizes so that work can be a small addition there,
//   and writes dimensions only for products it is already updating.
//
// THE THREE-STATE RULE IS THE WHOLE POINT OF THIS SCRIPT.
//
// Every column group here is a (value, source, checkedAt) triple, and this
// script sets checkedAt FOR EVERY PRODUCT IT MATCHES, including the ones
// where the answer is "the label claims nothing". An empty array with a
// checkedAt set means we read the export and there was nothing. An empty
// array with a null checkedAt means nobody has looked. Those are different
// statements and the site says different things about them.
//
// Item 27 is what collapsing them costs: 34,624 products are permanently
// stamped "never looked" for their photograph because a backfill ran before
// that distinction existed. This script is written so that cannot recur —
// see flushBatch(), where checkedAt is NOT conditional on finding anything.
//
// DRY RUN BY DEFAULT. Pass --live to write. Reads the export once.
//
//   npx tsx scripts/backfill-off-export.ts ./data/openfoodfacts-products.jsonl.gz
//   npx tsx scripts/backfill-off-export.ts ./data/openfoodfacts-products.jsonl.gz --live
//
// Flags:
//   --live            actually write
//   --limit N         stop after N matched products (for a quick look)
//   --batch N         rows per progress batch, default 500
//   --recheck         also revisit products whose checkedAt is already set
//   --only a,b,c      only these groups: labels, additives, allergens, text
//
// Safe to interrupt. The log is written as it goes, and a partial run leaves
// the products it reached correctly stamped and the rest untouched.

// MUST BE THE FIRST IMPORT. tsx does not read .env on its own, so without
// this DATABASE_URL is undefined, PrismaPg is constructed with no connection
// string, and Prisma fails on the FIRST query with
// "Invalid `prisma.product.findMany()` invocation" — which reads like a bad
// query and is actually a missing environment variable. Every other database
// script in this directory opens with this line; the first version of this
// one was built from probe-off-labels.ts, which touches no database and
// therefore did not need it.
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { StringDecoder } from 'node:string_decoder'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { normalizeUpc } from '@/lib/upc'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

// THE TWO OPTIONS BELOW ARE NOT DEFAULTS, and both come from scripts that
// already learned this the hard way.
//
// queryPlanCacheMaxSize: 0 — bulk-import-off.ts and backfill-off-images.ts
// both set it. Every write embeds different values, so a cached plan is
// never reused and the cache simply grows until the process runs out of
// memory. This script issues roughly 383,000 updates over 416,382 products,
// which is well into the range where that happens.
//
// transactionOptions — NO LONGER LOAD-BEARING, and the comment is corrected
// rather than left to mislead. It was raised to 120 s because the write path
// wrapped 500 updates in one interactive transaction; the first live run then
// took 120,062 ms and died anyway. flushBatch() no longer uses a transaction
// at all (see the note there), so nothing in this script can hit this
// timeout. The option is kept only so that a future transaction here does not
// silently inherit the 5-second default.
const clientOptions = {
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0]
const prisma = new PrismaClient(clientOptions)

const args = process.argv.slice(2)
const FILE = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a))
const DRY_RUN = !args.includes('--live')
const RECHECK = args.includes('--recheck')
function argValue(name: string): string | null {
  const i = args.indexOf(name)
  return i === -1 ? null : (args[i + 1] ?? null)
}
const LIMIT = argValue('--limit') ? Number(argValue('--limit')) : Infinity
const BATCH_SIZE = argValue('--batch') ? Number(argValue('--batch')) : 500
const PROGRESS_EVERY = 250_000
const SOURCE = 'open_food_facts'

// WHICH GROUPS TO RUN. All of them by default. This exists so a single group
// can be re-run after a wording or mapping change without a second 7 GB read
// of the other three — not so groups get run one at a time, which is the
// nine-separate-passes mistake this whole phase exists to avoid.
const ALL_GROUPS = ['labels', 'additives', 'allergens', 'text'] as const
type Group = (typeof ALL_GROUPS)[number]
const onlyArg = argValue('--only')
const GROUPS = new Set<Group>(
  onlyArg
    ? (onlyArg.split(',').map((s) => s.trim()) as Group[]).filter((g) =>
        (ALL_GROUPS as readonly string[]).includes(g)
      )
    : ALL_GROUPS
)
if (onlyArg && GROUPS.size === 0) {
  console.error(`--only did not name any known group. Known: ${ALL_GROUPS.join(', ')}`)
  process.exit(1)
}

// ---------------------------------------------------------------- logging --
// Same convention as every other script in scripts/: written as it goes, so
// an interrupted run still leaves a record of how far it got.
const LOG_FILE = path.join(
  './logs',
  `backfill-off-export-${DRY_RUN ? 'dryrun-' : ''}${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
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

// ------------------------------------------------------------ tag filters --
// WHICH LABEL TAGS WE KEEP.
//
// The export has hundreds of distinct label tags, most of them country
// marketing schemes ("fr:entrepreneurs-engages", "en:made-in-germany") that
// say nothing a shopper here is asking. Keeping everything would mean
// storing noise and then filtering it at render time on every page view.
//
// So this is an allowlist, and it is deliberately narrow: the claims the app
// already has a question for, plus the ones it is about to. Anything not in
// here is counted in the log under "label tags seen and not kept", so the
// list can be widened on evidence rather than on guesswork.
const KEEP_LABEL = new Set([
  'en:organic', 'en:usda-organic', 'en:eu-organic', 'en:canada-organic',
  'fr:ab-agriculture-biologique',
  'en:no-gmos', 'en:non-gmo-project', 'en:non-gmo-project-verified',
  'en:no-gluten', 'en:certified-gluten-free',
  'en:vegan', 'en:vegetarian', 'en:kosher', 'en:halal',
  'en:fair-trade', 'en:fairtrade-international',
  'en:no-preservatives', 'en:no-artificial-flavors', 'en:no-colorings',
  'en:no-added-sugar', 'en:no-lactose',

  // WIDENED 2026-10-14 after reading the first dry run's dropped-tag list.
  //
  // THE PRINCIPLE, taken straight from this project's legal posture: a
  // specific, attributable claim is both more useful and safer than a vague
  // one. Every tag below NAMES A CERTIFIER for a claim the list already
  // keeps in generic form, so dropping them was keeping the weaker version
  // of the same fact. "Orthodox Union kosher" is a checkable record;
  // "kosher" on its own is a category.
  'en:orthodox-union-kosher',       // 4,239 products, against 7,988 for bare en:kosher
  'en:kosher-parve',                // 256
  'en:vegan-action',                // 814 — a vegan certifier
  'en:rainforest-alliance',         // 292 — same class as fair-trade, already kept
  'en:sustainable-fishery',         // 356
  'en:sustainable-seafood-msc',     // 354 — names the MSC scheme
  'en:certified-b-corporation',     // 394

  // Free-from claims that are near-duplicates of ones already kept. Keeping
  // "no colorings" while dropping "no artificial colors" was arbitrary.
  'en:no-artificial-colors',        // 328
  'en:no-additives',                // 395
  'en:no-bisphenol-a',              // 344 — a packaging claim, and a specific one
])

// DELIBERATELY STILL EXCLUDED, with the reason, so this is a decision and
// not an oversight:
//
//   en:no-milk (342), en:no-soy (337) and the other allergen free-from tags.
//   These are real label claims and they would be honest in labelClaims. They
//   are left out because the moment they exist, some surface will read them
//   to answer "is this dairy free", and that is the one topic where this
//   project has already decided wording must be got right once rather than
//   shipped and revised (items 23 and 31). They go in only together with a
//   stated rule about what they may and may not be used to say.
//
//   en:100-natural (379), en:verified (215), en:keto (303), en:sustainable
//   (542), en:no-cholesterol (586), en:low-or-no-sugar (278), en:no-sugar
//   (229), en:low-or-no-fat (204), en:source-of-fibre (201),
//   en:natural-flavors (256), en:made-in-italy (456), en:green-dot (429),
//   fr:entrepreneurs-engages (200). Vague, unattributable, or marketing
//   geography. "100% natural" has no definition behind it, which is exactly
//   the kind of claim this site exists not to repeat.

// AN INS / E-NUMBER TAG AS OFF WRITES IT.
//
// CORRECTED 2026-10-14 AFTER THE FIRST DRY RUN, and the way it was wrong is
// worth keeping. The first version was /^en:e(\d{3,4})([a-z]{0,2})$/i, built
// from the probe's report that 2,359 tags "are not e-numbers at all".
//
// The probe used THE SAME REGEX to produce that number. So the figure was not
// a measurement of the data, it was a measurement of my regex, and copying it
// into the code propagated the error instead of catching it. The dry run is
// what exposed it, because it printed the tags it dropped:
//
//     819  en:e450iii      651  en:e339iii      359  en:e340iii
//     242  en:e331iii      199  en:e341iii        9  en:e160bii
//       3  en:e333iii        3  en:e450vii        2  en:e160aii
//
// Those are all real INS numbers. The roman-numeral suffix identifies the
// specific salt (E450iii is sodium polyphosphate), and it runs to at least
// vii, so a two-letter cap threw away 2,291 valid additive identities.
//
// THE LESSON, because this project keeps relearning it: a probe reports what
// its own filters let through. Any count a probe labels "invalid" has to be
// re-derived from the raw values before it is trusted, and the fastest way to
// do that is to make the script PRINT WHAT IT DROPPED, which is what caught
// this one.
//
// Four letters is the ceiling: a letter plus a roman numeral (e160bii).
// Any two-letter language prefix is accepted, not just en: — "xx:e386" is the
// same additive with a different namespace, and the namespace is OFF's, not
// the standard's.
const ENUMBER_TAG = /^[a-z]{2}:e(\d{3,4})([a-z]{0,4})$/i

// WHAT STILL GETS DROPPED, correctly, and all of it verified against the
// dry run's own output:
//   en:e14xx                  a WILDCARD placeholder, not an additive. Only
//                             two digits before the letters, so the \d{3,4}
//                             above rejects it without a special case.
//   en:potassium-iodide       a name, not a number
//   en:amino-acids            a class, not a number
//   en:organic-acids          a class
//   en:methylsulfonylmethane  a name
// About 913 tags in total, against the 2,359 the probe claimed.

// STORED WITHOUT THE LANGUAGE PREFIX. "en:e330" becomes "e330".
//
// The prefix is Open Food Facts' own namespace and says nothing about the
// additive: E330 is citric acid in every language. Storing it would make
// every consumer of this column strip it, and would file the same additive
// under two keys when the namespace differs. The number IS the identifier,
// which is the entire reason this column is worth more than the keyword
// classifier.
function enumberOf(tag: string): string | null {
  const m = ENUMBER_TAG.exec(tag)
  return m ? `e${m[1]}${m[2]}`.toLowerCase() : null
}

// THE NINE US MAJOR ALLERGENS, as the tags OFF uses. Sesame is in the list
// because the FASTER Act added it in 2021.
//
// NOT A FILTER ON WHAT WE STORE. We store every allergen tag the label
// carries, including celery and mustard, which are EU majors and not US
// ones — dropping them would make our record of a European product's label
// quietly wrong. This set is used only to count, in the log, how many
// products gain a US-major-allergen statement.
// IS THIS TAG EVEN WELL-FORMED? Added 2026-10-14 after the first complete
// dry run printed this sample:
//
//   0034000001446  traces=["en:peanuts","en:milk.soy"]
//
// `en:milk.soy` is not a tag. It is two allergens mashed together by a
// period, almost certainly a comma that was never split upstream. Stored as
// it stands it matches nothing: a shopper filtering for milk would not see
// this product, and neither would one filtering for soy. On the one field
// where a silent miss is least acceptable.
//
// A SHAPE CHECK, NOT A VOCABULARY. The tempting fix is an allowlist of known
// allergen tags, and that is exactly the mistake the e-number regex made one
// round ago: a hand-written list of what counts as valid becomes a
// measurement of the list rather than of the data. An OFF tag is
// `lang:slug`, where the slug is lowercase alphanumerics and hyphens. That is
// checkable without guessing which allergens exist, and it catches the real
// defect — a period — while passing en:sulphur-dioxide-and-sulphites.
// UNICODE-AWARE, CORRECTED 2026-10-15. The first version was
// /^[a-z]{2}:[a-z0-9-]+$/ — ASCII only — and it was wrong in a way the
// vocabulary print made obvious:
//
//     es:nueces-de-arbol    12 occurrences, passed as well-formed
//     es:nueces-de-árbol     1 occurrence, flagged malformed
//
// The same allergen. Accented and non-Latin letters are perfectly legitimate
// in an Open Food Facts tag, and an ASCII-only check was reporting correct
// data as broken: fr:schalenfrüchte, hr:slačice, sr:lešnik, el:ανθόγαλα,
// en:lactosérum. The LANGUAGE PREFIX stays ASCII, because language codes are.
const WELL_FORMED_TAG = /^[a-z]{2}:[\p{L}\p{M}0-9-]+$/u

// INVISIBLE CHARACTERS, and this is the one that genuinely frightened me.
//
// The dry run reported `en:peanut` as malformed, which made no sense — until
// a codepoint dump showed it as `en:peanut` + U+200E, a LEFT-TO-RIGHT MARK.
// It renders identically to a correct tag, reads identically in a log, and
// matches nothing. A peanut allergen statement that silently cannot be found
// is the worst failure mode this column has.
//
// Stripped rather than reported, because an invisible formatting character
// carries no information about the label: zero-width spaces and joiners,
// the bidirectional marks, the BOM, and the soft hyphen.
const INVISIBLE_CHARS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g

// CANONICALISE BEFORE CHECKING, because the first full vocabulary print
// showed my guess about the cause was wrong.
//
// I had written that a malformed tag "usually means a comma that was never
// split upstream", on the strength of one sample: `en:milk.soy`. The real
// distribution, over 239 affected products, is CAPITALISATION:
//
//     29  en:Coconut          12  en:COCONUT          5  en:PHENYLALANINE
//      3  en:Salt              3  en:LEMON            2  en:Shellfish
//
// And `en:coconut` is a perfectly good tag that already appears 144 times in
// "Contains:" and 101 times in traces. So `en:Coconut` is not a broken tag,
// it is THE SAME ALLERGEN failing to match its own canonical form. A shopper
// filtering for coconut would miss those products for no reason but case.
//
// WHAT IS SAFE TO NORMALISE, and what is not:
//   case             en:Coconut -> en:coconut             YES. A tag is an
//                                                        identifier, and OFF's
//                                                        taxonomy is lowercase.
//   space to hyphen  en:Pine Nuts -> en:pine-nuts         YES. `en:pine-nuts`
//                                                        already exists (8).
//   singular/plural  en:coconuts -> en:coconut            NO. That is a guess
//                                                        about vocabulary, which
//                                                        is the exact mistake
//                                                        this phase has now made
//                                                        three times.
//
// Everything still malformed AFTER this is genuinely bad data rather than a
// formatting variant: en:N/A, en:citric acid, en:BETA CAROTENE,
// en:LEMON JUICE CONCENTRATE (FOR TARTNESS). Those are ingredients or junk
// typed into an allergen field, and no normalisation rescues them.
// A REPEATED LANGUAGE PREFIX. The fourth dry run surfaced `en:en:en:eggs` and
// `en:en:gluten-en:soybeans` — values that had been there all along and were
// hidden below the report's top-25 cut until the accented tags moved out.
//
// Stripping a prefix that is simply repeated is mechanical: `en:en:eggs` can
// only have meant `en:eggs`, and it composes with the splitter below, so
// `en:en:gluten-en:soybeans` becomes en:gluten plus en:soybeans. Both are
// major allergens that currently vanish on those two products.
//
// THIS IS THE LAST NORMALISATION. What remains after it is semantic, not
// structural: `en:contains:-milk` needs a "contains:" prefix understood,
// `en:eggs-&-peanuts` needs "&" read as a separator, `en:tree-nuts-(coconut)`
// needs a parenthetical interpreted. Each of those is a guess about meaning
// rather than a fact about format, and this phase has already paid three
// times for guessing. The residue is counted, named in the log, and left.
const REPEATED_PREFIX = /^([a-z]{2}:)(?:\1)+/

function canonicalTag(raw: string): string {
  const t = raw.replace(INVISIBLE_CHARS, '').trim().toLowerCase().replace(/\s+/g, '-')
  return t.replace(REPEATED_PREFIX, '$1')
}

// SEVERAL TAGS IN ONE STRING. The dry run surfaced `en:milk en:soybeans` as a
// single value, which canonicalisation then turned into
// `en:milk-en:soybeans` — still malformed, so still caught, but now joined
// rather than merely separated. That is a milk AND soy statement matching
// nothing.
//
// A second `xx:` prefix inside the value is a structural fact, not a guess,
// so it can be split on. A real tag never contains a second one:
// `en:crustacean-shellfish` has one colon, so the lookahead cannot fire.
//
// THE GUARD IS WHAT MAKES THIS SAFE: the split is kept ONLY if every piece is
// well-formed afterwards. Otherwise the original is returned untouched. That
// stops a junk value like `es:contiene-ingredientes-de:-trigo+` from being
// chopped into a plausible-looking fragment and stored as though it were an
// allergen.
function splitConcatenatedTags(raw: string): string[] {
  // Repeated prefixes first, so `en:en:gluten-en:soybeans` can split cleanly.
  const parts = raw
    .toLowerCase()
    .replace(REPEATED_PREFIX, '$1')
    .split(/[\s,;-]+(?=[a-z]{2}:)/i)
  if (parts.length < 2) return [raw]
  const canonical = parts.map(canonicalTag)
  return canonical.every((t) => WELL_FORMED_TAG.test(t)) ? parts : [raw]
}

// WE STILL STORE THE MALFORMED ONES. They are what the label record says,
// and dropping them would turn "we read a statement we could not parse" into
// "the label stated nothing" — the exact three-state collapse this whole
// phase exists to prevent. They are counted and printed instead, so the
// blast radius is a number in the log rather than a surprise later.

// CORRECTED 2026-10-14, AND THIS IS THE THIRD TIME IN THIS PHASE.
//
// The first version listed `en:tree-nuts`. That tag appears NOWHERE in the
// export. The tag Open Food Facts actually uses is `en:nuts`, on 17,702
// "Contains:" statements and 2,574 trace statements — so the reported
// "naming a US major allergen" figure of 124,603 was undercounting by up to
// 17,702 products, because I wrote down the allergen name I expected instead
// of the tag the data uses.
//
// Same error as the e-number regex and the allergen vocabulary before it:
// a hand-written list of what counts is a measurement of the list. The only
// reason this was caught is that the script now PRINTS THE WHOLE VOCABULARY,
// and `en:tree-nuts` was visibly absent from it.
//
// This set only ever affects a COUNT IN THE LOG, never what is stored — every
// allergen tag is stored whether or not it is in here. That is the only
// reason this was a reporting bug rather than a data one.
const US_MAJOR_ALLERGENS = new Set([
  'en:milk',
  'en:eggs',
  'en:fish',
  'en:crustaceans',
  'en:nuts',        // what the export actually uses for tree nuts
  'en:tree-nuts',   // kept in case another source spells it this way
  'en:shellfish',   // 5 in Contains, 28 in traces; distinct from en:crustaceans
  'en:peanuts',
  'en:soybeans',
  'en:sesame-seeds',
  // `en:gluten` IS COUNTED, and it is not a clean match. The US major
  // allergen is WHEAT; gluten also covers barley and rye, which is item 31's
  // whole point. It is counted because it is the closest thing the export
  // carries to the label's "Contains: wheat" and excluding it would
  // understate the column by 55,825. The count is a rough sense of reach, not
  // a claim about any product, and nothing on the site may read it as one.
  'en:gluten',
  // DELIBERATELY ABSENT: `en:molluscs` (732). Molluscs are an EU major
  // allergen and not a US one. Still stored, just not counted here.
])

// ------------------------------------------------------------- statistics --
let linesRead = 0
let parsed = 0
let matched = 0
let matchedByNormalising = 0
// DISTINCT PRODUCTS, NOT MATCHED LINES. `matched` increments once per line of
// the export, and the first complete pass proved those are different numbers:
// 382,573 line-matches resolved to 381,758 distinct products, because 815
// barcodes appear in the export MORE THAN ONCE.
//
// That mattered beyond pedantry. The report derived "in our catalogue, NOT in
// the export" as wanted.size - matched, which came out as 33,792 when the
// true figure was 34,607, and every per-group total was inflated by whatever
// the duplicate lines happened to carry. The dry run predicted 243,822
// products with raw ingredient text; the database holds 243,165.
const seenProductIds = new Set<string>()
let duplicateBarcodeMatches = 0
let skippedAlreadyChecked = 0
let batchesWritten = 0
let batchesFailed = 0
let rowsWritten = 0
let rowsFailed = 0
let rowsSanitised = 0
let rowsDimensionsRejected = 0

let gotLabels = 0
let gotAdditives = 0
let gotAllergens = 0
let usMajor = 0
let gotTraces = 0
let gotText = 0
let gotTextNoEnglish = 0
let gotImageSize = 0
let emptyLabels = 0
let emptyAdditives = 0
let emptyAllergens = 0

const droppedLabelTags = new Map<string, number>()
const keptLabelTags = new Map<string, number>()
const nonEnumberTags = new Map<string, number>()
const malformedAllergenTags = new Map<string, number>()
const canonicalisedTags = new Map<string, number>()
const wrongLanguageTags = new Map<string, number>()
const allergenVocab = new Map<string, number>()
const traceVocab = new Map<string, number>()
let productsWithMalformedAllergen = 0
const langSeen = new Map<string, number>()
const imageSizeShape = new Map<string, number>()
const samples: string[] = []
const sampleBuckets = new Map<string, number>()
function bump(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) ?? 0) + 1)
}
function top(m: Map<string, number>, n = 25): [string, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

// --------------------------------------------------- the products we want --
// upc -> product id, for every product that still needs this pass.
const wanted = new Map<string, string>()

async function loadWanted() {
  // WHY THE WHOLE MAP IS HELD IN MEMORY. 416,382 rows of (upc, id) is about
  // 21 MB of strings, and the alternative is a database round trip per line
  // of a 4.8-million-line file. backfill-off-images.ts made the same trade.
  //
  // ONE QUERY, NOT FORTY-TWO. REWRITTEN 2026-10-14 after a run sat here for
  // over half an hour printing nothing.
  //
  // The first version paged with a cursor: `take: 10_000` plus
  // `orderBy: { id: 'asc' }`, forty-two times. The plan for that is a
  // PARALLEL SEQ SCAN ON Product PLUS A SORT, because no index can serve a
  // four-way OR over nullable columns, and the cursor does not help when the
  // filter is not indexable. So it was forty-two full scans and forty-two
  // sorts of a 416,382-row table to fetch two columns.
  //
  // On an idle database that was a few seconds and nobody noticed. Under
  // concurrent load it is unbounded: the run that exposed this was queued
  // behind eighteen page-render queries all waiting on disk reads, and the
  // Supabase pooler had no free slot either, so each of the forty-two scans
  // was waiting minutes.
  //
  // One unordered query reads the table once. There is no ORDER BY because
  // nothing here needs ordered rows — the result goes straight into a Map.
  //
  // THE FILTER IS NOW CONDITIONAL, which matters more than it looks. The OR
  // over the four checkedAt columns only excludes a row if that row has
  // ALREADY been written, so on a first run it excludes NOTHING and is pure
  // cost: it forces the seq scan above while removing zero rows. We count
  // first, cheaply, and only ask for it when it can actually do something.
  // $queryRawUnsafe, AND WHY THAT IS SAFE HERE: the only interpolated
  // values are column names from the hardcoded `cols` list below. No user
  // input, no export data and no argument reaches this string. The typed
  // $queryRaw tag cannot build a WHERE clause whose SHAPE varies, which is
  // exactly what the conditional resume filter needs.
  const t0 = Date.now()

  let filter = ''
  if (!RECHECK) {
    const cols: string[] = []
    if (GROUPS.has('labels')) cols.push('"labelClaimsCheckedAt"')
    if (GROUPS.has('additives')) cols.push('"additivesCheckedAt"')
    if (GROUPS.has('allergens')) cols.push('"labelAllergensCheckedAt"')
    if (GROUPS.has('text')) cols.push('"ingredientsTextRawCheckedAt"')
    // How many rows the resume filter would actually remove.
    const done = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "Product" WHERE "upc" IS NOT NULL AND ${cols
        .map((c) => `${c} IS NOT NULL`)
        .join(' AND ')}`
    )
    const alreadyDone = Number(done[0]?.n ?? 0)
    if (alreadyDone > 0) {
      log(`  ${alreadyDone.toLocaleString()} products already carry every checkedAt for these groups; they will be skipped.`)
      log('  (pass --recheck to revisit them)')
      filter = ` AND (${cols.map((c) => `${c} IS NULL`).join(' OR ')})`
    } else {
      log('  nothing has been written yet, so no resume filter is needed.')
    }
  }

  // A HEARTBEAT, because the real failure here was not slowness, it was
  // SILENCE. The first version printed "Loading the products that still need
  // this pass..." and then nothing at all until it finished, so a starved
  // query was indistinguishable from a hung process. Thirty-five minutes of
  // that is what prompted the rewrite.
  const beat = setInterval(() => {
    const secs = Math.round((Date.now() - t0) / 1000)
    log(`  ...still waiting on the database after ${secs}s. If this does not move, something`)
    log('     else is loading the database: check for another copy of this script still')
    log('     running, and for pages being served (the related-products query on')
    log('     ProductIngredient is expensive and will starve this one).')
  }, 20_000)

  try {
    const rows = await prisma.$queryRawUnsafe<{ id: string; upc: string | null }[]>(
      `SELECT "id", "upc" FROM "Product" WHERE "upc" IS NOT NULL${filter}`
    )
    for (const row of rows) if (row.upc) wanted.set(row.upc, row.id)
  } finally {
    clearInterval(beat)
  }
  log(`  loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

// ------------------------------------------------------------- extraction --
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

// THE INGREDIENT TEXT, AND WHICH LANGUAGE IT IS IN.
//
// The export has a text field per language plus an unsuffixed
// `ingredients_text`, and the unsuffixed one is NOT reliably English: it is
// whatever the record's own `lang` is. That is the whole Norwegian-Snickers
// bug (item 36) — our importer read the unsuffixed field and stored Norwegian
// ingredient names on US products, creating rows that join to nothing.
//
// So this prefers the explicitly English field, falls back to the unsuffixed
// one, and ALWAYS records which language it actually got. A row whose text is
// not English is not discarded: it is stored with its language, so a later
// pass can decide what to do with it instead of us guessing now. 4.4% of
// records are in that state.
function pickIngredientText(p: Record<string, unknown>): { text: string | null; lang: string | null } {
  const en = nonEmptyString(p.ingredients_text_en)
  if (en) return { text: en, lang: 'en' }
  const plain = nonEmptyString(p.ingredients_text)
  if (plain) {
    const lang = nonEmptyString(p.lang) ?? nonEmptyString(p.lc)
    return { text: plain, lang: lang ?? null }
  }
  return { text: null, lang: null }
}

// IMAGE DIMENSIONS, IF THE EXPORT HAS THEM.
//
// The probe did not measure this, which is why the code is defensive and why
// the log reports what it found. OFF's `images` object has a per-image
// `sizes` map keyed by width ("400", "full"), and the full entry carries `w`
// and `h`. If that shape is absent this returns null and the column stays
// null, which is the honest answer rather than a guessed aspect ratio.
function pickImageSize(p: Record<string, unknown>): { w: number; h: number } | null {
  const images = p.images
  if (!images || typeof images !== 'object') {
    bump(imageSizeShape, 'no images object')
    return null
  }
  const front = (images as Record<string, unknown>).front_en ?? (images as Record<string, unknown>).front
  if (!front || typeof front !== 'object') {
    bump(imageSizeShape, 'images object, no front entry')
    return null
  }
  const sizes = (front as Record<string, unknown>).sizes
  if (!sizes || typeof sizes !== 'object') {
    bump(imageSizeShape, 'front entry, no sizes')
    return null
  }
  const full = (sizes as Record<string, unknown>).full
  const cand = full && typeof full === 'object' ? (full as Record<string, unknown>) : null
  const w = cand && typeof cand.w === 'number' ? cand.w : null
  const h = cand && typeof cand.h === 'number' ? cand.h : null
  if (w && h) {
    bump(imageSizeShape, 'full sizes with w and h')
    return { w, h }
  }
  bump(imageSizeShape, 'sizes present, no usable w/h')
  return null
}

type Pending = {
  id: string
  code: string
  labelClaims: string[]
  additiveENumbers: string[]
  labelAllergens: string[]
  labelAllergenTraces: string[]
  ingredientsTextRaw: string | null
  ingredientsTextLang: string | null
  imageWidth: number | null
  imageHeight: number | null
}
let batch: Pending[] = []

// A cheap pre-filter so we do not JSON.parse 4 million lines to discard most
// of them. Same trick as backfill-off-images.ts.
const CODE_RE = /"code"\s*:\s*"(\d+)"/

function processLine(line: string): Pending | null {
  const m = CODE_RE.exec(line)
  if (!m) return null
  const code = m[1]

  // MATCHING A BARCODE TO ONE OF OURS, in the order backfill-off-images.ts
  // established. Product.upc is the OFF code put through normalizeUpc, which
  // expands an 8-digit UPC-E to 13 digits and strips a GTIN-14's leading
  // zero — transformations no amount of zero-padding reverses. The first
  // image pass used three hand-rolled variants instead of the project's own
  // normaliser and left 42,053 products unmatched, products that had come
  // from this very export. The cheap lookups run first only because
  // normalizeUpc runs a check-digit loop we would rather not pay 4 million
  // times.
  let id = wanted.get(code)
  if (!id) id = wanted.get(code.padStart(13, '0'))
  if (!id) id = wanted.get(code.replace(/^0+/, ''))
  if (!id) {
    const n = normalizeUpc(code)
    if (n.ok) {
      id = wanted.get(n.upc)
      if (id) matchedByNormalising++
    }
  }
  if (!id) return null

  // LAST WRITE WINS on a duplicated barcode, and that is worth knowing rather
  // than discovering later. When the export carries the same barcode twice we
  // process both lines and the second overwrites the first, so what ends up
  // stored is whichever record came last in file order — not the richest, and
  // not a merge of the two. Counted here so the choice is visible; changing it
  // needs a decision about which record is authoritative, which the export
  // does not tell us.
  if (seenProductIds.has(id)) duplicateBarcodeMatches++
  else seenProductIds.add(id)

  let p: Record<string, unknown>
  try {
    p = JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
  parsed++
  matched++

  const out: Pending = {
    id,
    code,
    labelClaims: [],
    additiveENumbers: [],
    labelAllergens: [],
    labelAllergenTraces: [],
    ingredientsTextRaw: null,
    ingredientsTextLang: null,
    imageWidth: null,
    imageHeight: null,
  }

  if (GROUPS.has('labels')) {
    for (const t of strArray(p.labels_tags)) {
      if (KEEP_LABEL.has(t)) {
        out.labelClaims.push(t)
        bump(keptLabelTags, t)
      } else {
        bump(droppedLabelTags, t)
      }
    }
    if (out.labelClaims.length > 0) gotLabels++
    else emptyLabels++
  }

  if (GROUPS.has('additives')) {
    for (const t of strArray(p.additives_tags)) {
      const n = enumberOf(t)
      if (n) {
        // De-duplicated: OFF lists both the family and the specific salt
        // ("en:e450" alongside "en:e450iii"), and once the prefix is gone a
        // record can carry the same number twice.
        if (!out.additiveENumbers.includes(n)) out.additiveENumbers.push(n)
      } else {
        bump(nonEnumberTags, t)
      }
    }
    if (out.additiveENumbers.length > 0) gotAdditives++
    else emptyAdditives++
  }

  if (GROUPS.has('allergens')) {
    // CANONICALISE, THEN SHAPE-CHECK, THEN STORE. The vocabulary is recorded
    // from the canonical form, because that is what will actually be in the
    // column and therefore what a filter will have to match.
    //
    // Anything still malformed after canonicalisation is stored anyway: the
    // label did state something, and dropping it would read as "the label
    // stated nothing", which is the three-state collapse this phase exists to
    // prevent. It is counted and printed instead.
    let malformedHere = false
    const clean = (raw: string[]): string[] => {
      const out: string[] = []
      // Split first, because canonicalisation replaces the separator that
      // identifies a concatenation.
      const pieces = raw.flatMap(splitConcatenatedTags)
      for (const r of pieces) {
        const t = canonicalTag(r)
        if (t !== r) bump(canonicalisedTags, `${r}  ->  ${t}`)
        if (!WELL_FORMED_TAG.test(t)) {
          bump(malformedAllergenTags, t)
          malformedHere = true
        } else if (t.startsWith('en:') && /[^\x00-\x7f]/.test(t)) {
          // WELL-FORMED BUT MISLABELLED. Making the shape check Unicode-aware
          // moved these OUT of the malformed list and into the vocabulary,
          // where they are easy to miss. `en:γάλα` is Greek for milk, carrying
          // an English prefix: structurally a fine tag, and it will never match
          // an English allergen filter. Counted so the fix to the shape check
          // does not quietly hide them.
          bump(wrongLanguageTags, t)
        }
        // De-duplicated, because canonicalising can collide: a record
        // carrying both en:Coconut and en:coconut becomes one tag.
        if (!out.includes(t)) out.push(t)
      }
      return out
    }
    out.labelAllergens = clean(strArray(p.allergens_tags))
    out.labelAllergenTraces = clean(strArray(p.traces_tags))
    for (const t of out.labelAllergens) bump(allergenVocab, t)
    for (const t of out.labelAllergenTraces) bump(traceVocab, t)
    if (malformedHere) productsWithMalformedAllergen++
    if (out.labelAllergens.length > 0) {
      gotAllergens++
      if (out.labelAllergens.some((a) => US_MAJOR_ALLERGENS.has(a))) {
        // counted below in the report, via usMajor
        usMajor++
      }
    } else {
      emptyAllergens++
    }
    if (out.labelAllergenTraces.length > 0) gotTraces++
  }

  if (GROUPS.has('text')) {
    const t = pickIngredientText(p)
    out.ingredientsTextRaw = t.text
    out.ingredientsTextLang = t.lang
    if (t.text) {
      gotText++
      bump(langSeen, t.lang ?? '(none)')
      if (t.lang !== 'en') gotTextNoEnglish++
    }
  }

  // NOT INSIDE A GROUP. Dimensions were briefly folded into the `text` group
  // because both were added in the same pass, which is exactly the kind of
  // accidental coupling that makes --only text do something nobody expects.
  // Measuring the shape is also free and the log question it answers —
  // whether the export carries sizes at all — is worth answering on every run.
  const size = pickImageSize(p)
  if (size) {
    out.imageWidth = size.w
    out.imageHeight = size.h
    gotImageSize++
  }

  // SAMPLES THAT SHOW SOMETHING. The first version took the first eight
  // matches in file order, which were eight sparse records in the 0000105...
  // range and printed as eight identical empty rows. Useless for checking the
  // extraction. These are bucketed instead, so the log always shows a real
  // example of each group plus one deliberately empty row for contrast.
  const sampleLine = (tag: string) =>
    `    [${tag}] ${code}  labels=${JSON.stringify(out.labelClaims)} ` +
    `additives=${JSON.stringify(out.additiveENumbers.slice(0, 6))} ` +
    `allergens=${JSON.stringify(out.labelAllergens)} ` +
    `traces=${JSON.stringify(out.labelAllergenTraces)} lang=${out.ingredientsTextLang ?? '-'}`
  const take = (tag: string, cond: boolean) => {
    if (cond && (sampleBuckets.get(tag) ?? 0) < 2) {
      sampleBuckets.set(tag, (sampleBuckets.get(tag) ?? 0) + 1)
      samples.push(sampleLine(tag))
    }
  }
  take('labels', out.labelClaims.length > 0)
  take('additives', out.additiveENumbers.length > 0)
  take('allergens', out.labelAllergens.length > 0)
  take('traces', out.labelAllergenTraces.length > 0)
  take('non-english', out.ingredientsTextRaw !== null && out.ingredientsTextLang !== 'en')
  take('dimensions', out.imageWidth !== null)
  take('nothing on the label', out.labelClaims.length === 0 && out.additiveENumbers.length === 0 && out.labelAllergens.length === 0)
  return out
}

// ------------------------------------------------------------------ write --
// THE DATA FOR ONE PRODUCT. Pulled out of flushBatch so the write path can
// change without the field rules moving.
function dataFor(r: Pending, now: Date): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  // EVERY checkedAt BELOW IS UNCONDITIONAL, and that is the single most
  // important thing in this file. It is NOT inside an `if (found)`.
  //
  // We read the export for this product. Whether or not the label claimed
  // anything, the answer "we looked" is now a fact, and the site needs to be
  // able to say it. Putting these inside a found-something branch is exactly
  // the bug that left 34,624 products stamped "never looked" for their
  // photograph, and the one this script was written to not repeat.
  if (GROUPS.has('labels')) {
    data.labelClaims = r.labelClaims.map(storable)
    data.labelClaimsSource = SOURCE
    data.labelClaimsCheckedAt = now
  }
  if (GROUPS.has('additives')) {
    data.additiveENumbers = r.additiveENumbers
    data.additivesSource = SOURCE
    data.additivesCheckedAt = now
  }
  if (GROUPS.has('allergens')) {
    // The arrays are canonicalised already, but a NUL inside a tag would fail
    // exactly the same way and cost the whole product, so it is cheap to be
    // certain here rather than reason about whether it can happen.
    data.labelAllergens = r.labelAllergens.map(storable)
    data.labelAllergenTraces = r.labelAllergenTraces.map(storable)
    data.labelAllergensSource = SOURCE
    data.labelAllergensCheckedAt = now
  }
  if (GROUPS.has('text')) {
    const safeText = storableOrNull(r.ingredientsTextRaw)
    if (safeText !== r.ingredientsTextRaw) rowsSanitised++
    data.ingredientsTextRaw = safeText
    data.ingredientsTextLang = r.ingredientsTextLang
    data.ingredientsTextRawSource = SOURCE
    data.ingredientsTextRawCheckedAt = now
  }

  // DIMENSIONS ARE THE ONE EXCEPTION TO "WRITE WHAT WE FOUND", and the only
  // field here not governed by a checkedAt of its own: they are set only when
  // we actually have numbers. Writing null over a measured size, because this
  // export entry happens to lack a sizes block, would destroy information we
  // already held — and unlike the arrays above, "no dimensions" is not a
  // claim anyone reads. imageCheckedAt already governs whether the photo was
  // looked for.
  // BOUNDED, because these are the only NUMBERS this pass writes and they are
  // the only fields that can fail on a value rather than on a character.
  // imageWidth/Height are Prisma `Int`, i.e. INT4: anything above 2,147,483,647
  // is rejected by the database, and `sizes.full.w` is a number read straight
  // out of crowdsourced JSON. A product photograph is never 3 billion pixels
  // wide, so a value outside a sane range is corrupt rather than large, and
  // the honest response is to leave the columns null and keep the product.
  //
  // 20,000 is deliberately generous — real package photographs top out in the
  // low thousands — because the purpose here is to reject garbage, not to
  // second-guess a legitimately big image.
  const w = r.imageWidth
  const h = r.imageHeight
  if (w && h && Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 20_000 && h <= 20_000) {
    data.imageWidth = w
    data.imageHeight = h
  } else if (w || h) {
    rowsDimensionsRejected++
  }
  return data
}

// HOW MANY UPDATES ARE IN FLIGHT AT ONCE. The point is to hide network
// latency: each update is a round trip to a remote Postgres, and waiting for
// each one in turn is what made the first live attempt fail. Kept modest
// because the pooler has a finite number of slots and the app needs some.
const WRITE_CONCURRENCY = 8

// CHARACTERS POSTGRES CANNOT STORE, which is my leading hypothesis for the
// three per-row failures and is worth guarding against either way.
//
// A Postgres `text` column cannot contain a NUL byte — not "should not", it
// is rejected outright. And a JavaScript string can hold an UNPAIRED
// SURROGATE, which has no valid UTF-8 encoding at all, so it fails on the way
// to the server rather than at it.
//
// Both occur in crowdsourced free text, and `ingredientsTextRaw` is the one
// genuinely free-text field in this pass. Neither carries any information
// about the label, so stripping them loses nothing.
//
// DELIBERATELY NARROW. Other C0 control characters are ugly but storable, and
// this is the raw-text column whose entire purpose is to be an auditable
// record of what the source said (item 40). Cleaning it beyond what the
// database physically refuses would defeat the point of having it.
//
// Counted and reported, so the next run says whether this was the cause
// rather than leaving me to assume it was.
const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g
const LONE_LOW_SURROGATE = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

function storable(v: string): string {
  return v.replace(/\u0000/g, '').replace(LONE_HIGH_SURROGATE, '').replace(LONE_LOW_SURROGATE, '')
}

// Returns null when the value held nothing but unstorable characters, because
// an empty string and "no text" are different statements.
function storableOrNull(v: string | null): string | null {
  if (v === null) return null
  const out = storable(v)
  return out.length > 0 ? out : null
}

// Flatten a Prisma error into one readable line. Blank lines dropped, the
// code frame skipped, the cause kept: the useful sentence in a Prisma error
// is several lines down, never the first.
function errorLine(reason: unknown): string {
  const msg = reason instanceof Error ? reason.message : String(reason)
  const lines = msg
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\d+\s/.test(l) && !l.startsWith(String.fromCharCode(0x2192)))
  const joined = lines.join(' | ')
  return joined.length > 500 ? `${joined.slice(0, 500)}...` : joined || '(no message)'
}

async function flushBatch() {
  if (batch.length === 0) return
  const rows = batch
  batch = []
  if (DRY_RUN) {
    batchesWritten++
    rowsWritten += rows.length
    return
  }

  // NO TRANSACTION, AND THAT IS THE FIX RATHER THAN A LONGER TIMEOUT.
  //
  // The first live run died here: 500 `product.update` calls inside one
  // interactive transaction took 120,062 ms against a timeout of 120,000.
  // Raising the timeout would have been treating the symptom — the real
  // problem is that an interactive transaction holds a connection open while
  // 500 sequential round trips happen inside it, and under the load this
  // database is already carrying that is minutes.
  //
  // THE TRANSACTION WAS NEVER NEEDED. Every row here describes a different
  // product, and a single UPDATE is atomic on its own, so each product is
  // either fully written or untouched — which is exactly the granularity
  // this pass needs. The script is built to be resumed: a checkedAt that
  // landed is true of that product whatever happened to the rest of the run.
  // Wrapping 500 independent writes in one transaction bought atomicity
  // nobody wanted and a 2-minute ceiling nobody could meet.
  //
  // The first live attempt proved the per-row writes themselves were fine:
  // 33 batches — 16,500 products — landed complete and correct before one
  // batch crossed the timeout.
  const now = new Date()
  let failedHere = 0
  for (let i = 0; i < rows.length; i += WRITE_CONCURRENCY) {
    const slice = rows.slice(i, i + WRITE_CONCURRENCY)
    const settled = await Promise.allSettled(
      slice.map((r) => prisma.product.update({ where: { id: r.id }, data: dataFor(r, now) }))
    )
    for (let j = 0; j < settled.length; j++) {
      const res = settled[j]
      if (res.status === 'rejected') {
        failedHere++
        rowsFailed++
        // The first few in full, then just the count: a per-row failure that
        // repeats 100,000 times must not bury the rest of the report.
        if (rowsFailed <= 5) {
          // THE WHOLE MESSAGE, FLATTENED. The first version took
          // message.split('\n')[0], and a Prisma error message BEGINS WITH A
          // BLANK LINE, so every failure logged as "failed: " with nothing
          // after it. Three real errors were reported and all three were
          // invisible. An error line that cannot carry its own error is worse
          // than no error line, because it looks like it worked.
          log(`  !! product ${slice[j].code} failed: ${errorLine(res.reason)}`)
        }
      }
    }
  }
  rowsWritten += rows.length - failedHere
  if (failedHere === 0) batchesWritten++
  else batchesFailed++
}

// ------------------------------------------------------------------ input --
async function* readLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  // Pull-based so memory stays flat on a 7 GB gzip stream.
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

async function main() {
  if (!FILE) {
    console.error('Usage: npx tsx scripts/backfill-off-export.ts <export.jsonl.gz> [--live]')
    process.exit(1)
  }
  // CHECKED EXPLICITLY, because Prisma reports a missing connection string as
  // an "Invalid invocation" error on whatever query happens to run first,
  // which sends you looking at the query instead of the environment.
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. This script loads it from .env via dotenv/config;')
    console.error('check that .env exists in the project root and contains DATABASE_URL.')
    process.exit(1)
  }
  if (!fs.existsSync(FILE)) {
    console.error(`Not found: ${FILE}`)
    process.exit(1)
  }

  log(`Backfilling from ${FILE}`)
  log(DRY_RUN ? 'DRY RUN — nothing will be written. Pass --live to write.' : 'LIVE — writing to the database.')
  log(`Groups: ${[...GROUPS].join(', ')}${RECHECK ? '   (--recheck: revisiting already-checked products)' : ''}`)
  log('')

  log('Loading the products that still need this pass...')
  await loadWanted()
  log(`  ${wanted.size.toLocaleString()} products with a barcode to match against`)
  if (wanted.size === 0) {
    log('  Nothing to do. Every product already has a checkedAt for these groups.')
    log('  Pass --recheck to revisit them.')
    await prisma.$disconnect()
    return
  }
  log('')

  const started = Date.now()
  const input = fs.createReadStream(FILE).pipe(zlib.createGunzip())
  for await (const raw of readLines(input)) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    linesRead++
    if (line.trim()) {
      const pending = processLine(line)
      if (pending) {
        batch.push(pending)
        if (batch.length >= BATCH_SIZE) await flushBatch()
      }
    }
    if (linesRead % PROGRESS_EVERY === 0) {
      const mins = ((Date.now() - started) / 60000).toFixed(1)
      log(`  ${linesRead.toLocaleString()} lines, ${matched.toLocaleString()} matched (${mins} min)`)
    }
    if (matched >= LIMIT) {
      log(`  --limit ${LIMIT} reached, stopping early.`)
      break
    }
  }
  await flushBatch()

  const mins = ((Date.now() - started) / 60000).toFixed(1)
  log('')
  log(`===== RESULT (${mins} min) =====`)
  log(`  lines read:                 ${linesRead.toLocaleString()}`)
  // "records parsed" used to be printed here next to lines read, which
  // implied we had parsed 4.7 million records. We had not: the barcode
  // pre-filter runs on the raw line and only a MATCH is ever JSON.parsed, so
  // that number was identical to `matched` by construction and said nothing.
  log(`  records JSON-parsed:        ${parsed.toLocaleString()}  (only matches are parsed)`)
  log(`  export lines matching us:   ${matched.toLocaleString()}`)
  log(`  DISTINCT products matched:  ${seenProductIds.size.toLocaleString()}`)
  if (duplicateBarcodeMatches > 0) {
    log(`    ...barcodes the export carries more than once: ${duplicateBarcodeMatches.toLocaleString()}`)
    log('       For these the LAST line in the file is what got stored, not the')
    log('       richest record and not a merge. See the note in processLine().')
  }
  log(`    ...only via normalizeUpc: ${matchedByNormalising.toLocaleString()}`)
  log(`  in our catalogue, NOT in the export: ${(wanted.size - seenProductIds.size).toLocaleString()} of ${wanted.size.toLocaleString()}`)
  log('    ^ products whose barcode this export does not carry. Expected to be')
  log('      non-zero: our catalogue also holds USDA and FoodData Central rows.')
  log(`  products written:           ${rowsWritten.toLocaleString()}${DRY_RUN ? ' (dry run — counted, not sent)' : ''}`)
  log(`  batches:                    ${batchesWritten.toLocaleString()} clean`)
  if (batchesFailed > 0) log(`  !! batches with a failure:  ${batchesFailed.toLocaleString()}`)
  if (rowsSanitised > 0) {
    log(`  products whose raw text held a NUL or an unpaired surrogate: ${rowsSanitised.toLocaleString()}`)
    log('     Those characters were stripped. Postgres text cannot store a NUL')
    log('     at all, and an unpaired surrogate has no UTF-8 encoding.')
  }
  if (rowsDimensionsRejected > 0) {
    log(`  image dimensions rejected as out of range: ${rowsDimensionsRejected.toLocaleString()}`)
    log('     Outside 1..20,000 px, so corrupt rather than large. The columns')
    log('     stay null and the product is still written.')
  }
  if (rowsFailed > 0) {
    log(`  !! PRODUCTS THAT FAILED:    ${rowsFailed.toLocaleString()}`)
    log('     Those products keep a null checkedAt, so they are still')
    log('     "nobody has looked" rather than wrongly marked as read.')
    log('     Re-running the script picks them up; no --recheck needed.')
  }
  log('')
  log('  WHAT EACH GROUP GAINED (and what it correctly recorded as empty):')
  if (GROUPS.has('labels')) {
    log(`    label claims kept:        ${gotLabels.toLocaleString()} products`)
    log(`      ...label claims nothing: ${emptyLabels.toLocaleString()}  → stamped "we looked", not "nobody looked"`)
  }
  if (GROUPS.has('additives')) {
    log(`    additive e-numbers:       ${gotAdditives.toLocaleString()} products`)
    log(`      ...no additives listed: ${emptyAdditives.toLocaleString()}`)
  }
  if (GROUPS.has('allergens')) {
    log(`    "Contains:" statements:   ${gotAllergens.toLocaleString()} products`)
    log(`      ...naming a US major:   ${usMajor.toLocaleString()}`)
    log(`    "may contain" traces:     ${gotTraces.toLocaleString()} products`)
    log(`      ...no allergens listed: ${emptyAllergens.toLocaleString()}`)
    log(`    MALFORMED allergen tags:  ${productsWithMalformedAllergen.toLocaleString()} products`)
    if (productsWithMalformedAllergen > 0) {
      log('      ^ these are stored as-is, because the label did state something')
      log('        and dropping it would read as "the label stated nothing". But a')
      log('        malformed tag MATCHES NO FILTER, so each one is an allergen a')
      log('        shopper would not be shown. Read the list below before --live.')
    }
  }
  if (GROUPS.has('text')) {
    log(`    raw ingredient text:      ${gotText.toLocaleString()} products`)
    log(`      ...NOT in English:      ${gotTextNoEnglish.toLocaleString()}  → item 36, now visible instead of silent`)
  }
  log(`    image dimensions:         ${gotImageSize.toLocaleString()} products`)

  {
    log('')
    log('  DOES THE EXPORT CARRY IMAGE SIZES? (the probe never measured this)')
    for (const [shape, n] of top(imageSizeShape, 8)) {
      log(`    ${String(n).padStart(9)}  ${shape}`)
    }
    log('    If "full sizes with w and h" is large, item 32 is a small addition')
    log('    to backfill-off-images.ts. If it is zero, the dimensions have to')
    log('    come from somewhere else and the columns stay null meanwhile.')
  }
  if (GROUPS.has('text')) {
    log('')
    log('  INGREDIENT TEXT LANGUAGE:')
    for (const [lang, n] of top(langSeen, 12)) log(`    ${String(n).padStart(9)}  ${lang}`)
  }

  if (GROUPS.has('labels')) {
    log('')
    log('  LABEL TAGS KEPT:')
    for (const [t, n] of top(keptLabelTags, 20)) log(`    ${String(n).padStart(9)}  ${t}`)
    log('')
    log('  LABEL TAGS SEEN AND NOT KEPT — widen KEEP_LABEL on evidence, not guesswork:')
    for (const [t, n] of top(droppedLabelTags, 25)) log(`    ${String(n).padStart(9)}  ${t}`)
  }

  if (GROUPS.has('additives') && nonEnumberTags.size > 0) {
    log('')
    log('  additives_tags THAT ARE NOT E-NUMBERS, and were therefore dropped:')
    for (const [t, n] of top(nonEnumberTags, 15)) log(`    ${String(n).padStart(9)}  ${t}`)
  }

  if (GROUPS.has('allergens')) {
    log('')
    log('  MALFORMED ALLERGEN / TRACE TAGS, worst first:')
    if (malformedAllergenTags.size === 0) {
      log('    (none)')
    } else {
      // 60, not 25. The previous cap hid real entries below it, and this list
      // is the audit trail for the highest-stakes column in the pass: a
      // truncated audit trail is how `en:en:en:eggs` went unnoticed for three
      // runs. If it ever grows past 60, that is itself worth knowing.
      for (const [t, n] of top(malformedAllergenTags, 60)) log(`    ${String(n).padStart(9)}  ${t}`)
      log('    These are what is left AFTER canonicalising case and separators, so')
      log('    they are not formatting variants: they are ingredients or junk typed')
      log('    into an allergen field upstream. No normalisation rescues them, and')
      log('    each one is an allergen statement a filter cannot match.')
    }
    log('')
    log('  TAGGED en: BUT NOT IN ENGLISH:')
    if (wrongLanguageTags.size === 0) {
      log('    (none)')
    } else {
      for (const [t, n] of top(wrongLanguageTags, 15)) log(`    ${String(n).padStart(9)}  ${t}`)
      log('    Structurally valid, so these are stored and no longer reported as')
      log('    malformed. They still will not match an English allergen filter,')
      log('    which is a mislabelling upstream that we cannot fix from here.')
    }
    log('')
    log('  TAGS CANONICALISED (case and separator only, never singular/plural):')
    if (canonicalisedTags.size === 0) {
      log('    (none)')
    } else {
      for (const [t, n] of top(canonicalisedTags, 30)) log(`    ${String(n).padStart(9)}  ${t}`)
      log('    Each of these previously matched no filter despite naming a real')
      log('    allergen that already exists in the vocabulary under its proper form.')
    }
    log('')
    log('  THE WHOLE "CONTAINS:" VOCABULARY, as it actually appears:')
    for (const [t, n] of top(allergenVocab, 40)) log(`    ${String(n).padStart(9)}  ${t}`)
    log('')
    log('  THE WHOLE "MAY CONTAIN" VOCABULARY:')
    for (const [t, n] of top(traceVocab, 30)) log(`    ${String(n).padStart(9)}  ${t}`)
    log('    ^ printed in full rather than summarised: this is the column where a')
    log('      value we did not expect is least acceptable, and the only way to')
    log('      know what is in it is to look at all of it.')
    log('')
    log('    AND READ IT FOR MEANING, NOT JUST SHAPE. Canonicalising turns')
    log('    "en:citric acid" into the well-formed "en:citric-acid", so it leaves')
    log('    the malformed list above and appears here instead. It is still not an')
    log('    allergen. Same for beta-carotene and gellan-gum: somebody typed an')
    log('    ingredient into an allergen field, and no shape check can see that.')
    log('    The vocabulary list is where those are visible, which is the reason')
    log('    it is printed in full.')
  }

  log('')
  log('  SAMPLES:')
  for (const s of samples) log(s)

  log('')
  if (DRY_RUN) {
    log('  DRY RUN. Nothing was written. Read the tag lists above before --live:')
    log('  the KEEP_LABEL allowlist is the one judgement call in this script,')
    log('  and a tag dropped here is a claim the site will never be able to make.')
  } else {
    log('  WHAT IS STILL NOT DONE, so the next session does not have to rediscover it:')
    log('    - the nested ingredient tree and Ingredient.offTaxonomyId (item 39,')
    log('      item 28) need their own script and their own dry run.')
    log('    - the image three-state re-run for the 34,624 products stamped')
    log('      "never looked" belongs in backfill-off-images.ts, not here.')
  }
  log('')
  log(`Log written to ${LOG_FILE}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  log(`FAILED: ${(e as Error).message}`)
  await prisma.$disconnect()
  process.exit(1)
})

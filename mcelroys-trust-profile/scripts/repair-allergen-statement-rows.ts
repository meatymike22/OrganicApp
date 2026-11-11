// Removes ingredient rows that were never ingredients: the contents of a
// label's "Contains:" statement and of its cross-contact warning.
//
// WHY: reported by Michael, 2026-11-10, on 'Dark chocolate coconut almond
// bites' — "it says 'Gluten/wheat' is an ingredient but I never see this on
// the ingredient list ... the cross contamination information made it into
// the ingredient list, which it shouldnt."
//
// That product's declaration ends:
//
//   "...sunflower lecithin. Contains: tree nuts (almonds), milk. Produced on
//    equipment that processes peanuts, tree nuts, soy, egg, gluten/wheat."
//
// and it had 19 ingredient rows. Six of them — tree nut, milk, soy, egg and
// gluten/wheat — are those two trailing statements, stored with isTrace false
// and so indistinguishable from real ingredients. Two rules for this already
// existed in the parser, but both ran AFTER the text was split on commas, by
// which point only the first fragment still carried the word "Contains".
// extractLabelStatements() cuts at sentence level instead, before the split.
// New imports are correct; this script repairs what is already stored.
//
// ⚠️ IT IS SURGICAL, AND THE FIRST VERSION WAS NOT. That version reparsed the
// whole declaration and removed whatever the reparse no longer produced. Its
// dry run over 7,467 products would have removed 13,830 links, and reading
// the tally showed what they were:
//
//   1404 milk   1325 wheat   1253 soy   479 egg   346 tree nut      <- correct
//    125 sugar   118 natural flavor   117 salt   86 citric acid     <- REAL
//     83 spices   83 garlic powder   55 xanthan gum   47 butter     <- REAL
//
// A full reparse applies EVERY parser change made since each product was
// imported, not just this one. The stored rows came from older parser
// versions, so the difference is mostly parser evolution — and the subset
// check only stopped names being ADDED, never removed. 2,731 products were
// skipped for review for the same reason, which is the guard reporting that
// a wholesale reparse was the wrong instrument.
//
// So removals are now computed from the statement itself:
//
//   remove a stored link IFF its name is produced by parsing the STATEMENT
//   and is NOT produced by parsing the DECLARATION
//
// Parser evolution cannot reach that, because the declaration is never
// rewritten. A product whose declaration genuinely lists "wheat" keeps it
// even when the Contains statement names wheat too.
//
// SAFETY
//   - Only ever REMOVES links, and only links the statement contributed.
//   - Ingredient ROWS are never deleted. "tree nut" is on 1,127 products and
//     "milk" on 18,118, many legitimately; only the link goes.
//   - A product is never emptied: if every stored link would be removed, the
//     product is skipped and listed.
//   - listPosition is left alone. Removing a trailing statement leaves 1..n
//     intact, and the page sorts by position rather than indexing into it.
//   - Nothing is marked as reviewed and no product's text is rewritten.
//
// Usage (PowerShell, from mcelroys-trust-profile):
//   npx tsx scripts/repair-allergen-statement-rows.ts          (dry run)
//   npx tsx scripts/repair-allergen-statement-rows.ts --live   (applies it)
//   npx tsx scripts/repair-allergen-statement-rows.ts --live --limit 50
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { parseIngredientsText, extractLabelStatements } from '@/lib/ingredientParsing'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const clientOptions = {
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0]
const prisma = new PrismaClient(clientOptions)

// Supabase's default statement_timeout is 30 s and the scan below reads every
// published declaration. SET LOCAL raises it for that one statement, and
// works through the pooler only because it is inside a transaction — the
// pattern is copied from repair-ingredients.ts rather than reinvented.
async function slowQuery<T>(query: Prisma.PrismaPromise<T>): Promise<T> {
  const [, result] = await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '20min'`),
    query,
  ])
  return result as T
}

const DRY_RUN = !process.argv.includes('--live')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg === -1 ? null : Number(process.argv[limitArg + 1])

fs.mkdirSync('./logs', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const LOG_FILE = path.join('./logs', `repair-allergen-statement-rows${DRY_RUN ? '-dryrun' : ''}-${stamp}.txt`)
function log(line: string) {
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}
// Per-product detail goes to the LOG ONLY once the console has had a sample.
// Thousands of products at three lines each is a terminal nobody reads.
const CONSOLE_SAMPLE = 25
let shown = 0
function detail(line: string) {
  if (shown < CONSOLE_SAMPLE) console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// A deliberately LOOSE SQL pre-filter: every row it returns is confirmed in
// JS by extractLabelStatements, so a false positive here costs nothing and a
// false negative would silently leave a product unrepaired.
const PREFILTER = '\\.\\s+(contains|may\\s|produced|manufactured|made\\s|packaged|packed|processed|prepared|bottled|allerg|this\\s+product)'

type Row = { id: string; name: string; ingredientsTextRaw: string }

async function main() {
  log(`log: ${LOG_FILE}`)
  log(DRY_RUN ? 'DRY RUN — nothing will be written. Re-run with --live to apply.' : 'LIVE RUN')

  log('\nscanning declarations for trailing label statements...')
  const candidates = await slowQuery(prisma.$queryRaw<Row[]>`
    SELECT id, name, "ingredientsTextRaw"
      FROM "Product"
     WHERE "publicationStatus" = 'published'
       AND "ingredientsTextRaw" IS NOT NULL
       AND "ingredientsTextRaw" ~* ${PREFILTER}
     ORDER BY id`)
  log(`  ${candidates.length} products matched the pre-filter`)

  const work: { row: Row; statement: string; stmtNames: Set<string>; declNames: Set<string> }[] = []
  for (const row of candidates) {
    const st = extractLabelStatements(row.ingredientsTextRaw)
    if (st.contains === null && st.crossContact === null) continue
    const stmtText = [st.contains, st.crossContact].filter((x): x is string => x !== null).join(' ')
    work.push({
      row,
      statement: stmtText,
      // skipLabelStatements, or parsing a statement would strip it to nothing.
      stmtNames: new Set(parseIngredientsText(stmtText, { skipLabelStatements: true }).map((p) => p.name)),
      declNames: new Set(parseIngredientsText(st.declaration, { skipLabelStatements: true }).map((p) => p.name)),
    })
  }
  log(`  ${work.length} have a statement the parser now separates`)

  const slice = LIMIT === null ? work : work.slice(0, LIMIT)
  if (LIMIT !== null) log(`  --limit ${LIMIT}: processing the first ${slice.length}`)

  let unchanged = 0
  let repaired = 0
  let rowsRemoved = 0
  let skipped = 0
  const removedByName = new Map<string, number>()

  for (let i = 0; i < slice.length; i++) {
    const { row, statement, stmtNames, declNames } = slice[i]
    const links = await prisma.productIngredient.findMany({
      where: { productId: row.id },
      select: { ingredient: { select: { name: true } } },
      orderBy: { listPosition: 'asc' },
    })
    const stored = links.map((l) => l.ingredient.name)

    // THE RULE: the statement produced this name and the declaration did not.
    const removals = stored.filter((n) => stmtNames.has(n) && !declNames.has(n))

    if (removals.length === 0) {
      unchanged++
      continue
    }
    // A product is never left with no ingredients.
    if (removals.length >= stored.length) {
      skipped++
      log(`SKIP  ${row.id}  ${row.name}`)
      log(`        would remove ALL ${stored.length} links — needs a human`)
      log(`        statement: ${statement}`)
      continue
    }

    for (const n of removals) removedByName.set(n, (removedByName.get(n) ?? 0) + 1)
    rowsRemoved += removals.length
    repaired++
    shown++
    detail(`${DRY_RUN ? 'WOULD' : 'FIXED'} ${row.id}  ${row.name}`)
    detail(`        statement: ${statement}`)
    detail(`        remove ${removals.length}/${stored.length}: ${JSON.stringify(removals)}`)

    if (!DRY_RUN) {
      await prisma.productIngredient.deleteMany({
        where: { productId: row.id, ingredient: { name: { in: removals } } },
      })
    }

    if ((i + 1) % 500 === 0) log(`  ... ${i + 1}/${slice.length}`)
  }

  log('\n--- SUMMARY ---')
  log(`products with a trailing statement : ${work.length}`)
  log(`already correct                    : ${unchanged}`)
  log(`${DRY_RUN ? 'would repair                       ' : 'repaired                           '}: ${repaired}`)
  log(`ingredient links ${DRY_RUN ? 'to remove         ' : 'removed           '} : ${rowsRemoved}`)
  log(`skipped (would empty the product)  : ${skipped}`)

  if (removedByName.size > 0) {
    log('\nlinks removed, by ingredient (top 40):')
    const top = [...removedByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
    for (const [name, n] of top) log(`  ${String(n).padStart(6)}  ${name}`)
    log('\nEVERY NAME ABOVE SHOULD BE AN ALLERGEN OR LABEL BOILERPLATE.')
    log('A real ingredient in this list means the statement cut is wrong — read')
    log('the rows before --live. That check is what caught the first version.')
  }
  log(`\nlog written to ${LOG_FILE}`)
}

main()
  .catch((e) => {
    fs.appendFileSync(LOG_FILE, `[ERROR] ${e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e)}\n`)
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

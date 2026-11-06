// GENERATE THE PRODUCT-NOUN LEXICON AS A COMMITTED FILE.
//
//   npx tsx scripts/generate-product-nouns.ts            # dry run: prints the diff
//   npx tsx scripts/generate-product-nouns.ts --write     # writes the file
//
// Writes src/lib/productNouns.generated.ts, which titleOrientation.ts uses
// as its default lexicon.
//
// WHY A COMMITTED FILE AND NOT A QUERY.
//
// orientSplit needs, for every word, how many distinct companies end a
// product name with it and how many of those names have no comma. That is a
// 640-row aggregate over all 416,382 products. Three ways to get it to the
// product page, and only one is right:
//
//   a column         -> a migration, and r37's whole point is that the split
//                       and its orientation are DISPLAY decisions
//   a query per page -> a full-table aggregate on every product render
//   a committed file -> no migration, no per-request cost, visible in a diff,
//                       regenerable, and orientSplit stays a PURE function
//                       that can be selftested without a database
//
// THIS SCRIPT IS THE ONLY PLACE THE LEXICON SQL LIVES. probe-title-parts.ts
// used to carry its own copy; it now reads the generated file instead, which
// removes the duplication AND means the probe measures the lexicon that
// actually ships rather than a freshly-computed one that might differ.
//
// IT PRINTS A DIFF, NOT JUST A COUNT. A regeneration months from now must be
// reviewable: which words entered, which left, which changed enough to cross
// the product-noun threshold. A word CROSSING that boundary is what changes
// an <h1>, so those are listed separately and explicitly.
//
// THE SORT IS ALPHABETICAL, DELIBERATELY. Sorting by company count would
// reshuffle the whole file every time any count moved, and a 640-line diff
// hides the two lines that mattered.

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'node:fs'
import path from 'node:path'
import {
  MIN_COMPANIES, MIN_COMMA_FREE_RATIO, isProductNoun, type Lexicon,
} from '../src/lib/titleOrientation'

const WRITE = process.argv.slice(2).includes('--write')
const OUT = path.resolve('src/lib/productNouns.generated.ts')

// The floor for being in the file at all. Lower than MIN_COMPANIES so the
// threshold stays adjustable in code without regenerating, and so the diff
// shows a word approaching the boundary before it crosses it.
const FILE_FLOOR = 25

const LOG_DIR = path.resolve('logs')
fs.mkdirSync(LOG_DIR, { recursive: true })
const LOG_FILE = path.join(
  LOG_DIR,
  `generate-product-nouns-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
)
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
function log(line = '') {
  console.log(line)
  stream.write(line + '\n')
}
console.log(`Log file: ${LOG_FILE}`)

function render(rows: { word: string; all: number; commaFree: number }[]): string {
  const generated = new Date().toISOString().slice(0, 10)
  const nouns = rows.filter((r) =>
    isProductNoun(r.word, new Map([[r.word, { all: r.all, commaFree: r.commaFree }]]))
  ).length
  return `// GENERATED FILE - DO NOT EDIT BY HAND.
//
//   npx tsx scripts/generate-product-nouns.ts --write
//
// Generated ${generated} from the live catalogue. ${rows.length} words with at
// least ${FILE_FLOOR} distinct companies; ${nouns} of them clear the product-noun
// test (>= ${MIN_COMPANIES} companies AND comma-free ratio >= ${MIN_COMMA_FREE_RATIO}).
//
// Each row is [word, allNames, commaFree]:
//   allNames   distinct companies whose multi-word product names end in it
//   commaFree  the same, counted only over names with NO comma
//
// The RATIO between them is what separates a product-type noun from a flavour
// word. A product noun ends a complete name (sauce .91, crackers .93); a
// flavour word disproportionately ends a trailing comma field (strawberry
// .50, mild .38), because that is what a flavour field IS. See
// titleOrientation.ts for the reasoning and for the 113 words this excludes,
// every one of which was read by hand.
//
// Sorted alphabetically so a regeneration produces a reviewable diff.

export const PRODUCT_NOUN_ROWS: readonly (readonly [string, number, number])[] = [
${rows.map((r) => `  [${JSON.stringify(r.word)}, ${r.all}, ${r.commaFree}],`).join('\n')}
]

export const PRODUCT_NOUNS: Map<string, { all: number; commaFree: number }> = new Map(
  PRODUCT_NOUN_ROWS.map(([w, all, commaFree]) => [w, { all, commaFree }])
)
`
}

async function main() {
  if (!process.env.DATABASE_URL) {
    log('DATABASE_URL is not set. Is .env present in the project root?')
    process.exitCode = 1
    return
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })
  try {
    // THE ONLY COPY OF THIS QUERY. Must stay in step with lastNoun() in
    // titleOrientation.ts; probe-title-parts.ts asserts they agree on a
    // 4,000-row sample, because a one-character drift would make every
    // lookup miss while appearing to work.
    const rows = await prisma.$queryRaw<
      { lastword: string; all_names: bigint; comma_free: bigint }[]
    >`
      WITH w AS (
        SELECT p."companyId",
               position(',' in p.name) = 0 AS comma_free,
               lower(btrim(regexp_replace(
                 regexp_replace(p.name, '[^[:alnum:][:space:]]', '', 'g'),
                 '^.*[[:space:]]', ''))) AS lastword
          FROM "Product" p
         WHERE p.name ~ '[[:space:]]'
      )
      SELECT lastword,
             count(DISTINCT "companyId")                          AS all_names,
             count(DISTINCT "companyId") FILTER (WHERE comma_free) AS comma_free
        FROM w
       WHERE length(lastword) >= 3
       GROUP BY 1
      HAVING count(DISTINCT "companyId") >= ${FILE_FLOOR}
       ORDER BY lastword`

    const fresh = rows.map((r) => ({
      word: r.lastword,
      all: Number(r.all_names),
      commaFree: Number(r.comma_free),
    }))

    const freshLex: Lexicon = new Map(
      fresh.map((r) => [r.word, { all: r.all, commaFree: r.commaFree }])
    )

    log(`\nwords at >= ${FILE_FLOOR} companies:      ${fresh.length.toLocaleString()}`)
    log(`of those, clearing the noun test:  ` +
        `${fresh.filter((r) => isProductNoun(r.word, freshLex)).length.toLocaleString()}` +
        `   (>= ${MIN_COMPANIES} companies AND ratio >= ${MIN_COMMA_FREE_RATIO})`)

    // ---- the diff against what is on disk
    let old: Lexicon = new Map()
    let existed = false
    if (fs.existsSync(OUT)) {
      existed = true
      const text = fs.readFileSync(OUT, 'utf8')
      for (const m of text.matchAll(/^\s*\["((?:[^"\\]|\\.)*)",\s*(\d+),\s*(\d+)\],$/gm)) {
        old.set(JSON.parse(`"${m[1]}"`), { all: Number(m[2]), commaFree: Number(m[3]) })
      }
      log(`\nexisting file parsed: ${old.size.toLocaleString()} words`)
    } else {
      log('\nno existing file - this is the first generation.')
    }

    if (existed) {
      const added = [...freshLex.keys()].filter((k) => !old.has(k))
      const removed = [...old.keys()].filter((k) => !freshLex.has(k))
      // THE ONES THAT MATTER: a word crossing the product-noun boundary is
      // what changes an <h1>.
      const became: string[] = []
      const ceased: string[] = []
      for (const [w] of freshLex) {
        const was = old.has(w) && isProductNoun(w, old)
        const is = isProductNoun(w, freshLex)
        if (!was && is) became.push(w)
        if (was && !is) ceased.push(w)
      }
      for (const w of removed) if (isProductNoun(w, old)) ceased.push(w)

      log(`\n  words added:   ${added.length}`)
      log(`  words removed: ${removed.length}`)
      log(`\n  !! BECAME a product noun (these CHANGE an <h1>): ${became.length}`)
      for (const w of became) {
        const s = freshLex.get(w)!
        log(`     + ${w}  ${s.all}co ratio ${(s.commaFree / s.all).toFixed(2)}`)
      }
      log(`  !! CEASED to be a product noun (these CHANGE an <h1>): ${ceased.length}`)
      for (const w of ceased) {
        const s = freshLex.get(w) ?? old.get(w)!
        log(`     - ${w}  ${s.all}co ratio ${(s.commaFree / s.all).toFixed(2)}`)
      }
      if (became.length === 0 && ceased.length === 0)
        log('     none - no product page title changes from this regeneration.')
    }

    const text = render(fresh)
    if (!WRITE) {
      log(`\nDRY RUN. Nothing written. Pass --write to update:`)
      log(`  ${OUT}`)
      log(`  ${text.split('\n').length.toLocaleString()} lines, ${text.length.toLocaleString()} bytes`)
    } else {
      fs.writeFileSync(OUT, text, 'utf8')
      log(`\nWROTE ${OUT}`)
      log(`  ${text.split('\n').length.toLocaleString()} lines, ${text.length.toLocaleString()} bytes`)
      log('  Run `npx tsc --noEmit` and the titleOrientation selftest next.')
    }
    log(`\nLog written to ${LOG_FILE}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  log(`\nFAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  process.exitCode = 1
})

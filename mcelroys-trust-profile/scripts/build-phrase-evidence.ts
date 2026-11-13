// Precomputes the evidence the scoring page shows for each dropped phrase:
// the company, how many products carry it, and three example product names.
//
// WHY A FILE AND NOT A QUERY. A phrase is "dropped" only in the sense that
// splitByProductNoun(productDisplayName(...)) returns it, which is a code
// path over all 416,382 products, not a column. The page cannot run that on
// every load, and it must not approximate it with a LIKE query over
// Product.name -- that is the exact mistake r38 and r39 both paid for:
// "a SQL proxy for a code path is not a measurement of that code path",
// 2,727 products against a real 845.
//
// So the scan runs once, here, through the SAME two functions the classifier
// imported, and the result is a snapshot on disk. If the splitter changes,
// this is re-run; the file carries the timestamp that says when it was true.
//
// ⚠️ THE EVIDENCE MUST MATCH WHAT THE MODEL SAW, or the scoring measures
// something else. This file's scan is a copy of the one in
// classify-dropped-phrases.ts (the "BUILDING THE DROPPED-PHRASE SET" block)
// down to the three-example cap and the '(none)' company fallback. If that
// one changes, change this one in the same commit.
//
// READ-ONLY. Writes one file and touches no table.
//
// Usage (PowerShell, from mcelroys-trust-profile):
//   npx tsx scripts/build-phrase-evidence.ts
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'node:fs'
import path from 'node:path'
import { productDisplayName } from '../src/lib/productName'
import { splitByProductNoun } from '../src/lib/titleOrientation'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter, queryPlanCacheMaxSize: 0 } as unknown as ConstructorParameters<typeof PrismaClient>[0])

const BATCH = 20000
const OUT = path.join('./data', 'phrase-evidence.json')

fs.mkdirSync('./logs', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const LOG_FILE = path.join('./logs', `build-phrase-evidence-${stamp}.txt`)
function log(line: string) {
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

type Row = { id: string; name: string; legalName: string | null; dbaNames: string[] | null }
export type Evidence = { company: string; products: number; examples: string[] }

async function main() {
  log(`log: ${LOG_FILE}`)
  log('scanning every product through productDisplayName + splitByProductNoun...')

  const byPhrase = new Map<string, Evidence>()
  let scanned = 0
  let cursor = ''
  for (;;) {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT p.id, p.name, co."legalName", co."dbaNames"
        FROM "Product" p
        LEFT JOIN "Company" co ON co.id = p."companyId"
       WHERE p.id > ${cursor}
       ORDER BY p.id
       LIMIT ${BATCH}`
    if (rows.length === 0) break
    for (const r of rows) {
      const displayed = productDisplayName(r.name, r.legalName, r.dbaNames ?? [])
      const ns = splitByProductNoun(displayed)
      if (!ns.dropped) continue
      let e = byPhrase.get(ns.dropped)
      if (e === undefined) {
        e = { company: r.legalName ?? '(none)', products: 0, examples: [] }
        byPhrase.set(ns.dropped, e)
      }
      e.products++
      if (e.examples.length < 3) e.examples.push(displayed)
    }
    scanned += rows.length
    cursor = rows[rows.length - 1].id
    if (scanned % 100000 < BATCH) log(`  ... ${scanned.toLocaleString()} scanned`)
  }

  log(`  scanned ${scanned.toLocaleString()} products`)
  log(`  distinct dropped phrases: ${byPhrase.size.toLocaleString()}`)
  const affected = [...byPhrase.values()].reduce((n, v) => n + v.products, 0)
  log(`  products affected:        ${affected.toLocaleString()}`)

  // How many of the phrases the page will actually need have evidence. A
  // verdict row whose phrase no longer appears is not an error -- a splitter
  // change can retire a phrase -- but it is worth seeing the number.
  const judged = await prisma.droppedPhraseVerdict.findMany({ select: { phrase: true } })
  const missing = judged.filter((j) => !byPhrase.has(j.phrase)).length
  log(`  judged phrases: ${judged.length.toLocaleString()}, of which ${missing} no longer appear`)
  if (missing > 0) log('  (those rows will show "phrase no longer produced by the splitter")')

  fs.mkdirSync('./data', { recursive: true })
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      { builtAt: new Date().toISOString(), scanned, phrases: Object.fromEntries(byPhrase) },
      null,
      0
    )
  )
  const kb = Math.round(fs.statSync(OUT).size / 1024)
  log(`\nwrote ${OUT} (${kb.toLocaleString()} KB)`)
  log('data/ is gitignored: this is a regenerable local artifact, not a source file.')
}

main()
  .catch((e) => {
    const msg = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e)
    fs.appendFileSync(LOG_FILE, `[ERROR] ${msg}\n`)
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

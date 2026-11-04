// WHAT DOES THE CONTRIBUTION QUEUE LOOK LIKE RIGHT NOW?
//
//   npx tsx scripts/probe-contribution-queue.ts --selftest
//   npx tsx scripts/probe-contribution-queue.ts
//
// READ-ONLY. No --live, no update call. The queue is DERIVED, so there is
// nothing to write: this reports what the live columns already imply.
//
// IT CROSS-CHECKS ITSELF. The buckets are counted twice -- once by SQL over
// the whole catalogue, once by the TypeScript predicates in
// lib/contributionQueue.ts over a sample of the same rows -- and the two must
// agree row for row. Those predicates are what the site and the capture flow
// will use; SQL is what any batch job will use. If they drift, the queue
// shown to a contributor stops matching the queue the reward is paid from.
// "Two independent counts of the same fact are a test" (phase 2, §11).

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'node:fs'
import path from 'node:path'
import {
  deskTasks, needsAnyContribution, requiredShots, selftest,
  type ProductForQueue,
} from '../src/lib/contributionQueue'

const SELFTEST = process.argv.slice(2).includes('--selftest')
const SAMPLE = 5000

const LOG_DIR = path.resolve('logs')
fs.mkdirSync(LOG_DIR, { recursive: true })
const LOG_FILE = path.join(
  LOG_DIR,
  `probe-contribution-queue-${SELFTEST ? 'selftest' : 'report'}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
)
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
function log(line = '') {
  console.log(line)
  stream.write(line + '\n')
}
console.log(`Log file: ${LOG_FILE}`)

// One month of Plus per 30 accepted photographs (r27, unchanged).
const PHOTOS_PER_MONTH = 30

async function main() {
  if (SELFTEST) {
    const ok = selftest(log)
    log(`\nLog written to ${LOG_FILE}`)
    process.exitCode = ok ? 0 : 1
    return
  }
  if (!process.env.DATABASE_URL) {
    log('DATABASE_URL is not set. Is .env present in the project root?')
    process.exitCode = 1
    return
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })
  try {
    // THE ASSUMPTION THAT MAKES TWO READINGS COINCIDE.
    //
    // hasUsablePhoto treats an UNJUDGED image (url present, imageKind null)
    // as covered, because round 30's display rule already shows those and
    // re-shooting a photograph the site is displaying wastes the contributor.
    // A stricter reading -- "only an explicit 'package' counts" -- gives the
    // same number only while nothing is unjudged. Report it, do not assume
    // it: an import can add images ahead of a classifier run.
    const unjudged = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Product"
       WHERE "imageUrl" IS NOT NULL AND btrim("imageUrl") <> '' AND "imageKind" IS NULL`
    const nUnjudged = Number(unjudged[0].n)
    log(`Images present but unjudged by the classifier: ${nUnjudged.toLocaleString()}`)
    log(nUnjudged === 0
      ? '  0, so "has a usable photo" reads the same strictly or leniently today.'
      : '  !! NOT ZERO. The lenient reading counts these as covered; a strict one would not.')

    const rows = await prisma.$queryRaw<
      { front: bigint; panel: bigint; both: bigint; desk: bigint; any: bigint; total: bigint }[]
    >`
      WITH p AS (
        SELECT
          NOT ("imageUrl" IS NOT NULL AND btrim("imageUrl") <> ''
               AND ("imageKind" IS NULL OR "imageKind" = 'package'))        AS needs_front,
          ("ingredientDisclosureStatus" = 'partial')                        AS needs_panel,
          ("publicationStatus" <> 'published'
           AND "imageUrl" IS NOT NULL AND btrim("imageUrl") <> ''
           AND ("imageKind" IS NULL OR "imageKind" = 'package'))            AS desk
        FROM "Product"
      )
      SELECT count(*) FILTER (WHERE needs_front)                 AS front,
             count(*) FILTER (WHERE needs_panel)                 AS panel,
             count(*) FILTER (WHERE needs_front AND needs_panel) AS both,
             count(*) FILTER (WHERE desk)                        AS desk,
             count(*) FILTER (WHERE needs_front OR needs_panel OR desk) AS any,
             count(*)                                            AS total
      FROM p`
    const r = rows[0]
    const front = Number(r.front), panel = Number(r.panel), both = Number(r.both)
    const desk = Number(r.desk), any = Number(r.any), total = Number(r.total)
    const shots = front + panel
    const shotProducts = front + panel - both

    log('\n===== THE QUEUE =====')
    log(`  catalogue                                  ${total.toLocaleString()}`)
    log(`  need a front-of-package photograph         ${front.toLocaleString()}`)
    log(`  need an ingredient-panel photograph        ${panel.toLocaleString()}`)
    log(`    of which need BOTH (one shelf visit)     ${both.toLocaleString()}`)
    log(`  need reading, not photographing            ${desk.toLocaleString()}`)
    log(`  ---`)
    log(`  PHOTOGRAPHS REQUIRED                       ${shots.toLocaleString()}`)
    log(`  products needing at least one photograph   ${shotProducts.toLocaleString()}`)
    log(`  products needing any contribution at all   ${any.toLocaleString()}`)

    // The reward is counted in PHOTOGRAPHS (Michael, 2026-11-04), so the
    // arithmetic runs on shots, not on products.
    log('\n===== WHAT THAT MEANS FOR THE REWARD =====')
    log(`  ${PHOTOS_PER_MONTH} accepted photographs = one month of Plus`)
    log(`  ${shots.toLocaleString()} photographs = ${Math.round(shots / PHOTOS_PER_MONTH).toLocaleString()} user-months to close the gap`)
    for (const n of [100, 1000, 5000]) {
      const months = shots / PHOTOS_PER_MONTH / n
      log(`    ${String(n).padStart(5)} monthly contributors: ${months.toFixed(1)} months`)
    }
    log('  The gap does not need closing — a supermarket assortment is tens of')
    log('  thousands, not 400,000, and scans concentrate on a popular head.')

    // ---- the cross-check
    log('\n===== CROSS-CHECK: TypeScript predicates vs SQL =====')
    const sample = await prisma.$queryRaw<
      (ProductForQueue & { id: string })[]
    >`
      SELECT id, "imageUrl", "imageKind", "ingredientDisclosureStatus", "publicationStatus"
        FROM "Product" ORDER BY md5(id) LIMIT ${SAMPLE}`
    let tsFront = 0, tsPanel = 0, tsDesk = 0, tsAny = 0
    for (const s of sample) {
      const shotsFor = requiredShots(s)
      if (shotsFor.includes('front_of_package')) tsFront++
      if (shotsFor.includes('ingredient_panel')) tsPanel++
      if (deskTasks(s).length > 0) tsDesk++
      if (needsAnyContribution(s)) tsAny++
    }
    const sqlOnSample = await prisma.$queryRaw<
      { front: bigint; panel: bigint; desk: bigint; any: bigint }[]
    >`
      WITH s AS (
        SELECT "imageUrl", "imageKind", "ingredientDisclosureStatus", "publicationStatus"
          FROM "Product" ORDER BY md5(id) LIMIT ${SAMPLE}
      ), p AS (
        SELECT
          NOT ("imageUrl" IS NOT NULL AND btrim("imageUrl") <> ''
               AND ("imageKind" IS NULL OR "imageKind" = 'package'))     AS needs_front,
          ("ingredientDisclosureStatus" = 'partial')                     AS needs_panel,
          ("publicationStatus" <> 'published'
           AND "imageUrl" IS NOT NULL AND btrim("imageUrl") <> ''
           AND ("imageKind" IS NULL OR "imageKind" = 'package'))         AS desk
        FROM s
      )
      SELECT count(*) FILTER (WHERE needs_front) AS front,
             count(*) FILTER (WHERE needs_panel) AS panel,
             count(*) FILTER (WHERE desk)        AS desk,
             count(*) FILTER (WHERE needs_front OR needs_panel OR desk) AS any
      FROM p`
    const q = sqlOnSample[0]
    const checks: [string, number, number][] = [
      ['front_of_package', tsFront, Number(q.front)],
      ['ingredient_panel', tsPanel, Number(q.panel)],
      ['desk task', tsDesk, Number(q.desk)],
      ['any contribution', tsAny, Number(q.any)],
    ]
    let agreed = true
    log(`  sample of ${sample.length.toLocaleString()} rows, stable under md5(id)`)
    for (const [what, ts, sql] of checks) {
      const ok = ts === sql
      if (!ok) agreed = false
      log(`  ${ok ? 'ok  ' : 'FAIL'} ${what.padEnd(18)} TS ${String(ts).padStart(5)}  SQL ${String(sql).padStart(5)}`)
    }
    if (!agreed) {
      log('\n  !! The predicates and the SQL disagree. The queue a contributor is')
      log('     shown would not match the queue the reward is paid from. Fix')
      log('     before building anything on either.')
      process.exitCode = 1
    }
    log(`\nLog written to ${LOG_FILE}`)
  } catch (e) {
    log(`FAILED: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
    if (e && typeof e === 'object') {
      const any = e as Record<string, unknown>
      if (any.code !== undefined) log(`  code: ${String(any.code)}`)
      if (any.meta !== undefined) log(`  meta: ${JSON.stringify(any.meta)}`)
    }
    if (e instanceof Error && e.stack) log(e.stack)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()

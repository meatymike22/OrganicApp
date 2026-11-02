// IS OUR INGREDIENT TEXT TRUNCATED, OR IS OPEN FOOD FACTS'?
//
//   npx tsx scripts/probe-ingredient-truncation.ts ./data/openfoodfacts-products.NEW.jsonl.gz
//
// READ ONLY. Streams the export and writes nothing, ever.
//
// THE FINDING THIS EXISTS TO SETTLE. 10,072 products have ingredientsTextRaw
// of EXACTLY 255 characters. A natural length distribution does not spike on
// one value — the next most common length is 254 with 1,848, and every other
// length is around 1,000. All 10,072 were written on 2026-10-15 by
// backfill-off-export.ts reading the September export.
//
// Frito-Lay "Turbos Flamas" is the visible case: its text stops at
// "...CHEDDAR CHEESE [" and the page shows ONE ingredient, corn. The other
// ~10,000 are the problem — they parse to 12.7 ingredients on average against
// 13.0 for untruncated text of similar length, so they look completely
// normal. 9,705 of them are labelled `disclosed`. A reader cannot tell.
//
// TWO CAUSES, OPPOSITE FIXES, AND NO WAY TO GUESS BETWEEN THEM:
//
//   (a) OUR IMPORT truncated  -> the export holds the full text, and a
//       re-read plus a re-parse repairs all 10,072.
//   (b) OPEN FOOD FACTS' EXPORT is itself truncated -> re-importing changes
//       nothing, the data does not exist to recover, and the honest response
//       is to stop calling these lists `disclosed`.
//
// This probe reads the export and compares. That is the whole job.
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import readline from 'node:readline'

const EXPORT = process.argv[2]
const SAMPLE = Number(process.argv[3] ?? 40) || 40

const LOG_DIR = path.resolve('logs')
fs.mkdirSync(LOG_DIR, { recursive: true })
const LOG_FILE = path.join(LOG_DIR, `probe-ingredient-truncation-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
function log(line = '') { console.log(line); stream.write(line + '\n') }
console.log(`Log file: ${LOG_FILE}`)

async function main() {
  if (!EXPORT || !fs.existsSync(EXPORT)) {
    log(`Usage: npx tsx scripts/probe-ingredient-truncation.ts <path-to-export.jsonl.gz> [sampleSize]`)
    log(EXPORT ? `  No file at: ${path.resolve(EXPORT)}` : '  No export path given.')
    process.exitCode = 1
    return
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  // The truncated ones, plus a CONTROL GROUP of untruncated products. The
  // control matters: if the export turns out to hold short text for the
  // control too, this probe is measuring the export's general shape rather
  // than anything about truncation.
  const suspect = await prisma.$queryRaw<{ upc: string; len: number }[]>`
    SELECT upc, length("ingredientsTextRaw")::int AS len FROM "Product"
    WHERE length("ingredientsTextRaw") = 255 AND upc IS NOT NULL
    ORDER BY md5(id) LIMIT ${SAMPLE}
  `
  const control = await prisma.$queryRaw<{ upc: string; len: number }[]>`
    SELECT upc, length("ingredientsTextRaw")::int AS len FROM "Product"
    WHERE length("ingredientsTextRaw") BETWEEN 200 AND 254 AND upc IS NOT NULL
    ORDER BY md5(id) LIMIT ${SAMPLE}
  `
  await prisma.$disconnect()

  const want = new Map<string, { len: number; group: 'truncated' | 'control' }>()
  for (const r of suspect) want.set(r.upc.replace(/^0+/, ''), { len: r.len, group: 'truncated' })
  for (const r of control) want.set(r.upc.replace(/^0+/, ''), { len: r.len, group: 'control' })

  log(`\nProbing ${want.size} barcodes against ${path.resolve(EXPORT)}`)
  log(`  ${suspect.length} truncated (exactly 255 stored)`)
  log(`  ${control.length} control (200-254 stored)\n`)

  type Hit = { upc: string; stored: number; exportLen: number; group: string; endsMid: boolean }
  const hits: Hit[] = []
  let lines = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(EXPORT).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    lines++
    if (lines % 500000 === 0) console.log(`    ...${lines.toLocaleString()} lines, ${hits.length}/${want.size} found`)
    if (!line) continue
    // Cheap pre-filter before the JSON parse, which is the expensive part.
    let p: { code?: string; ingredients_text?: string; ingredients_text_en?: string }
    try { p = JSON.parse(line) } catch { continue }
    const code = String(p.code ?? '').replace(/^0+/, '')
    const w = want.get(code)
    if (!w) continue
    const text = (p.ingredients_text_en || p.ingredients_text || '') as string
    hits.push({
      upc: code,
      stored: w.len,
      exportLen: text.length,
      group: w.group,
      endsMid: /[[(,]\s*$/.test(text),
    })
    if (hits.length === want.size) break
  }
  rl.close()

  log(`Read ${lines.toLocaleString()} lines; matched ${hits.length} of ${want.size}.\n`)

  for (const group of ['truncated', 'control'] as const) {
    const g = hits.filter((h) => h.group === group)
    if (g.length === 0) { log(`${group}: no matches found in the export.`); continue }
    const longer = g.filter((h) => h.exportLen > h.stored).length
    const same = g.filter((h) => h.exportLen === h.stored).length
    const at255 = g.filter((h) => h.exportLen === 255).length
    log(`${group.toUpperCase()} (${g.length} matched)`)
    log(`    export text LONGER than ours:  ${longer}`)
    log(`    export text same length:       ${same}`)
    log(`    export text itself 255 chars:  ${at255}`)
    log(`    export text ends mid-structure:${g.filter((h) => h.endsMid).length}`)
    for (const h of g.slice(0, 8)) {
      log(`      ${h.upc.padEnd(15)} stored ${String(h.stored).padStart(5)}  export ${String(h.exportLen).padStart(6)}${h.exportLen > h.stored ? '   <-- WE TRUNCATED' : ''}`)
    }
    log('')
  }

  const tr = hits.filter((h) => h.group === 'truncated')
  const weTruncated = tr.filter((h) => h.exportLen > h.stored).length
  log('='.repeat(70))
  if (tr.length === 0) {
    log('INCONCLUSIVE — none of the truncated barcodes were found in this export.')
    log('That is itself informative: these products may not be in the 24 Oct')
    log('export at all, which is the same state backfill-off-images.ts calls')
    log('"not in the export" rather than "no data".')
  } else if (weTruncated > tr.length * 0.8) {
    log('CAUSE (a): OUR IMPORT TRUNCATED. The export holds the full text.')
    log('Fix: re-read ingredientsTextRaw for the 10,072, then re-parse them,')
    log('then re-run product_ingredient_categories.')
  } else if (weTruncated === 0) {
    log("CAUSE (b): OPEN FOOD FACTS' EXPORT IS ITSELF TRUNCATED.")
    log('Re-importing recovers nothing. The honest response is to stop calling')
    log('these lists `disclosed` — a list cut off mid-item is not a disclosed')
    log('ingredient list, and 9,705 of them currently claim to be one.')
  } else {
    log(`MIXED: ${weTruncated} of ${tr.length} have longer text in the export.`)
    log('Both causes are present. Repair what can be repaired and re-label the rest.')
  }
  log('='.repeat(70))
  log('\nNOTHING WAS WRITTEN.')
  log(`\nLog written to ${LOG_FILE}`)
}

main().catch((e) => { log(`FATAL: ${e instanceof Error ? e.stack : String(e)}`); log(`\nLog written to ${LOG_FILE}`); process.exitCode = 1 })

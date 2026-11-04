// WHICH PRODUCT HEADINGS DOES THE productBrand GUARD CHANGE?
//
//   npx tsx scripts/probe-brand-prepend.ts
//
// READ-ONLY. No --live, no update call. This is the "print every row of a
// destructive change, not a sample" rule from round 29: the guard suppresses
// a brand that was previously printed as an <h1>, and the only way to know it
// suppresses the right ones is to read the whole list.
//
// WHAT IT IS CHECKING. `productBrand` decides a dbaName is a DISTINCT brand
// when it shares no significant word with the legal name. Crowdsourced OFF
// dbaNames are full of misspellings, and a typo that mangles every word
// leaves no word in common — so `Membermark`, a misspelling of
// `Member's Mark`, was judged a different brand and printed as the heading on
// every Member's Mark product.
//
// The new guard rejects a candidate that is merely a SPELLING of the legal
// name. The risk of the fix is the opposite error: suppressing a brand that
// really is distinct, which would silently lose `Organic Valley` from every
// CROPP Cooperative product. So both directions are printed in full.

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'node:fs'
import path from 'node:path'
import {
  companyDisplayName, isSpellingOfLegalName, productBrand, significantWords,
} from '../src/lib/productName'

const LOG_DIR = path.resolve('logs')
fs.mkdirSync(LOG_DIR, { recursive: true })
const LOG_FILE = path.join(LOG_DIR, `probe-brand-prepend-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
function log(line = '') {
  console.log(line)
  stream.write(line + '\n')
}
console.log(`Log file: ${LOG_FILE}`)

// A FROZEN COPY OF THE PRE-FIX LOGIC. Deliberately duplicated rather than
// imported: its whole purpose is to keep behaving the way the old code did
// after the real function has moved on. It must not be "kept in sync".
function productBrandBeforeFix(legalName: string, dbaNames: string[]): string | undefined {
  const legal = significantWords(companyDisplayName(legalName))
  const candidates = [...dbaNames]
    .map((d) => companyDisplayName(d))
    .filter((d) => d.length > 0)
    .sort((a, b) => a.length - b.length)
  for (const cand of candidates) {
    const words = significantWords(cand)
    if (words.size === 0) continue
    let shares = false
    for (const w of words) if (legal.has(w)) { shares = true; break }
    if (!shares) return cand
  }
  return undefined
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
    const companies = await prisma.$queryRaw<
      { id: string; legalName: string; dbaNames: string[]; products: bigint }[]
    >`
      SELECT c.id, c."legalName", c."dbaNames",
             (SELECT count(*) FROM "Product" p
              WHERE p."companyId" = c.id AND p."publicationStatus" = 'published') AS products
      FROM "Company" c
      WHERE array_length(c."dbaNames", 1) > 0
    `
    log(`companies with at least one dbaName: ${companies.length.toLocaleString()}\n`)

    const suppressed: { legal: string; was: string; products: number }[] = []
    const changed: { legal: string; was: string; now: string; products: number }[] = []
    let neitherBrand = 0
    const kept: { legal: string; brand: string; products: number }[] = []

    for (const c of companies) {
      const before = productBrandBeforeFix(c.legalName, c.dbaNames)
      const after = productBrand(c.legalName, c.dbaNames)
      const n = Number(c.products)
      if (before === after) {
        if (before === undefined) neitherBrand++
        else kept.push({ legal: c.legalName, brand: before, products: n })
        continue
      }
      if (after === undefined) suppressed.push({ legal: c.legalName, was: before!, products: n })
      else changed.push({ legal: c.legalName, was: before ?? '(none)', now: after, products: n })
    }

    const byProducts = (a: { products: number }, b: { products: number }) => b.products - a.products

    log('===== SUPPRESSED: a brand that was printed and no longer is =====')
    log('Read every line. Each one is a heading that changes on live pages.\n')
    suppressed.sort(byProducts)
    for (const r of suppressed) {
      log(`  ${String(r.products).padStart(6)} products  ${r.legal}`)
      log(`${' '.repeat(17)}was printing brand: ${JSON.stringify(r.was)}`)
    }
    log(`\n  ${suppressed.length.toLocaleString()} companies, ${suppressed.reduce((a, r) => a + r.products, 0).toLocaleString()} published products`)

    if (changed.length > 0) {
      log('\n===== CHANGED: a different brand is now chosen =====')
      changed.sort(byProducts)
      for (const r of changed) {
        log(`  ${String(r.products).padStart(6)} products  ${r.legal}`)
        log(`${' '.repeat(17)}${JSON.stringify(r.was)} -> ${JSON.stringify(r.now)}`)
      }
      log(`\n  ${changed.length.toLocaleString()} companies, ${changed.reduce((a, r) => a + r.products, 0).toLocaleString()} published products`)
    }

    // THE SET THAT DECIDES WHETHER THIS FEATURE SHOULD EXIST AT ALL.
    //
    // Everything above is about brands we stopped printing. These are the
    // ones we still DO print, and nobody has ever read them. The guard can
    // only reject a candidate that resembles the legal name; it cannot tell
    // a real sub-brand from a misspelling of one. The CHANGED section shows
    // that failure directly - Walmart's "Markerside" is a typo of the real
    // Marketside, and Meijer's "Frederik" of the real Frederik's - so the
    // same defect is presumably sitting in this list too.
    //
    // If a large share of these are misspelled or are product lines rather
    // than brands, no threshold fixes it and the answer is to stop deriving
    // a brand from dbaNames at all.
    log('\n===== STILL PRINTING A DISTINCT BRAND - READ EVERY LINE =====')
    kept.sort(byProducts)
    for (const r of kept) {
      log(`  ${String(r.products).padStart(6)} products  ${r.legal}`)
      log(`${' '.repeat(17)}prints brand: ${JSON.stringify(r.brand)}`)
    }
    log(`\n  ${kept.length.toLocaleString()} companies, ${kept.reduce((a, r) => a + r.products, 0).toLocaleString()} published products`)
    log(`  no brand before or after:              ${neitherBrand.toLocaleString()} companies`)

    // THE RISK OF THE FIX, STATED SEPARATELY. A suppression is correct when
    // the candidate really is a misspelling and wrong when it is a real
    // brand. These are the ones to read hardest: a long edit distance that
    // still passed means the guard stretched.
    log('\n===== SUPPRESSIONS THAT ARE NOT OBVIOUS =====')
    log('Exact and squashed matches are omitted; these were caught by typo')
    log('tolerance alone, so they are where an over-merge would hide.\n')
    let subtle = 0
    for (const r of suppressed) {
      const sq = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '')
      const a = sq(r.was)
      const b = sq(r.legal)
      const words = [...significantWords(companyDisplayName(r.legal))].join('')
      if (a === b || a === words) continue
      subtle++
      log(`  ${r.legal}`)
      log(`      candidate ${JSON.stringify(r.was)}  (${a} vs ${b})`)
      log(`      ${r.products} published products`)
    }
    if (subtle === 0) log('  none - every suppression was an exact or squashed match.')
    log(`\nLog written to ${LOG_FILE}`)
  } catch (e) {
    log(`FAILED: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
    if (e instanceof Error && e.stack) log(e.stack)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()

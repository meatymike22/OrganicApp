// HOW OFTEN IS A "DROPPED PHRASE" JUST THE COMPANY NAME AGAIN?
//
// READ-ONLY. No --live, no writes, no API calls.
//
// r38's classifier returned `company_name` on 5 of its first 30 phrases. If
// that rate holds, a large share of the 6,838 phrases we would pay a model to
// judge are the company name leaking past productDisplayName's brand strip --
// and the honest fix is to strip them, not to classify them.
//
// WHY THIS SCRIPT EXISTS AND NOT A SQL QUERY. The first attempt at this number
// was a SQL proxy: "does the squashed product name begin with the squashed
// company name". It returned 2,727 products and it was WRONG, because the real
// strip does something SQL cannot model -- brandCandidates offers every
// word-PREFIX of the legal name, so "Hodgson Mill Inc." already matches
// "Hodgson mill, 100% pure corn starch" through its two-word prefix. That row
// is handled today and the proxy counted it as a leak.
//
// The only honest measurement runs the real functions over the real corpus.
// That is this file. Same lesson as r37's `lastNoun()` assertion: when two
// things must agree, test that they agree rather than assuming.
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'node:fs'
import path from 'node:path'
import { productDisplayName, isSpellingOfLegalName, companyDisplayName } from '../src/lib/productName'
import { splitByProductNoun } from '../src/lib/titleOrientation'

const BATCH = 20000
const LOG_DIR = path.resolve('logs')
fs.mkdirSync(LOG_DIR, { recursive: true })
const LOG_FILE = path.join(LOG_DIR, `probe-company-leak-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
function log(line = '') {
  console.log(line)
  stream.write(line + '\n')
}
console.log(`Log file: ${LOG_FILE}`)

function squash(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}
const ENTITY = /\b(incorporated|corporation|holdings|company|limited|corp|inc|llc|llp|ltd|gmbh|plc|co)\b\.?/gi

// Four classes, deliberately separate, because they call for different fixes.
type Klass = 'squash_exact' | 'squash_prefix' | 'spelling_of' | 'not_company'

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
    type Row = { id: string; name: string; legalName: string | null; dbaNames: string[] | null }
    // phrase -> class, company, product count, examples
    const phrases = new Map<string, { k: Klass; company: string; companies: Set<string>; products: number; examples: string[] }>()
    let scanned = 0
    let withDropped = 0
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
        withDropped++
        const legal = r.legalName
        let k: Klass = 'not_company'
        if (legal) {
          const p = squash(ns.dropped)
          const whole = squash(legal)
          const noEntity = squash(companyDisplayName(legal).replace(ENTITY, ' '))
          if (p.length >= 4) {
            if (p === whole || p === noEntity) k = 'squash_exact'
            else if (noEntity.length >= 4 && (noEntity.startsWith(p) || p.startsWith(noEntity))) k = 'squash_prefix'
            // The r33 machinery, kept when productBrand stopped calling it.
            // This is the question it was built to answer.
            else if (isSpellingOfLegalName(ns.dropped, legal)) k = 'spelling_of'
          }
        }
        let e = phrases.get(ns.dropped)
        if (e === undefined) {
          e = { k, company: legal ?? '(none)', companies: new Set<string>(), products: 0, examples: [] }
          phrases.set(ns.dropped, e)
        }
        e.products++
        e.companies.add(legal ?? '(none)')
        if (e.examples.length < 2) e.examples.push(displayed)
      }
      scanned += rows.length
      cursor = rows[rows.length - 1].id
      if (scanned % 100000 < BATCH) console.log(`  ... ${scanned.toLocaleString()} scanned`)
    }

    log('')
    log('===== THE DROPPED SET =====')
    log(`  products scanned:                 ${scanned.toLocaleString()}`)
    log(`  products with a dropped phrase:   ${withDropped.toLocaleString()}`)
    log(`  distinct dropped phrases:         ${phrases.size.toLocaleString()}`)
    log('')
    log('  r38 measured 12,780 products and 6,838 phrases. A different figure')
    log('  here means the catalogue or the lexicon moved -- say so, do not')
    log('  quietly adopt the new number.')

    const by = new Map<Klass, { phrases: number; products: number }>()
    for (const [, v] of phrases) {
      const e = by.get(v.k) ?? { phrases: 0, products: 0 }
      e.phrases++
      e.products += v.products
      by.set(v.k, e)
    }
    log('')
    log('===== IS THE DROPPED PHRASE THE COMPANY AGAIN? =====')
    log('   phrases |  products | class')
    log('  ---------+-----------+-------------------------------------------')
    const ORDER: Klass[] = ['squash_exact', 'squash_prefix', 'spelling_of', 'not_company']
    for (const k of ORDER) {
      const e = by.get(k)
      if (!e) continue
      log(`  ${String(e.phrases).padStart(8)} | ${e.products.toLocaleString().padStart(9)} | ${k}`)
    }
    const leakPhrases = ORDER.slice(0, 3).reduce((n, k) => n + (by.get(k)?.phrases ?? 0), 0)
    const leakProducts = ORDER.slice(0, 3).reduce((n, k) => n + (by.get(k)?.products ?? 0), 0)
    log('  ---------+-----------+-------------------------------------------')
    log(`  ${String(leakPhrases).padStart(8)} | ${leakProducts.toLocaleString().padStart(9)} | TOTAL LEAK (${((leakPhrases / phrases.size) * 100).toFixed(1)}% of phrases)`)
    log('')
    log('  squash_exact   the phrase IS the company name, differing only in')
    log('                 punctuation or word splits. A squash comparison in')
    log('                 startsWithBrand fixes every one of these.')
    log('  squash_prefix  one is a prefix of the other once squashed --')
    log('                 "7-eleven fresh to go" under "7-Eleven Inc." The')
    log('                 company part is a leak; what follows may be a real')
    log('                 sub-brand, so this class CANNOT be blind-stripped.')
    log('  spelling_of    r33 isSpellingOfLegalName says it is a misspelling')
    log('                 of the legal name. Highest risk of a false')
    log('                 positive -- READ EVERY ROW before acting on it.')

    for (const k of ORDER) {
      const rows = [...phrases.entries()].filter(([, v]) => v.k === k)
      if (rows.length === 0) continue
      const cap = k === 'not_company' ? 25 : 1000
      log('')
      log(`===== ${k} (${rows.length} phrases) ${k === 'not_company' ? `-- showing the 25 largest for contrast` : '-- EVERY ROW'} =====`)
      for (const [phrase, v] of rows.sort((a, b) => b[1].products - a[1].products).slice(0, cap)) {
        log(`  ${String(v.products).padStart(4)}  ${JSON.stringify(phrase).padEnd(42)} <- ${v.company}`)
        if (k !== 'not_company') for (const e of v.examples) log(`        e.g. ${e}`)
      }
    }

    // ---- DOES THE PHRASE KEY COLLIDE?
    //
    // DroppedPhraseVerdict is keyed on `phrase` alone and holds ONE verdict
    // per phrase. That is right for `Lindor`, which belongs to Lindt and to
    // nobody else. It is a problem for a generic word several companies use:
    // the classifier is shown the phrase with ONE company and three of ITS
    // product names, and the verdict it returns is then applied to every
    // company that shares the phrase.
    //
    // This assumption was built into the schema before it was measured, which
    // is the wrong order. Measuring it now.
    const shared = [...phrases.entries()].filter(([, v]) => v.companies.size > 1)
    const sharedProducts = shared.reduce((n, [, v]) => n + v.products, 0)
    log('')
    log('===== THE PHRASE KEY: HOW OFTEN DOES ONE PHRASE SPAN COMPANIES? =====')
    log(`  phrases used by more than one company: ${shared.length.toLocaleString()} of ${phrases.size.toLocaleString()} (${((shared.length / phrases.size) * 100).toFixed(1)}%)`)
    log(`  products they cover:                   ${sharedProducts.toLocaleString()}`)
    log('')
    log('  DroppedPhraseVerdict stores ONE verdict per phrase. Every row below')
    log('  gets a single verdict decided from ONE of these companies.')
    log('')
    for (const [phrase, v] of shared.sort((a, b) => b[1].companies.size - a[1].companies.size).slice(0, 40)) {
      log(`  ${String(v.companies.size).padStart(3)} companies, ${String(v.products).padStart(4)} products  ${JSON.stringify(phrase)}`)
      log(`        ${[...v.companies].slice(0, 6).join(' | ')}${v.companies.size > 6 ? ' | ...' : ''}`)
    }

    log('')
    log('===== WHAT THIS DECIDES =====')
    log('  Every phrase above the TOTAL LEAK line is one we would otherwise')
    log('  pay a model to tell us is the company name -- and then store a row')
    log('  for, keyed on a phrase that stops existing once the strip is fixed.')
    log('  NOTHING WAS WRITTEN. This script only counts.')
    log(`\nLog written to ${LOG_FILE}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

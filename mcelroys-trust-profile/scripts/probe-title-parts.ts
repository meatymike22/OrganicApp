// WHAT WOULD THE TITLE/SECONDARY SPLIT ACTUALLY CHANGE?
//
//   npx tsx src/lib/titleParts.ts --selftest        (21 cases)
//   npx tsx src/lib/titleOrientation.ts --selftest  (22 cases)
//   npx tsx scripts/probe-title-parts.ts
//
// READ-ONLY. No --live, nothing written, nothing swapped. splitTitleParts
// and orientSplit are DISPLAY functions; there is no column and no
// migration. This reports what the page shows today and what it WOULD show.
//
// WHAT IT IS FOR. 47,862 products print a comma inside their title. Michael,
// 2026-11-02: "remove this and simply put the secondary title beneath the
// product title". Hand-scoring 12 splits found 3 correctly split but
// INVERTED -- product in the secondary, marketing phrase as the <h1> -- so
// section 3 measures how many of those the catalogue's own vocabulary can
// identify for free, before any model call.
//
// THE TEST IS A COUNT AND A RATIO. A count alone scored 16/20 on real rows,
// failing wherever a rare head noun met a FLAVOUR tail ("Angel Food
// Mini-Cakes | Strawberry" -> would have put "Strawberry" in the <h1>). The
// lexicon therefore carries two counts per word, and the comma-free RATIO is
// what separates a product noun (sauce .91) from a flavour (strawberry .50).
// See titleOrientation.ts for the 113 excluded words, all read by hand.
//
// IT CHECKS ITS OWN AUTHOR, THREE WAYS.
//   1. The four SQL figures are ASSERTED, not printed. r34's mangled
//      predicate reported a plausible 2,484 and was caught only by a
//      pre-stated number.
//   2. lastNoun() in TypeScript and the SQL that builds the lexicon must
//      normalise identically. If they drift, every lookup misses and
//      orientSplit returns 'unknown' for everything WHILE LOOKING LIKE IT
//      RAN -- the r30/r33 false-"zero failures" failure mode. So a sample is
//      normalised both ways and any disagreement is fatal.
//   3. The threshold is printed at FIVE values in one run, with survivors,
//      so choosing it is a single read rather than four rounds of fitting a
//      rule to its own test set (the r33 mistake).

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'node:fs'
import path from 'node:path'
import { productDisplayName } from '../src/lib/productName'
import { splitTitleParts, type TitleBranch } from '../src/lib/titleParts'
import {
  orientSplit, lastNoun, isProductNoun, splitByProductNoun,
  MIN_COMPANIES, MIN_COMMA_FREE_RATIO,
  type Orientation,
} from '../src/lib/titleOrientation'
import { PRODUCT_NOUNS } from '../src/lib/productNouns.generated'

const BATCH = 20000
const SAMPLES_PER_BRANCH = 12
const NORM_SAMPLE = 4000

// Distinct-company floor for a word to enter the lexicon at all. Kept LOW:
// the real decision is minCompanies below, applied in TypeScript, so that
// one run can report several thresholds.
// The 50-company floor is settled (see titleOrientation.ts). What this
// sweeps is the COMMA-FREE RATIO, which is the gate that separates a product
// noun from a flavour word.
const RATIOS = [0.5, 0.6, 0.7, 0.8, 0.9]
const REPORT_AT = MIN_COMMA_FREE_RATIO

const EXPECTED = {
  comma_products: 63149,
  already_clean_after_strip: 15287,
  one_comma_needs_split: 25847,
  two_plus_needs_split: 22015,
}

const LOG_DIR = path.resolve('logs')
fs.mkdirSync(LOG_DIR, { recursive: true })
const LOG_FILE = path.join(
  LOG_DIR,
  `probe-title-parts-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
)
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
function log(line = '') {
  console.log(line)
  stream.write(line + '\n')
}
console.log(`Log file: ${LOG_FILE}`)

type Row = {
  id: string
  upc: string | null
  name: string
  legalName: string | null
  dbaNames: string[] | null
}

const BRANCHES: TitleBranch[] = ['no_comma', 'split', 'multi_field', 'short_head_list']

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
    // ============================================ 1. the asserted figures
    log('\n===== 1. SQL ARM: do the 2026-11-04 figures still hold? =====')
    const sqlRows = await prisma.$queryRaw<
      { comma_products: bigint; already_clean: bigint; one_comma: bigint; two_plus: bigint }[]
    >`
      WITH b AS (
        SELECT length(p.name) - length(replace(p.name, ',', '')) AS commas,
               lower(regexp_replace(split_part(p.name, ',', 1), '[^a-zA-Z0-9]', '', 'g')) AS f1,
               lower(regexp_replace(co."legalName",                '[^a-zA-Z0-9]', '', 'g')) AS legal
          FROM "Product" p
          JOIN "Company" co ON co.id = p."companyId"
         WHERE position(',' in p.name) > 0
      ), t AS (
        SELECT commas,
               (f1 <> '' AND (f1 = legal
                  OR (length(f1) >= 4 AND (legal LIKE f1 || '%' OR f1 LIKE legal || '%')))) AS f1_is_company
          FROM b
      )
      SELECT count(*)                                                 AS comma_products,
             count(*) FILTER (WHERE commas = 1 AND f1_is_company)     AS already_clean,
             count(*) FILTER (WHERE commas = 1 AND NOT f1_is_company) AS one_comma,
             count(*) FILTER (WHERE commas >= 2)                      AS two_plus
        FROM t`
    const sv = sqlRows[0]
    const got = {
      comma_products: Number(sv.comma_products),
      already_clean_after_strip: Number(sv.already_clean),
      one_comma_needs_split: Number(sv.one_comma),
      two_plus_needs_split: Number(sv.two_plus),
    }
    let drift = 0
    for (const k of Object.keys(EXPECTED) as (keyof typeof EXPECTED)[]) {
      const ok = got[k] === EXPECTED[k]
      if (!ok) drift++
      log(`  ${ok ? 'ok  ' : '!!  '}${k.padEnd(28)} expected ${EXPECTED[k].toLocaleString().padStart(8)}` +
          `   got ${got[k].toLocaleString().padStart(8)}` +
          (ok ? '' : `   DRIFT ${(got[k] - EXPECTED[k]).toLocaleString()}`))
    }
    if (drift > 0) log(`  !! ${drift} figure(s) drifted. Explain that before reading anything below.`)

    // ===================================== 2. the lexicon, and its agreement
    log('\n===== 2. THE PRODUCT-TYPE LEXICON, FROM THE CATALOGUE =====')
    // THE LEXICON IS READ FROM THE SHIPPED FILE, NOT RECOMPUTED.
    //
    // This probe used to carry its own copy of the lexicon SQL. That copy is
    // gone: scripts/generate-product-nouns.ts is now the only place it
    // lives, and this reads productNouns.generated.ts instead. The point is
    // not tidiness -- it is that the probe must measure THE LEXICON THAT
    // ACTUALLY SHIPS. A freshly-computed one could differ from the committed
    // file after any import, and then this report would describe a product
    // page that does not exist.
    const lexicon = PRODUCT_NOUNS
    log(`  words in productNouns.generated.ts: ${lexicon.size.toLocaleString()}`)
    log(`  of those, >= ${MIN_COMPANIES} companies (the floor): ` +
        `${[...lexicon.values()].filter((v) => v.all >= MIN_COMPANIES).length.toLocaleString()}`)
    log('')
    log('  comma-free ratio | words accepted as product nouns')
    log('  -----------------+---------------------------------')
    for (const rr of RATIOS) {
      const n = [...lexicon.keys()].filter((k) => isProductNoun(k, lexicon, MIN_COMPANIES, rr)).length
      log(`  ${rr.toFixed(2).padStart(16)} | ${n.toLocaleString().padStart(10)}`)
    }
    log('')
    log('  The 113 words excluded at 0.70 were read by hand and are listed in')
    log('  titleOrientation.ts. Every one is a flavour, fruit, nut or modifier.')
    log('  If this file is stale, regenerate it:')
    log('    npx tsx scripts/generate-product-nouns.ts        (prints a diff)')
    log('    npx tsx scripts/generate-product-nouns.ts --write')

    // THE AGREEMENT TEST. If lastNoun() and the SQL above disagree, every
    // lookup misses and orientSplit returns 'unknown' for everything while
    // appearing to work. This is the exact failure mode that produced a
    // false "zero fetch failures" in r30 and again in r33.
    log('\n  normalisation agreement, lastNoun() vs the GENERATOR\'s SQL:')
    const normRows = await prisma.$queryRaw<{ name: string; sqlword: string }[]>`
      SELECT p.name,
             lower(btrim(regexp_replace(
               regexp_replace(p.name, '[^[:alnum:][:space:]]', '', 'g'),
               '^.*[[:space:]]', ''))) AS sqlword
        FROM "Product" p
       WHERE p.name ~ '[[:space:]]'
       ORDER BY md5(p.id)
       LIMIT ${NORM_SAMPLE}`
    let agree = 0
    const mismatches: string[] = []
    for (const r of normRows) {
      const ts = lastNoun(r.name)
      if (ts === r.sqlword) agree++
      else if (mismatches.length < 10)
        mismatches.push(`    ${JSON.stringify(r.name)}\n      SQL ${JSON.stringify(r.sqlword)}  TS ${JSON.stringify(ts)}`)
    }
    log(`    ${agree.toLocaleString()} / ${normRows.length.toLocaleString()} agree`)
    if (agree !== normRows.length) {
      log(`    !! ${normRows.length - agree} DISAGREE. The lexicon lookup is unreliable;`)
      log('       section 3 below is MEANINGLESS until this is fixed.')
      for (const m of mismatches) log(m)
      drift++
    } else {
      log('    ok - identical on every sampled row.')
    }

    // ========================================== 3. the walk over everything
    log('\n===== 3. BRANCH AND ORIENTATION, THROUGH THE REAL DISPLAY PATH =====')
    const tally = new Map<string, number>()
    const samples = new Map<TitleBranch, Row[]>()
    for (const b of BRANCHES) samples.set(b, [])
    // orientation counts per threshold
    const orient = new Map<number, Map<Orientation, number>>()
    for (const rr of RATIOS) orient.set(rr, new Map())
    const inverted: Row[] = []
    const unknown: Row[] = []

    // THE PRODUCT-NOUN RULE (Michael, 2026-11-06), measured alongside the
    // rule the page currently uses. Nothing here changes a page; this exists
    // to answer ONE question with data instead of a guess: the field this
    // rule drops is sometimes a product LINE that distinguishes the product
    // ("Fresh Selections", "Steamfresh") and sometimes a MOTTO that does not
    // ("Our Speciality"). He wants the first kept and the second gone. So
    // every dropped phrase is censused by product and by DISTINCT COMPANY,
    // because a line belongs to one company and a motto spreads across many
    // -- the same shape as r34's category-word rule.
    const nounOutcome = new Map<string, number>()
    const droppedPhrase = new Map<string, { products: number; companies: Set<string> }>()
    const droppedSamples: { row: Row; dropped: string }[] = []
    let gainedSecondary = 0
    let lostSecondary = 0

    let scanned = 0
    let cursor = ''
    for (;;) {
      const rows = await prisma.$queryRaw<Row[]>`
        SELECT p.id, p.upc, p.name, co."legalName", co."dbaNames"
          FROM "Product" p
          LEFT JOIN "Company" co ON co.id = p."companyId"
         WHERE p.id > ${cursor}
         ORDER BY p.id
         LIMIT ${BATCH}`
      if (rows.length === 0) break

      for (const r of rows) {
        const displayed = productDisplayName(r.name, r.legalName, r.dbaNames ?? [])
        const parts = splitTitleParts(displayed)
        const commas = (r.name.match(/,/g) ?? []).length
        tally.set(`${Math.min(commas, 3)}|${parts.branch}`,
                  (tally.get(`${Math.min(commas, 3)}|${parts.branch}`) ?? 0) + 1)

        const bucket = samples.get(parts.branch)!
        if (bucket.length < SAMPLES_PER_BRANCH && commas > 0) bucket.push(r)

        // ---- the product-noun rule, measured in the same pass
        const ns = splitByProductNoun(displayed)
        const key = ns.dropped ? (ns.secondary ? 'title+secondary, dropped' : 'title only, dropped')
                  : ns.secondary ? (ns.foundNoun ? 'title+secondary' : 'title+secondary (fallback)')
                  : 'title only'
        nounOutcome.set(key, (nounOutcome.get(key) ?? 0) + 1)
        if (ns.secondary !== undefined && parts.secondary === undefined) gainedSecondary++
        if (ns.secondary === undefined && parts.secondary !== undefined) lostSecondary++
        if (ns.dropped) {
          const d = ns.dropped.toLowerCase()
          let e = droppedPhrase.get(d)
          if (e === undefined) { e = { products: 0, companies: new Set() }; droppedPhrase.set(d, e) }
          e.products++
          if (r.legalName) e.companies.add(r.legalName)
          if (droppedSamples.length < 25) droppedSamples.push({ row: r, dropped: ns.dropped })
        }

        if (parts.branch === 'split' && parts.secondary !== undefined) {
          for (const rr of RATIOS) {
            const o = orientSplit(parts.title, parts.secondary, lexicon, MIN_COMPANIES, rr)
            const m = orient.get(rr)!
            m.set(o, (m.get(o) ?? 0) + 1)
          }
          const at = orientSplit(parts.title, parts.secondary, lexicon, MIN_COMPANIES, REPORT_AT)
          if (at === 'tail_is_product' && inverted.length < 20) inverted.push(r)
          if (at === 'unknown' && unknown.length < 14) unknown.push(r)
        }
      }
      scanned += rows.length
      cursor = rows[rows.length - 1].id
      if (scanned % 100000 < BATCH) console.log(`  ... ${scanned.toLocaleString()} scanned`)
    }
    log(`\n  scanned ${scanned.toLocaleString()} products`)

    log('')
    log('  commas in stored name |   no_comma |      split | multi_field | short_head')
    log('  ----------------------+------------+------------+-------------+-----------')
    const totals = new Map<TitleBranch, number>()
    for (const c of [0, 1, 2, 3]) {
      const cells = BRANCHES.map((b) => tally.get(`${c}|${b}`) ?? 0)
      BRANCHES.forEach((b, i) => totals.set(b, (totals.get(b) ?? 0) + cells[i]))
      log(`  ${(c === 3 ? '3 or more' : String(c)).padStart(21)} | ` +
          cells.map((n, i) => n.toLocaleString().padStart(i === 3 ? 9 : 10)).join(' | '))
    }
    log('  ----------------------+------------+------------+-------------+-----------')
    log(`  ${'TOTAL'.padStart(21)} | ` +
        BRANCHES.map((b, i) => (totals.get(b) ?? 0).toLocaleString().padStart(i === 3 ? 9 : 10)).join(' | '))

    const split = totals.get('split') ?? 0
    log(`\n  ===== ORIENTATION OF THE SPLITS, RATIO SWEEP (floor ${MIN_COMPANIES} companies) =====`)
    log('  A HIGHER ratio is STRICTER about what counts as a product noun, so')
    log('  fewer heads qualify and more rows fall to unknown. 0.70 is the')
    log('  validated setting; the sweep is here so the choice stays visible.')
    log('')
    log('   comma-free ratio | head_is_product | tail_is_product (INVERTED) |    unknown')
    log('  -----------------+-----------------+----------------------------+-----------')
    for (const t of RATIOS) {
      const m = orient.get(t)!
      const h = m.get('head_is_product') ?? 0
      const ta = m.get('tail_is_product') ?? 0
      const u = m.get('unknown') ?? 0
      if (h + ta + u !== split) log(`  !! threshold ${t}: buckets sum to ${h + ta + u}, not ${split}`)
      log(`  ${t.toFixed(2).padStart(17)} | ${h.toLocaleString().padStart(15)} | ` +
          `${ta.toLocaleString().padStart(26)} | ${u.toLocaleString().padStart(10)}`)
    }
    log('')
    log('  The count-only version of this test scored 16/20 on hand-read rows;')
    log('  the ratio version scores 19/20. The remaining miss is a mis-SPLIT')
    log('  ("boneless, skinless"), ~41 products, deliberately unguarded.')

    // ========================== 4. the product-noun rule, measured
    log('\n===== 4. THE PRODUCT-NOUN RULE (not wired to the page) =====')
    log('  first field carrying a product noun is the TITLE; after it is the')
    log('  SECONDARY; before it is DROPPED (a brand, a line, or a motto).')
    log('')
    for (const [k, v] of [...nounOutcome].sort((a, b) => b[1] - a[1]))
      log(`  ${v.toLocaleString().padStart(8)}  ${k}`)
    log('')
    log(`  products that GAIN a secondary vs the current rule: ${gainedSecondary.toLocaleString()}`)
    log(`  products that LOSE a secondary vs the current rule: ${lostSecondary.toLocaleString()}`)
    log(`  distinct dropped phrases: ${droppedPhrase.size.toLocaleString()}`)

    log('\n  ===== DROPPED PHRASES: IS IT A LINE OR A MOTTO? =====')
    log('  A product LINE belongs to one company and distinguishes its own')
    log('  products. A MOTTO spreads across many companies and distinguishes')
    log('  nothing. If that holds, "companies" below separates them and the')
    log('  rule writes itself. If it does not, read the list and say so.')
    log('')
    log('   products | companies | phrase')
    log('  ----------+-----------+----------------------------------------')
    const census = [...droppedPhrase.entries()]
      .map(([phrase, v]) => ({ phrase, products: v.products, companies: v.companies.size }))
      .sort((a, b) => b.products - a.products)
    for (const c of census.slice(0, 70))
      log(`  ${c.products.toLocaleString().padStart(9)} | ${String(c.companies).padStart(9)} | ${c.phrase}`)
    log('')
    const oneCo = census.filter((c) => c.companies === 1)
    const manyCo = census.filter((c) => c.companies >= 5)
    log(`  phrases used by exactly ONE company:  ${oneCo.length.toLocaleString()}` +
        `  (${oneCo.reduce((n, c) => n + c.products, 0).toLocaleString()} products)`)
    log(`  phrases used by FIVE or more:         ${manyCo.length.toLocaleString()}` +
        `  (${manyCo.reduce((n, c) => n + c.products, 0).toLocaleString()} products)`)

    log('\n  --- sample rows where something is dropped ---')
    for (const d of droppedSamples) {
      const displayed = productDisplayName(d.row.name, d.row.legalName, d.row.dbaNames ?? [])
      const ns = splitByProductNoun(displayed)
      log('')
      log(`  ${d.row.upc ?? '(no upc)'}   company: ${d.row.legalName ?? '(none)'}`)
      log(`    TODAY:     ${displayed}`)
      log(`    title      ${ns.title}`)
      log(`    secondary  ${ns.secondary ?? '(none)'}`)
      log(`    DROPPED    ${ns.dropped}`)
    }

    // ---------------------------------------------------------- hand scoring
    log('\n===== EVERY SAMPLE ROW, FOR HAND SCORING =====')
    log('  Judge the AFTER lines. "title" is the <h1>; "secondary" sits beneath.')
    for (const b of BRANCHES) {
      const bucket = samples.get(b)!
      if (bucket.length === 0) continue
      log(`\n  --- ${b} (${(totals.get(b) ?? 0).toLocaleString()} products) ---`)
      for (const r of bucket) print(r)
    }

    log(`\n  --- FLAGGED INVERTED at ratio=${REPORT_AT} ---`)
    log('  These would have title and secondary SWAPPED. Is the swap right?')
    for (const r of inverted) print(r, true)

    log(`\n  --- 'unknown' at ratio=${REPORT_AT} (neither side is a product noun) ---`)
    log('  These are the model pass\'s population. Orientation only, boundary known.')
    for (const r of unknown) print(r, true)

    log('\n===== NOTHING WAS WRITTEN AND NOTHING WAS SWAPPED =====')
    log('  orientSplit only REPORTS. Applying it is a separate change.')
    log(`\nLog written to ${LOG_FILE}`)
    if (drift > 0) process.exitCode = 1

    function print(r: Row, withOrientation = false) {
      const displayed = productDisplayName(r.name, r.legalName, r.dbaNames ?? [])
      const parts = splitTitleParts(displayed)
      log('')
      log(`  ${r.upc ?? '(no upc)'}   company on file: ${r.legalName ?? '(none)'}`)
      log(`    stored:    ${r.name}`)
      log(`    TODAY:     ${displayed}`)
      if (parts.secondary === undefined) {
        log(`    AFTER:     ${parts.title}`)
        log(`               (unchanged - ${parts.branch})`)
      } else {
        log(`    AFTER:     title     ${parts.title}`)
        log(`               secondary ${parts.secondary}`)
        if (withOrientation) {
          const show = (w: string) => {
            const s2 = lexicon.get(w)
            if (s2 === undefined) return `"${w}" absent`
            const r2 = (s2.commaFree / s2.all).toFixed(2)
            return `"${w}" ${s2.all}co ratio ${r2}${isProductNoun(w, lexicon, MIN_COMPANIES, REPORT_AT) ? ' NOUN' : ''}`
          }
          log(`      nouns:   head ${show(lastNoun(parts.title))}   ` +
              `tail ${show(lastNoun(parts.secondary))}`)
          log(`      SWAPPED: title     ${parts.secondary}`)
          log(`               secondary ${parts.title}`)
        }
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  log(`\nFAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  process.exitCode = 1
})

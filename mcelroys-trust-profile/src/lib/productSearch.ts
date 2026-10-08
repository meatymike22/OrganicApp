import type { Prisma } from '@prisma/client'

// SEARCHING BY BRAND AND PRODUCT AT THE SAME TIME.
//
// WHY THIS EXISTS. Michael, 2026-10-07, after checking us against Yuka:
// "after looking up 'clover sonoma, organic cream cheese' up on Yuka, it has
// the product picture and the ingredient list, but we dont have any of it.
// also, for example, when i look up Yasso Pistachio, Yuka has the yasso
// pistachio brittle bars but we dont."
//
// WE HAD BOTH PRODUCTS THE WHOLE TIME.
//
//   Clover Sonoma "Organic Cream Cheese", UPC 0070852992952 — 5 ingredients,
//   photo on file.
//   Yasso "pistachio brittle frozen greek yogurt bars", UPC 0851035003647 —
//   16 ingredients, photo on file.
//
// This was never an ingestion gap. It was the search. The old query matched
// the ENTIRE query string as one substring:
//
//     OR: [ { name: { contains: q } },
//           { companyId: { in: companiesWhoseLegalNameContains(q) } } ]
//
// "Yasso Pistachio" is not a substring of "pistachio brittle frozen greek
// yogurt bars" (the brand is stripped from the stored name and lives in the
// Company table), and it is not a substring of "Yasso" either. So both
// branches missed and the page said we hold nothing. Any query that spans a
// brand AND a product word — which is how people search for groceries —
// returned nothing. So did anything with a comma in it.
//
// THE FIX: tokenise, and require every token to be found SOMEWHERE — in the
// product name or in its company's name.
//
// ---------------------------------------------------------------- the cost
//
// Measured on the live database, 2026-10-07. The naive form of this is the
// trap, so the numbers are here to stop anyone rewriting it that way:
//
//   per-token  (name ILIKE tok OR companyId IN (...))  AND'd together
//     ............................................. 2,878 ms, seq scan of
//     all 416,382 products. The OR on each token defeats the trigram index.
//
//   this module's shape (one OR of two whole branches)
//     "clover sonoma organic cream cheese" ............ 89 ms
//     "yasso pistachio" ............................... 17 ms
//     company scoring lookup (5 tokens) ................ 6 ms
//
// It is fast for a reason worth knowing: branch B requires EVERY token in the
// name, and branch A requires a subset of them, so Postgres factors the
// shared `name ILIKE` conditions out of the OR and serves them from
// Product_name_trgm_idx as one bitmap scan. Keep branch B a superset of
// branch A's name conditions or that optimisation is lost.

// Two characters is the shortest token worth matching: a single letter
// matches most of the catalogue and costs a scan to discover it.
const MIN_TOKEN = 2
// More tokens than this is a sentence, not a search. Extra tokens are
// dropped rather than making the query slower and stricter.
const MAX_TOKENS = 6
// Above this many brand candidates the IN list stops being worth it; the
// name-only branch still answers the query.
const MAX_BRAND_IDS = 300

// Words that carry no selectivity in a grocery catalogue. Dropped only when
// something else survives, so a search for exactly "and" still does what it
// did before rather than matching everything.
const NOISE = new Set(['and', 'the', 'of', 'with', 'for', 'de', 'la', 'oz'])

export function tokenise(q: string): string[] {
  const raw = q
    .toLowerCase()
    // Everything that is not a letter or digit is a separator. This is what
    // makes "clover sonoma, organic cream cheese" work: the comma was fatal
    // to the old single-substring match.
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= MIN_TOKEN)

  const seen = new Set<string>()
  const kept: string[] = []
  for (const t of raw) {
    if (seen.has(t)) continue
    seen.add(t)
    kept.push(t)
  }
  const meaningful = kept.filter((t) => !NOISE.has(t))
  return (meaningful.length > 0 ? meaningful : kept).slice(0, MAX_TOKENS)
}

// Which companies best explain the brand part of the query, and which tokens
// they account for.
//
// Scored rather than required-all: "clover sonoma organic cream cheese" has
// five tokens and no company name contains all five, but "Clover Sonoma"
// contains two, which is more than any other company. Those two are then the
// brand and the remaining three must appear in the product name.
export function pickBrand(
  tokens: string[],
  companies: { id: string; legalName: string }[]
): { ids: string[]; accounted: Set<string> } {
  let best = 0
  const scored: { id: string; matched: string[] }[] = []

  for (const c of companies) {
    const name = c.legalName.toLowerCase()
    const matched = tokens.filter((t) => name.includes(t))
    if (matched.length === 0) continue
    scored.push({ id: c.id, matched })
    if (matched.length > best) best = matched.length
  }

  if (best === 0) return { ids: [], accounted: new Set<string>() }

  const winners = scored.filter((s) => s.matched.length === best)
  const accounted = new Set<string>()
  // Only tokens EVERY winner accounts for are treated as the brand. If two
  // companies tie on different tokens, neither token is safe to drop from
  // the name requirement — otherwise a query would quietly stop requiring a
  // word it shares with some unrelated company.
  for (const t of winners[0].matched) {
    if (winners.every((w) => w.matched.includes(t))) accounted.add(t)
  }

  return { ids: winners.map((w) => w.id).slice(0, MAX_BRAND_IDS), accounted }
}

// The product `where` for a tokenised query.
export function searchWhere(
  tokens: string[],
  brand: { ids: string[]; accounted: Set<string> }
): Prisma.ProductWhereInput {
  const nameAll = tokens.map((t) => ({ name: { contains: t, mode: 'insensitive' as const } }))

  // Every token must be in the product name.
  const byName: Prisma.ProductWhereInput = { AND: nameAll }

  if (brand.ids.length === 0) return byName

  const rest = tokens.filter((t) => !brand.accounted.has(t))
  const byBrand: Prisma.ProductWhereInput = {
    AND: [
      { companyId: { in: brand.ids } },
      ...rest.map((t) => ({ name: { contains: t, mode: 'insensitive' as const } })),
    ],
  }

  return { OR: [byBrand, byName] }
}

// The OR of per-token company lookups, as one query. 6 ms for five tokens.
export function brandLookupWhere(tokens: string[]): Prisma.CompanyWhereInput {
  return {
    OR: tokens.flatMap((t) => [
      { legalName: { contains: t, mode: 'insensitive' as const } },
      { dbaNames: { has: t } },
    ]),
  }
}

// --------------------------------------------------------------- self test
// npx tsx src/lib/productSearch.ts --selftest
// The two pure functions, including the cases from the comment above.

function selfTest(): boolean {
  const cases: { label: string; got: unknown; want: unknown }[] = []
  const eq = (label: string, got: unknown, want: unknown) => cases.push({ label, got, want })

  eq('comma query splits', tokenise('clover sonoma, organic cream cheese'), [
    'clover', 'sonoma', 'organic', 'cream', 'cheese',
  ])
  eq('two words', tokenise('Yasso Pistachio'), ['yasso', 'pistachio'])
  eq('single word unchanged', tokenise('chobani'), ['chobani'])
  eq('one-letter tokens dropped', tokenise('a b peanut'), ['peanut'])
  eq('duplicates collapse', tokenise('milk milk MILK'), ['milk'])
  eq('noise dropped', tokenise('peanut butter and jelly'), ['peanut', 'butter', 'jelly'])
  eq('noise-only survives as itself', tokenise('and the'), ['and', 'the'])
  eq('punctuation only -> nothing', tokenise('!!! ,,,'), [])
  eq('apostrophe splits', tokenise("cookies 'n cream"), ['cookies', 'cream'])
  eq('digits kept', tokenise('red 40 lake'), ['red', '40', 'lake'])
  eq('capped at six', tokenise('one two three four five six seven eight').length, 6)

  const clover = pickBrand(['clover', 'sonoma', 'organic', 'cream', 'cheese'], [
    { id: 'cs', legalName: 'Clover Sonoma' },
    { id: 'cv', legalName: 'Clover Valley' },
    { id: 'oo', legalName: 'Organic Valley' },
  ])
  eq('best company wins on token count', clover.ids, ['cs'])
  eq('its tokens are accounted for', [...clover.accounted].sort(), ['clover', 'sonoma'])

  const yasso = pickBrand(['yasso', 'pistachio'], [{ id: 'y', legalName: 'Yasso' }])
  eq('single brand token', [...yasso.accounted], ['yasso'])

  // A TIE ON DIFFERENT TOKENS must not drop either token from the name
  // requirement — otherwise "organic milk" would match every product of a
  // company called "Organic X" regardless of the word "milk".
  const tie = pickBrand(['organic', 'milk'], [
    { id: 'a', legalName: 'Organic Foods' },
    { id: 'b', legalName: 'Milk Co' },
  ])
  eq('tie on different tokens accounts for none', [...tie.accounted], [])
  eq('tie still offers both companies', tie.ids.sort(), ['a', 'b'])

  const none = pickBrand(['zzzz'], [{ id: 'a', legalName: 'Organic Foods' }])
  eq('no company match', none.ids, [])

  // The where shape: branch B must require every token, so Postgres can
  // factor the shared conditions out of the OR.
  const w = searchWhere(['yasso', 'pistachio'], { ids: ['y'], accounted: new Set(['yasso']) }) as {
    OR: { AND: unknown[] }[]
  }
  eq('two branches', w.OR.length, 2)
  eq('brand branch: company + 1 remaining token', w.OR[0].AND.length, 2)
  eq('name branch: all tokens', w.OR[1].AND.length, 2)

  const noBrand = searchWhere(['pistachio'], { ids: [], accounted: new Set() }) as {
    AND: unknown[]
  }
  eq('no brand -> single AND, no OR', noBrand.AND.length, 1)

  let pass = 0
  for (const c of cases) {
    const ok = JSON.stringify(c.got) === JSON.stringify(c.want)
    if (ok) pass++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.label}`)
    if (!ok) console.log(`        got  ${JSON.stringify(c.got)}\n        want ${JSON.stringify(c.want)}`)
  }
  console.log(`\n${pass}/${cases.length} passed.`)
  return pass === cases.length
}

// GUARDED. This module lives in src/lib and is bundled into the app, so a
// bare process.argv at module scope would throw in any runtime that has no
// process (an edge runtime, a client bundle). The selftest only ever runs
// when the file is invoked directly with npx tsx.
if (typeof process !== 'undefined' && process.argv?.includes('--selftest')) {
  process.exitCode = selfTest() ? 0 : 1
}

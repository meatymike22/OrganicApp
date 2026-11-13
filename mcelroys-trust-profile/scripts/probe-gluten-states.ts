// READ-ONLY. What the gluten row actually says, across every published
// product, using the REAL glutenSignal and the REAL grain matcher.
//
// WHY A PROBE AND NOT A SQL QUERY. The r38 company-name round made this
// mistake once: a SQL approximation of a code path sized a problem at 2,719
// products when the real answer was 845. This row's answer depends on
// precedence across nine branches, so the only honest way to count it is to
// run the function.
//
// ⚠️ THE FIRST VERSION DIED IN STEP 2 WITH NOTHING IN THE LOG, because its
// catch block only wrote to stderr. Two changes: the error is logged, and
// the products are paged with a cursor instead of pulled in one 401,902-row
// raw query inside a transaction.
//
// It also used to read `SELECT DISTINCT "productId" FROM "ProductIngredient"`
// over 3.5 million rows to decide whether a product had any ingredient list.
// That is dropped: `hasIngredientList` only picks between two wordings of the
// same detail text in branches 5 and 8, and changes no state and no label, so
// it cannot affect a distribution.
//
// Usage (PowerShell, from mcelroys-trust-profile):
//   npx tsx scripts/probe-gluten-states.ts
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { glutenSignal, nameIsGlutenGrain, type ProductForSignals } from '@/lib/productSignals'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter, queryPlanCacheMaxSize: 0 } as unknown as ConstructorParameters<typeof PrismaClient>[0])

fs.mkdirSync('./logs', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const LOG_FILE = path.join('./logs', `probe-gluten-states-${stamp}.txt`)
function log(line: string) {
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

async function slowQuery<T>(query: Prisma.PrismaPromise<T>): Promise<T> {
  const [, result] = await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '20min'`),
    query,
  ])
  return result as T
}

const EXAMPLES: Record<string, string> = {
  '1f19b0dc-8cab-48c5-87cb-89ddc3e5263e': 'Everything Bagel',
  'a2ddfdba-11c7-492d-8347-4c8b46cec2f8': 'Dark chocolate coconut almond bites',
}

const PAGE = 20_000
const ID_CHUNK = 1_000

async function main() {
  log(`log: ${LOG_FILE}`)

  // Step 1 — which Ingredient rows are gluten grains, by the real matcher.
  const ingredients = await slowQuery(prisma.ingredient.findMany({ select: { id: true, name: true } }))
  const grainName = new Map<string, string>()
  for (const i of ingredients) if (nameIsGlutenGrain(i.name)) grainName.set(i.id, i.name)
  log(`\n${grainName.size} of ${ingredients.length} ingredient rows are gluten grains`)

  // Step 2 — their product links, chunked so no single IN list is huge.
  const grainsByProduct = new Map<string, string[]>()
  const ids = [...grainName.keys()]
  let linkCount = 0
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK)
    const links = await slowQuery(
      prisma.productIngredient.findMany({
        where: { ingredientId: { in: chunk } },
        select: { productId: true, ingredientId: true },
      })
    )
    linkCount += links.length
    for (const l of links) {
      const n = grainName.get(l.ingredientId)
      if (n === undefined) continue
      const list = grainsByProduct.get(l.productId)
      if (list) list.push(n)
      else grainsByProduct.set(l.productId, [n])
    }
  }
  log(`${linkCount} product-to-gluten-grain links across ${grainsByProduct.size} products`)

  // Step 3 — page the products and run the real function.
  // EXPLICIT, to break a circular inference: `cursor` is assigned from
  // `page`, and `page` references `cursor` in its own initializer, so without
  // an annotation tsc reports 'page implicitly has type any'.
  type Pg = {
    id: string
    name: string
    productType: string
    labelClaims: string[]
    labelClaimsCheckedAt: Date | null
    labelAllergens: string[]
    labelAllergenTraces: string[]
    ingredientCheckedAt: Date | null
  }

  const byLabel = new Map<string, number>()
  const byState = new Map<string, number>()
  let total = 0
  let cursor: string | undefined = undefined

  for (;;) {
    const page: Pg[] = await slowQuery(
      prisma.product.findMany({
        where: { publicationStatus: 'published' },
        select: {
          id: true, name: true, productType: true,
          labelClaims: true, labelClaimsCheckedAt: true,
          labelAllergens: true, labelAllergenTraces: true,
          ingredientCheckedAt: true,
        },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor === undefined ? {} : { skip: 1, cursor: { id: cursor } }),
      })
    )
    if (page.length === 0) break
    cursor = page[page.length - 1].id

    for (const p of page) {
      total++
      const grains = grainsByProduct.get(p.id) ?? []
      const forSignals = {
        id: p.id,
        productType: p.productType,
        ingredientDisclosureStatus: 'disclosed',
        ingredientCheckedAt: p.ingredientCheckedAt,
        labelClaims: p.labelClaims,
        labelClaimsCheckedAt: p.labelClaimsCheckedAt,
        labelAllergens: p.labelAllergens,
        labelAllergenTraces: p.labelAllergenTraces,
        // Only the gluten-grain rows can change this function's answer.
        productIngredients: grains.map((name) => ({
          isTrace: false,
          ingredient: { name, flaggedForResearch: false },
        })),
        certifications: [],
        productCertifications: [],
        company: { id: 'x', legalName: 'x', vettingStatus: 'vetted', parentCompany: null },
      } as unknown as ProductForSignals

      const sig = glutenSignal(forSignals)
      byLabel.set(sig.label, (byLabel.get(sig.label) ?? 0) + 1)
      byState.set(sig.state, (byState.get(sig.state) ?? 0) + 1)

      const which = EXAMPLES[p.id]
      if (which !== undefined) {
        log(`\n--- ${which} (${p.id})`)
        log(`    claims        ${JSON.stringify(p.labelClaims)}  checkedAt=${p.labelClaimsCheckedAt?.toISOString() ?? 'null'}`)
        log(`    allergens     ${JSON.stringify(p.labelAllergens)}`)
        log(`    traces        ${JSON.stringify(p.labelAllergenTraces)}`)
        log(`    gluten grains ${JSON.stringify(grains)}`)
        log(`    => ${sig.label} / ${sig.state}`)
        log(`    ${sig.short ?? ''}`)
      }
    }
    if (page.length < PAGE) break
  }
  log(`\n${total} published products scored`)

  log('\n--- BY ANSWER ---')
  for (const [k, v] of [...byLabel.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${String(v).padStart(7)}  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`)
  }
  log('\n--- BY COLOUR ---')
  const colour: Record<string, string> = {
    confirmed: 'green  (yes)', nothingOnFile: 'grey   (no)', openResearch: 'amber  (maybe)',
    unchecked: 'blue   (not checked)', notApplicable: 'stone  (n/a)',
  }
  for (const [k, v] of [...byState.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${String(v).padStart(7)}  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${colour[k] ?? k}`)
  }
  log(`\nlog written to ${LOG_FILE}`)
}

main()
  .catch((e) => {
    // THE FIRST VERSION LOST ITS OWN ERROR by only writing to stderr.
    const msg = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e)
    fs.appendFileSync(LOG_FILE, `[ERROR] ${msg}\n`)
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

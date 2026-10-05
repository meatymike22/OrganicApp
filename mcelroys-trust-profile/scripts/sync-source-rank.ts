// RE-SYNC Product.sourceRank from Company.vettingMethod.
//
// sourceRank duplicates what Company already knows, so that Search can sort
// on an index instead of sorting 411,000 rows on every page view. See the
// comment on Product.sourceRank in prisma/schema.prisma for the measurement.
//
// RUN THIS after anything that changes how a company is vetted — most often
// scripts/vet-companies.ts, but also a hand edit in the database. Until it
// runs, a newly confirmed company's products sort as if they were still
// unconfirmed.
//
// WHAT STALENESS COSTS: row order, and nothing else. sourceRank never feeds a
// claim about a product or a company, and it is NOT what hides the products of
// a rejected company — Search excludes those by a real join on
// Company.vettingStatus, precisely so that a stale rank can never publish a
// record a reviewer threw out. A product sorted a page too late is a cosmetic
// bug; a product that should not be visible at all is not.
//
// USAGE
//   npx tsx scripts/sync-source-rank.ts          Dry run: reports what would change.
//   npx tsx scripts/sync-source-rank.ts --live   Apply.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const DRY_RUN = !process.argv.includes('--live')

// Lower sorts first. Kept in step with the comment on Product.sourceRank and
// with the migration that introduced the column.
const RANKS: Record<string, number> = {
  human: 10,
  automated_usda: 20,
  automated_recall: 30,
  automated_ai: 40,
}
const UNCONFIRMED = 90

async function main() {
  console.log(DRY_RUN ? 'DRY RUN — nothing will be written' : 'LIVE RUN')

  // What the ranks SHOULD be, computed in the database rather than pulled
  // into Node: there are 416k products and this is one expression.
  const wanted = Object.entries(RANKS)
    .map(([method, rank]) => `WHEN c."vettingMethod" = '${method}' THEN ${rank}`)
    .join(' ')

  const plan = await prisma.$queryRawUnsafe<{ current: number; target: number; n: bigint }[]>(`
    SELECT p."sourceRank" AS current,
           CASE WHEN c."vettingStatus" <> 'vetted' THEN ${UNCONFIRMED}
                ${wanted}
                ELSE ${UNCONFIRMED}
           END AS target,
           COUNT(*) AS n
      FROM "Product" p
      JOIN "Company" c ON c.id = p."companyId"
     GROUP BY 1, 2
     ORDER BY 1, 2
  `)

  let changing = 0
  for (const row of plan) {
    const n = Number(row.n)
    if (row.current !== row.target) changing += n
    console.log(`  ${String(row.current).padStart(3)} -> ${String(row.target).padStart(3)}  ${n.toLocaleString().padStart(9)}${row.current === row.target ? '  (no change)' : ''}`)
  }
  console.log(`\nProducts whose rank ${DRY_RUN ? 'would change' : 'will change'}: ${changing.toLocaleString()}`)

  if (DRY_RUN) {
    console.log('\nRe-run with --live to apply.')
    return
  }
  if (changing === 0) {
    console.log('Nothing to do.')
    return
  }

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "Product" p
       SET "sourceRank" = CASE WHEN c."vettingStatus" <> 'vetted' THEN ${UNCONFIRMED}
                               ${wanted}
                               ELSE ${UNCONFIRMED}
                          END
      FROM "Company" c
     WHERE c.id = p."companyId"
       AND p."sourceRank" <> CASE WHEN c."vettingStatus" <> 'vetted' THEN ${UNCONFIRMED}
                                  ${wanted}
                                  ELSE ${UNCONFIRMED}
                             END
  `)
  console.log(`Updated ${updated.toLocaleString()} products.`)

  // The planner needs to know the distribution changed, or it may keep a
  // plan chosen for the old one.
  await prisma.$executeRawUnsafe('ANALYZE "Product"')
  console.log('Re-analysed Product.')
}

main()
  .catch((e) => {
    console.error('Fatal:', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

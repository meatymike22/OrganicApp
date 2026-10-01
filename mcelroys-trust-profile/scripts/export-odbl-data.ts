// EXPORT the Open Food Facts–derived part of Rootify's database, for the
// ODbL share-alike obligation.
//
// WHY: Rootify's products, brands, ingredient lists and nutrition panels
// largely come from Open Food Facts (OFF), whose database is licensed under
// the Open Database License (ODbL 1.0). Rootify has changed that data
// (categories, brand → company matching, merged duplicates, cleaned
// ingredient lists). Under the ODbL, a "Derivative Database" that is used
// publicly must itself be offered under the ODbL. This script produces that
// offer: plain CSV files plus a licence notice, ready to publish (e.g. as a
// download linked from the site). Whether and how it must be published is
// for the lawyer review — see compliance/odbl-share-alike.md.
//
// WHAT IT EXPORTS (only data that came from, or was built on, OFF):
//   products.csv      products imported from OFF: barcode, name, brand
//                     (company), parent company, category and where the
//                     category came from
//   companies.csv     the companies those products belong to
//   ingredients.csv   ingredient lists that were read from OFF
//   nutrition.csv     nutrition panels that were read from OFF
//   LICENSE.txt       the ODbL / DbCL notice and attribution
// It does NOT export data from other sources (recalls, USDA, certifications,
// SEC filings), Rootify's own research, or anything about users.
//
// READ-ONLY: nothing in the database is changed.
//
// USAGE
//   npx tsx scripts/export-odbl-data.ts            writes ./data/odbl-export/<date>/
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter } as unknown as ConstructorParameters<typeof PrismaClient>[0])

const DAY = new Date().toISOString().slice(0, 10)
const OUT = path.join('./data/odbl-export', DAY)
const PAGE = 5000

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return ''
  const s = v instanceof Date ? v.toISOString() : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Writes one gzipped CSV, reading the query page by page (keyset on the
// first column, which must be a unique id).
async function exportTable(file: string, header: string[], sql: string): Promise<number> {
  const gz = zlib.createGzip()
  const out = fs.createWriteStream(path.join(OUT, file + '.gz'))
  gz.pipe(out)
  gz.write(header.join(',') + '\n')
  let after = ''
  let n = 0
  for (;;) {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, after, PAGE)
    if (!rows.length) break
    for (const r of rows) gz.write(header.map((h) => csvCell(r[h])).join(',') + '\n')
    n += rows.length
    after = String(rows[rows.length - 1][header[0]])
    if (n % 50000 < PAGE) console.log(`  ${file}: ${n.toLocaleString()} rows`)
  }
  await new Promise<void>((resolve) => {
    out.on('finish', resolve)
    gz.end()
  })
  console.log(`  ${file}: ${n.toLocaleString()} rows (done)`)
  return n
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  console.log(`export-odbl-data — read-only — writing ${OUT}`)

  const counts: Record<string, number> = {}
  counts.products = await exportTable(
    'products.csv',
    ['product_id', 'barcode', 'name', 'company_id', 'company', 'parent_company', 'category', 'category_source'],
    `SELECT p.id AS product_id, p.upc AS barcode, p.name, c.id AS company_id, c."legalName" AS company,
            pc."legalName" AS parent_company, p.category, p."categorySource" AS category_source
       FROM "Product" p JOIN "Company" c ON c.id = p."companyId" LEFT JOIN "Company" pc ON pc.id = c."parentCompanyId"
      WHERE p."importSource" = 'open_food_facts_bulk' AND p.id > $1
      ORDER BY p.id LIMIT $2`
  )
  counts.companies = await exportTable(
    'companies.csv',
    ['company_id', 'name', 'other_names', 'parent_company_id', 'verified'],
    `SELECT c.id AS company_id, c."legalName" AS name, array_to_string(c."dbaNames", '; ') AS other_names,
            c."parentCompanyId" AS parent_company_id, (c."vettingStatus" = 'vetted') AS verified
       FROM "Company" c
      WHERE EXISTS (SELECT 1 FROM "Product" p WHERE p."companyId" = c.id AND p."importSource" = 'open_food_facts_bulk')
        AND c.id > $1
      ORDER BY c.id LIMIT $2`
  )
  counts.ingredients = await exportTable(
    'ingredients.csv',
    ['row_id', 'product_id', 'position', 'ingredient', 'organic', 'trace'],
    `SELECT pi."productId" || ':' || i.id AS row_id, pi."productId" AS product_id, pi."listPosition" AS position,
            i.name AS ingredient, pi."isOrganicSourced" AS organic, pi."isTrace" AS trace
       FROM "ProductIngredient" pi JOIN "Ingredient" i ON i.id = pi."ingredientId" JOIN "Product" p ON p.id = pi."productId"
      WHERE p."ingredientSource" = 'open_food_facts' AND pi."productId" || ':' || i.id > $1
      ORDER BY pi."productId" || ':' || i.id LIMIT $2`
  )
  counts.nutrition = await exportTable(
    'nutrition.csv',
    ['nutrition_id', 'product_id', 'serving_size', 'calories', 'total_fat_g', 'saturated_fat_g', 'sugar_g', 'carbs_g', 'sodium_mg', 'protein_g', 'source_url', 'read_on'],
    `SELECT n.id AS nutrition_id, n."productId" AS product_id, n."servingSize" AS serving_size, n.calories,
            n."totalFatG" AS total_fat_g, n."saturatedFatG" AS saturated_fat_g, n."sugarG" AS sugar_g, n."carbsG" AS carbs_g,
            n."sodiumMg" AS sodium_mg, n."proteinG" AS protein_g, n."sourceUrl" AS source_url, n."dataPulledDate" AS read_on
       FROM "NutritionFacts" n
      WHERE n."sourceUrl" LIKE '%openfoodfacts.org%' AND n.id > $1
      ORDER BY n.id LIMIT $2`
  )

  fs.writeFileSync(
    path.join(OUT, 'LICENSE.txt'),
    `Rootify — Open Food Facts–derived data, exported ${DAY}

This export contains data derived from Open Food Facts (https://openfoodfacts.org),
modified by Rootify (product categories, brand-to-company matching, merged
duplicate brands, cleaned ingredient lists).

The database is made available under the Open Database License (ODbL) v1.0:
  https://opendatacommons.org/licenses/odbl/1-0/
Individual contents of the database are licensed under the Database Contents
License (DbCL) v1.0:
  https://opendatacommons.org/licenses/dbcl/1-0/

Attribution: data from Open Food Facts contributors, https://openfoodfacts.org

Files (gzipped CSV, UTF-8, header row):
  products.csv     ${counts.products} rows
  companies.csv    ${counts.companies} rows
  ingredients.csv  ${counts.ingredients} rows
  nutrition.csv    ${counts.nutrition} rows

category_source values: usda_fdc (USDA FoodData Central branded food
category), open_food_facts (Open Food Facts category tags), name_estimate
(estimated from the product name), ai_estimate (estimated by AI from the name,
brand and ingredients), manual (set by a person).
`
  )
  console.log(`\nDone. ${OUT}`)
}

main()
  .catch((e) => {
    console.error('FAILED:', e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

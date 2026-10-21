-- Materialised free-from filter columns on Product (r25).
--
-- WHY: ingredientFilterWhere evaluated a correlated NOT EXISTS per filter
-- across all 416,382 products -- ~1.2M index probes into the 1,291 MB
-- ProductIngredient table. 852 ms warm, 55 s cold in r23, 120 s cold in r25.
-- It took the site down twice. See prisma/schema.prisma for the full note.
--
-- THIS MIGRATION ADDS EMPTY COLUMNS AND NOTHING ELSE. ADD COLUMN with a
-- constant default is metadata-only in Postgres 11+, so it does not rewrite
-- the 314 MB heap and completes in milliseconds. Populating ~272,000 rows is
-- a separate, long, vacuum-generating statement that must NOT run inside a
-- migration (Prisma wraps migrations in a transaction and every route to this
-- database has a timeout shorter than the work -- see
-- claude/runbook-database-performance.md section 4b). Run it with:
--
--   npx tsx scripts/run-long-ddl.ts product_ingredient_categories --live
--
-- Until that runs, every product has an empty array and false, which means
-- every product PASSES every free-from filter. That is the safe direction --
-- it over-includes rather than making a false "free from" claim -- but the
-- filters are wrong until the backfill completes, so deploy the two together.

ALTER TABLE "Product"
  ADD COLUMN "ingredientCategories" TEXT[] DEFAULT ARRAY[]::text[],
  ADD COLUMN "hasHydrogenatedIngredient" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ingredientCategoriesSyncedAt" TIMESTAMP(3);

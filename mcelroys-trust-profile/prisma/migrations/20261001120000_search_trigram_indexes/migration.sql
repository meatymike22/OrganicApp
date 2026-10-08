-- Search indexes (2026-10-01).
--
-- WHY: search (src/app/search/page.tsx) looks for products whose name
-- CONTAINS the query, and companies whose name contains it. A normal (btree)
-- index can only find values that START with something, so every search was
-- reading all ~416,000 products (about 2 seconds, twice per page: results and
-- count). Trigram indexes (pg_trgm) break text into 3-letter pieces and can
-- answer "contains" and case-insensitive searches directly.
--
-- Declared in schema.prisma too (@@index ... type: Gin), so Prisma knows
-- about them.
--
-- pg_trgm goes in the "extensions" schema like the project's other
-- extensions (pgcrypto, uuid-ossp); the operator class is named with that
-- schema so this works whatever the connection's search_path is.
--
-- Building the indexes takes a minute or two. Writes to Product/Company wait
-- while each index builds; reads (the website) are not blocked.

-- The "extensions" schema is created by Supabase when it provisions a
-- database, not by Postgres. The shadow database Prisma builds to check for
-- drift is a plain empty database on the same server, so the schema is not
-- there and this line would fail with 3F000 the moment the earlier blocker
-- in 20260930170000 was cleared. Creating it first costs nothing against
-- the real database, where it already exists. (Added 2026-10-08; the
-- checksum in _prisma_migrations was updated to match.)
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Product name: "name contains …" in search.
CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx"
  ON "Product" USING GIN ("name" extensions.gin_trgm_ops);

-- Product category: the aisle filter ("category contains 'snack'").
CREATE INDEX IF NOT EXISTS "Product_category_trgm_idx"
  ON "Product" USING GIN ("category" extensions.gin_trgm_ops);

-- Company name: "legalName contains …" in search.
CREATE INDEX IF NOT EXISTS "Company_legalName_trgm_idx"
  ON "Company" USING GIN ("legalName" extensions.gin_trgm_ops);

-- Company brand names: search matches an exact brand in dbaNames.
CREATE INDEX IF NOT EXISTS "Company_dbaNames_idx"
  ON "Company" USING GIN ("dbaNames");

-- Refresh the planner's statistics so it knows these tables' real sizes
-- (its estimates were far off: it expected ~600 rows where there are 82,000).
ANALYZE "Product";
ANALYZE "Company";
ANALYZE "ProductIngredient";

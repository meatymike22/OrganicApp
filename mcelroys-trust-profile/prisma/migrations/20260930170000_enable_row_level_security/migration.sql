-- Lock the database down against direct access through Supabase's public API.
--
-- WHY: Supabase exposes every table in the "public" schema through its REST
-- API (PostgREST). Anyone with the project's public "anon" key can call it,
-- and by default the anon and authenticated roles hold full privileges on
-- these tables, including INSERT, UPDATE, DELETE and TRUNCATE. With row level
-- security off, that means the whole database could be read or changed
-- without going through the app.
--
-- The app never uses that API: every read and write goes through Prisma on
-- the server, connecting as the "postgres" role, which owns these tables and
-- has BYPASSRLS. So this migration:
--   1. turns row level security ON for every table, with NO policies, which
--      makes anon/authenticated see and change nothing;
--   2. revokes the anon/authenticated table and sequence privileges outright
--      (RLS does not cover TRUNCATE, so revoking is what blocks it);
--   3. stops Supabase's default privileges from granting them again on
--      tables that future migrations create.
-- Prisma (and every script in ./scripts) is unaffected.
--
-- IF A PUBLIC FEATURE IS ADDED LATER (for example, users reporting errors
-- straight from the browser through supabase-js), grant only what it needs
-- and add a policy for it, e.g.:
--   GRANT INSERT ON "ErrorReport" TO anon;
--   CREATE POLICY "anyone can file a report" ON "ErrorReport" FOR INSERT TO anon WITH CHECK (true);
-- A new table created by a later migration should also get
--   ALTER TABLE "<Table>" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Commodity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommodityNutrition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IndependentInvestigation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IngestionLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ingredient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IngredientRegulatoryStatus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IngredientStudy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvestorFiling" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NutritionFacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganicCertification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OriginObservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OwnershipCertification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PluCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductCertification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductIngredient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RegionalSupplyReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RegulatoryAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplyChainDisclosure" ENABLE ROW LEVEL SECURITY;
-- _prisma_migrations is Prisma's own bookkeeping table, and it is the one
-- table in this list that does NOT exist in the shadow database Prisma
-- builds to check for drift: the shadow replays every migration without
-- recording any of them, so the table is never created there.
--
-- Unguarded, this line applied cleanly to the real database on 2026-09-30
-- and then failed every `prisma migrate dev` afterwards — P3006 / P3018,
-- "relation _prisma_migrations does not exist" — which looks like a broken
-- migration history and is really a migration that is not portable.
--
-- Guarded the same way the role block below is guarded: skip quietly where
-- the object is absent. Against the real database this is a no-op that
-- leaves RLS exactly as this migration already set it, which is what makes
-- editing an applied migration defensible here — the file still describes
-- the state the database is in. The checksum in _prisma_migrations was
-- updated to match (2026-10-08).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = '_prisma_migrations'
  ) THEN
    ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- The roles only exist on Supabase; skip quietly anywhere else (e.g. a local
-- Postgres used for testing).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  END IF;
END $$;

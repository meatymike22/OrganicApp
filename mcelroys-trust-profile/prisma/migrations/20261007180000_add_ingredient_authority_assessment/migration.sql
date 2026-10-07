-- AUTHORITY ASSESSMENTS of an ingredient.
--
-- A third kind of evidence, kept deliberately separate from the two that
-- already exist:
--
--   IngredientStudy                -- one scientific paper, hand-curated
--   IngredientRegulatoryStatus     -- is it permitted here, up to what limit
--   IngredientAuthorityAssessment  -- an authority's own stated conclusion
--
-- The third is what Yuka actually uses and what Rootify was missing: IARC
-- group assignments, California Prop 65 listings, EFSA reference values, FDA
-- inventory listings. Unlike a study it is enumerable -- the authority
-- publishes a list -- which is why 20 hand-curated studies could never cover
-- 6,250 flagged ingredients and this can.
--
-- It MUST NOT be merged into IngredientStudy. "IARC lists this as Group 2B"
-- and "a 2019 paper found X" are different kinds of claim with different
-- weight, and a reader has to be able to tell which one they are reading.
CREATE TABLE "IngredientAuthorityAssessment" (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "ingredientId" TEXT NOT NULL REFERENCES "Ingredient"(id),

  -- Which body. Canonical list and meanings live in src/lib/authorities.ts.
  authority TEXT NOT NULL,

  -- hazard_classification | reference_value | safety_review | listing
  "assessmentType" TEXT NOT NULL,

  -- THE AUTHORITY'S OWN WORDS, verbatim enough to check against the source.
  -- This is the citable string and must never be paraphrased in place.
  classification TEXT NOT NULL,

  -- Our normalised code for rendering and colour, e.g. group_1, group_2b,
  -- cancer, developmental_toxicity, adi. Plain-English wording is derived
  -- from this in authorities.ts rather than stored, so correcting a phrasing
  -- never needs a re-ingest.
  "classificationCode" TEXT NOT NULL,

  -- The name the AUTHORITY used, which routinely differs from ours, plus the
  -- CAS number where published. Both are what make the citation checkable.
  "substanceName" TEXT NOT NULL,
  "casNumber"     TEXT,

  -- When the authority made or last revised the assessment. Null when the
  -- published list does not say -- not backfilled with the pull date, which
  -- would invent a fact.
  "assessedDate" TIMESTAMP,

  -- Provenance. No aiDrafted/reviewer columns here on purpose: these records
  -- are transcribed from a published list by a script, so the honest
  -- provenance is the URL, the title and the date we read it.
  "sourceUrl"      TEXT NOT NULL,
  "sourceTitle"    TEXT NOT NULL,
  "dataPulledDate" TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- One row per (ingredient, authority, classification, substance name). The
-- substance name is in the key because one authority legitimately lists the
-- same ingredient under several names with separate assessments.
CREATE UNIQUE INDEX "IngredientAuthorityAssessment_unique_idx"
  ON "IngredientAuthorityAssessment" ("ingredientId", authority, classification, "substanceName");

-- Every ingredient page reads its own assessments.
CREATE INDEX "IngredientAuthorityAssessment_ingredientId_idx"
  ON "IngredientAuthorityAssessment" ("ingredientId");

-- "How much does each authority cover" is a question we will ask often.
CREATE INDEX "IngredientAuthorityAssessment_authority_idx"
  ON "IngredientAuthorityAssessment" (authority);

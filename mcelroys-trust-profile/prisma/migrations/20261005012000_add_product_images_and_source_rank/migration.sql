-- Product photographs, and a sort key for Search.
--
-- 1. imageUrl / imageSource / imageSourceUrl / imageCheckedAt
--    Where a product's photograph came from. Open Food Facts images are
--    CC-BY-SA 3.0 — a different licence from the ODbL that covers their
--    data — so the source URL is stored, not derived, because the credit
--    has to link back wherever the image appears. imageCheckedAt keeps
--    "we looked and there is no photo" apart from "nobody has looked".
--
-- 2. sourceRank
--    Lower sorts first: 10 person-confirmed company, 20 USDA barcode,
--    30 recall notice, 40 automated review, 90 not confirmed (default).
--    Denormalised from Company.vettingMethod on purpose: ordering Search
--    across the join made Postgres sort all 411k products on every page
--    view (2.17 s for page 1). The index below answers it directly.
--    Backfilled immediately after this file, from Company.vettingMethod.

ALTER TABLE "Product" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Product" ADD COLUMN "imageSource" TEXT;
ALTER TABLE "Product" ADD COLUMN "imageSourceUrl" TEXT;
ALTER TABLE "Product" ADD COLUMN "imageCheckedAt" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN "sourceRank" INTEGER NOT NULL DEFAULT 90;

CREATE INDEX "Product_sourceRank_name_id_idx" ON "Product"("sourceRank", "name", "id");

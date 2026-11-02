-- What each product photograph actually shows.
--
-- Michael, 2026-10-23: "we would rather have no photo than a picture of the
-- nutrition label." Open Food Facts photographs are contributed, and
-- contributors photograph whatever answered their own question — often the
-- back of the pack. We hold 184,099 and have never known which is which.
--
-- ALL THREE COLUMNS ARE NULLABLE WITH NO DEFAULT, AND THAT IS THE POINT.
-- NULL means "not yet judged", and the display rule treats not-yet-judged as
-- showable. A DEFAULT here — any default — would assert a verdict about
-- 184,099 photographs that nothing has looked at. The same reasoning as
-- 20261025190000_product_publication_status defaulting to 'published': a
-- column that starts hiding rows the moment it lands cannot be reviewed.
--
-- imageKind values: package | nutrition_panel | ingredients_panel | barcode |
-- other | unreadable. Defined once in src/lib/imageKind.ts; not a CHECK
-- constraint, because the taxonomy is expected to gain a value (front vs back
-- of pack is already a candidate) and a migration per label is friction with
-- no payoff — the script is the only writer and it writes from that constant.
--
-- imageKindModel records WHICH MODEL produced the verdict. This is the only
-- materialised column on Product that cannot be re-derived from the source
-- tables: no query can check what a photograph shows. A verdict without its
-- model is a number with no provenance, and the hand-scored pilot is evidence
-- about exactly one model and one prompt.
--
-- NO INDEX. The backfill's resume query filters imageJudgedAt IS NULL once
-- per invocation, not once per image. If plans regress the fix is a partial
-- index WHERE "imageJudgedAt" IS NULL, which shrinks as the job completes.
ALTER TABLE "Product"
  ADD COLUMN "imageKind"      TEXT,
  ADD COLUMN "imageKindModel" TEXT,
  ADD COLUMN "imageJudgedAt"  TIMESTAMP(3);

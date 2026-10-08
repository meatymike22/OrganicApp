-- Ingredient.productCount — how many products list each ingredient.
--
-- Denormalised so the related-products shelf can seed its candidates from a
-- product's RAREST ingredients instead of an arbitrary slice of its category.
--
-- THE BUG THIS FIXES. The shelf took 150 candidate products from the category
-- in arbitrary physical index order, because ordering them cost 3.2 s. On a
-- product in "Sauce" that meant looking at 150 of 21,234 products chosen
-- effectively at random. For Campbell's "Au jus" the shelf came back empty,
-- and the gravies it should have shown — Orrington Farms Brown Gravy Mix at
-- 44% ingredient overlap, two Mushroom Gravies at 37%, Heinz Beef Gravy at
-- 26% — were simply outside the slice. The 40% threshold was never the
-- problem; the top match cleared it.
--
-- Counting rarity at query time was measured at 2,267 ms, hence a column.
--
-- The UPDATE below seeds it, so the column is correct the moment this
-- migration finishes. Re-run scripts/sync-ingredient-product-count.ts after
-- any import that adds ProductIngredient rows.

ALTER TABLE "Ingredient" ADD COLUMN "productCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "Ingredient" i
SET "productCount" = c.n
FROM (
  SELECT "ingredientId", count(*)::int AS n
  FROM "ProductIngredient"
  GROUP BY "ingredientId"
) c
WHERE c."ingredientId" = i.id;

-- Two indexes on Ingredient, both long-standing items from
-- features-to-add #19.
--
-- category: every ingredient-filtered search runs a NOT EXISTS against this
-- column and had no index to use, so each one began with a sequential scan
-- of 127,268 rows (~80 ms). The allergen filters added in round 13 made that
-- two scans per filtered page.
--
-- name trigram: /ingredients is searchable as of this round, and
-- `name ILIKE '%lecithin%'` measured a 252 ms sequential scan returning 725
-- rows. Same index type and same reasoning as Product_name_trgm_idx; the
-- operator class is schema-qualified so it resolves whatever the
-- connection's search_path is.

CREATE INDEX IF NOT EXISTS "Ingredient_category_idx" ON "Ingredient"("category");
CREATE INDEX IF NOT EXISTS "Ingredient_name_trgm_idx"
  ON "Ingredient" USING GIN ("name" extensions.gin_trgm_ops);

ANALYZE "Ingredient";

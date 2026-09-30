-- Where each product's category came from (see the comment on
-- Product.categorySource in schema.prisma).
ALTER TABLE "Product" ADD COLUMN "categorySource" TEXT;

-- Existing categories: the bulk import took them from Open Food Facts' tags;
-- the hand-entered products were categorized by a person.
UPDATE "Product"
SET "categorySource" = CASE WHEN "importSource" = 'open_food_facts_bulk' THEN 'open_food_facts' ELSE 'manual' END
WHERE "category" IS NOT NULL;

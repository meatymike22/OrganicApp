-- OFF's generic_name and quantity, so a product called "Celsius" can read
-- "Celsius Energy Drink, 12 fl oz" without us inventing either half.
--
-- Nullable with no default, which is what Prisma emits for `String?` and
-- `DateTime?`. NULL in genericNameCheckedAt is the third state: nobody has
-- looked. A product that is in the export but carries no generic_name gets
-- genericNameCheckedAt set and genericName left NULL — "we looked, OFF has
-- none" — exactly as imageCheckedAt works.
ALTER TABLE "Product"
  ADD COLUMN "genericName"          TEXT,
  ADD COLUMN "quantity"             TEXT,
  ADD COLUMN "genericNameSource"    TEXT,
  ADD COLUMN "genericNameCheckedAt" TIMESTAMP(3);

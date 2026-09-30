-- Data: bring every stored barcode into the canonical 13-digit form BEFORE
-- adding the unique constraint (see src/lib/upc.ts). Only 12-digit UPC-A
-- codes change — they get a leading zero, which makes them the same barcode
-- as their EAN-13 spelling. Empty strings become NULL, since several empty
-- strings would otherwise collide under the constraint.
UPDATE "Product" SET "upc" = '0' || "upc" WHERE "upc" ~ '^[0-9]{12}$';
UPDATE "Product" SET "upc" = NULL WHERE "upc" = '';

-- CreateIndex
CREATE UNIQUE INDEX "Product_upc_key" ON "Product"("upc");

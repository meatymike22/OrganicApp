-- Brand/product links for regulatory actions (recalls). See the
-- RegulatoryActionLink model in schema.prisma for how the app uses them.
CREATE TABLE "RegulatoryActionLink" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "actionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT,
    "matchMethod" TEXT NOT NULL,
    "matchedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatoryActionLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RegulatoryActionLink_productId_idx" ON "RegulatoryActionLink"("productId");
CREATE INDEX "RegulatoryActionLink_companyId_idx" ON "RegulatoryActionLink"("companyId");
CREATE INDEX "RegulatoryActionLink_actionId_idx" ON "RegulatoryActionLink"("actionId");

-- One link per action+brand (brand-wide) and per action+product.
CREATE UNIQUE INDEX "RegulatoryActionLink_brand_key" ON "RegulatoryActionLink"("actionId", "companyId") WHERE "productId" IS NULL;
CREATE UNIQUE INDEX "RegulatoryActionLink_product_key" ON "RegulatoryActionLink"("actionId", "productId") WHERE "productId" IS NOT NULL;

ALTER TABLE "RegulatoryActionLink" ADD CONSTRAINT "RegulatoryActionLink_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "RegulatoryAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RegulatoryActionLink" ADD CONSTRAINT "RegulatoryActionLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RegulatoryActionLink" ADD CONSTRAINT "RegulatoryActionLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same lockdown as every other table (see 20260930170000_enable_row_level_security).
ALTER TABLE "RegulatoryActionLink" ENABLE ROW LEVEL SECURITY;

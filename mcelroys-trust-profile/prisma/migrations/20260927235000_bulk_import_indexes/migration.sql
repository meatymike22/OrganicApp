-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "importSource" TEXT;

-- CreateIndex
CREATE INDEX "Company_parentCompanyId_idx" ON "Company"("parentCompanyId");

-- CreateIndex
CREATE INDEX "Product_companyId_idx" ON "Product"("companyId");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_importSource_idx" ON "Product"("importSource");

-- CreateIndex
CREATE INDEX "ProductIngredient_ingredientId_idx" ON "ProductIngredient"("ingredientId");

-- CreateIndex
CREATE INDEX "ProductCertification_productId_idx" ON "ProductCertification"("productId");

-- CreateIndex
CREATE INDEX "OrganicCertification_productId_idx" ON "OrganicCertification"("productId");

-- CreateIndex
CREATE INDEX "RegulatoryAction_companyId_idx" ON "RegulatoryAction"("companyId");

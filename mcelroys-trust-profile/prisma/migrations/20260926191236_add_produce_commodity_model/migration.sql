-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "commodityId" TEXT;

-- AlterTable
ALTER TABLE "RegulatoryAction" ADD COLUMN     "commodityId" TEXT;

-- CreateTable
CREATE TABLE "Commodity" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "category" TEXT,
    "fdcId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Commodity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluCode" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "commodityId" TEXT NOT NULL,
    "variety" TEXT,
    "sizeNote" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'industry_registry',
    "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "reviewDate" TIMESTAMP(3),

    CONSTRAINT "PluCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommodityNutrition" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "commodityId" TEXT NOT NULL,
    "servingSize" TEXT,
    "calories" DOUBLE PRECISION,
    "totalFatG" DOUBLE PRECISION,
    "saturatedFatG" DOUBLE PRECISION,
    "sugarG" DOUBLE PRECISION,
    "carbsG" DOUBLE PRECISION,
    "sodiumMg" DOUBLE PRECISION,
    "proteinG" DOUBLE PRECISION,
    "fiberG" DOUBLE PRECISION,
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'government_database',
    "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "reviewDate" TIMESTAMP(3),

    CONSTRAINT "CommodityNutrition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OriginObservation" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "commodityId" TEXT NOT NULL,
    "observationType" TEXT NOT NULL,
    "countryOfOrigin" TEXT,
    "regionOfOrigin" TEXT,
    "shipperName" TEXT,
    "shipperCompanyId" TEXT,
    "storeName" TEXT NOT NULL,
    "storeCity" TEXT,
    "storeState" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'user_submission',
    "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "reviewDate" TIMESTAMP(3),

    CONSTRAINT "OriginObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegionalSupplyReport" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "commodityId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "reportType" TEXT NOT NULL,
    "originRegion" TEXT NOT NULL,
    "originCountry" TEXT NOT NULL,
    "marketName" TEXT,
    "reportSlug" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'government_database',
    "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "reviewDate" TIMESTAMP(3),

    CONSTRAINT "RegionalSupplyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Commodity_name_key" ON "Commodity"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PluCode_code_key" ON "PluCode"("code");

-- CreateIndex
CREATE INDEX "PluCode_commodityId_idx" ON "PluCode"("commodityId");

-- CreateIndex
CREATE UNIQUE INDEX "CommodityNutrition_commodityId_key" ON "CommodityNutrition"("commodityId");

-- CreateIndex
CREATE INDEX "OriginObservation_commodityId_idx" ON "OriginObservation"("commodityId");

-- CreateIndex
CREATE INDEX "OriginObservation_shipperCompanyId_idx" ON "OriginObservation"("shipperCompanyId");

-- CreateIndex
CREATE INDEX "RegionalSupplyReport_commodityId_reportDate_idx" ON "RegionalSupplyReport"("commodityId", "reportDate");

-- CreateIndex
CREATE INDEX "Product_commodityId_idx" ON "Product"("commodityId");

-- CreateIndex
CREATE INDEX "RegulatoryAction_commodityId_idx" ON "RegulatoryAction"("commodityId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryAction" ADD CONSTRAINT "RegulatoryAction_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluCode" ADD CONSTRAINT "PluCode_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommodityNutrition" ADD CONSTRAINT "CommodityNutrition_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OriginObservation" ADD CONSTRAINT "OriginObservation_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OriginObservation" ADD CONSTRAINT "OriginObservation_shipperCompanyId_fkey" FOREIGN KEY ("shipperCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegionalSupplyReport" ADD CONSTRAINT "RegionalSupplyReport_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

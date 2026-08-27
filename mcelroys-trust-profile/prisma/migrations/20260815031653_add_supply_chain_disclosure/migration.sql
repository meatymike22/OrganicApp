-- CreateTable
CREATE TABLE "SupplyChainDisclosure" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "companyId" TEXT NOT NULL,
    "disclosureStatus" TEXT NOT NULL,
    "disclosureType" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "notes" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'company_disclosure',
    "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "reviewDate" TIMESTAMP(3),

    CONSTRAINT "SupplyChainDisclosure_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SupplyChainDisclosure" ADD CONSTRAINT "SupplyChainDisclosure_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

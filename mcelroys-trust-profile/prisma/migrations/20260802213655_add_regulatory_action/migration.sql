-- CreateTable
CREATE TABLE "RegulatoryAction" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "companyId" TEXT NOT NULL,
    "sourceAgency" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "classification" TEXT,
    "reason" TEXT NOT NULL,
    "productDescription" TEXT,
    "status" TEXT,
    "actionDate" TIMESTAMP(3),
    "terminationDate" TIMESTAMP(3),
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'regulatory_filing',
    "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "reviewDate" TIMESTAMP(3),

    CONSTRAINT "RegulatoryAction_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RegulatoryAction" ADD CONSTRAINT "RegulatoryAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

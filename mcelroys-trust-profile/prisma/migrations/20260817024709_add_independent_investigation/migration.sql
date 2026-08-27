-- CreateTable
CREATE TABLE "IndependentInvestigation" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "companyId" TEXT NOT NULL,
    "investigatingOrg" TEXT NOT NULL,
    "investigationType" TEXT,
    "allegationSummary" TEXT NOT NULL,
    "companyResponse" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unresolved',
    "publicationDate" TIMESTAMP(3),
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'independent_investigation',
    "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "reviewDate" TIMESTAMP(3),

    CONSTRAINT "IndependentInvestigation_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "IndependentInvestigation" ADD CONSTRAINT "IndependentInvestigation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

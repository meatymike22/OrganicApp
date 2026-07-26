-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "dbaNames" TEXT[],
    "hqLocation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganicCertification" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "certifyingAgency" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "certificationStatus" TEXT NOT NULL,
    "certifiedScopes" TEXT[],
    "effectiveDate" TIMESTAMP(3),
    "lastVerifiedDate" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'regulatory_filing',
    "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "reviewDate" TIMESTAMP(3),

    CONSTRAINT "OrganicCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnershipCertification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "mbeCertified" BOOLEAN NOT NULL DEFAULT false,
    "wbeCertified" BOOLEAN NOT NULL DEFAULT false,
    "veteranOwnedCertified" BOOLEAN NOT NULL DEFAULT false,
    "dbeCertified" BOOLEAN NOT NULL DEFAULT false,
    "certifyingBody" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'regulatory_filing',
    "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "reviewDate" TIMESTAMP(3),

    CONSTRAINT "OwnershipCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestorFiling" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ticker" TEXT,
    "majorShareholders" JSONB,
    "institutionalOwnershipPct" DOUBLE PRECISION,
    "filingDate" TIMESTAMP(3),
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'regulatory_filing',
    "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "reviewDate" TIMESTAMP(3),

    CONSTRAINT "InvestorFiling_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganicCertification" ADD CONSTRAINT "OrganicCertification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipCertification" ADD CONSTRAINT "OwnershipCertification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorFiling" ADD CONSTRAINT "InvestorFiling_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

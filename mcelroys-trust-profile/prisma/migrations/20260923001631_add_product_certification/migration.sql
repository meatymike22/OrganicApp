-- CreateTable
CREATE TABLE "ProductCertification" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "productId" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "certifyingBody" TEXT,
    "certificateNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'verified',
    "effectiveDate" TIMESTAMP(3),
    "lastVerifiedDate" TIMESTAMP(3),
    "scopeNote" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'certifier_database',
    "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "reviewDate" TIMESTAMP(3),

    CONSTRAINT "ProductCertification_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProductCertification" ADD CONSTRAINT "ProductCertification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

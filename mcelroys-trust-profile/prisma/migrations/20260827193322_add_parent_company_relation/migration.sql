-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "ownershipNote" TEXT,
ADD COLUMN     "parentCompanyId" TEXT;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_parentCompanyId_fkey" FOREIGN KEY ("parentCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

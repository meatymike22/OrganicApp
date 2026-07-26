-- AlterTable
ALTER TABLE "InvestorFiling" ADD COLUMN     "parentCompany" TEXT,
ADD COLUMN     "publicStatus" TEXT NOT NULL DEFAULT 'public';

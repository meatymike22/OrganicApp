-- AlterTable
ALTER TABLE "SupplyChainDisclosure" ADD COLUMN     "auditFramework" TEXT,
ADD COLUMN     "verificationBasis" TEXT NOT NULL DEFAULT 'self_reported';

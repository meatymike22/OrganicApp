-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "discoverySourceUrl" TEXT,
ADD COLUMN     "reviewDate" TIMESTAMP(3),
ADD COLUMN     "reviewerId" TEXT,
ADD COLUMN     "vettingStatus" TEXT NOT NULL DEFAULT 'unvetted';

-- CreateIndex
CREATE INDEX "Company_vettingStatus_idx" ON "Company"("vettingStatus");

-- Data: every company that exists before bulk ingestion was added and
-- researched by hand, so mark them vetted. The column default ('unvetted')
-- applies only to companies created from here on.
UPDATE "Company" SET "vettingStatus" = 'vetted';

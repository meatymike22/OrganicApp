-- AlterTable
ALTER TABLE "IngredientStudy" ADD COLUMN     "conflictOfInterestNote" TEXT,
ADD COLUMN     "fundingBasis" TEXT NOT NULL DEFAULT 'undetermined';

-- AlterTable
ALTER TABLE "IngredientStudy" ADD COLUMN     "evidenceFraming" TEXT NOT NULL DEFAULT 'potential_concern_unproven',
ADD COLUMN     "regulatoryAction" TEXT;

/*
  Warnings:

  - Added the required column `sourceUrl` to the `NutritionFacts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "flaggedForResearch" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "IngredientStudy" ADD COLUMN     "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reviewDate" TIMESTAMP(3),
ADD COLUMN     "reviewerId" TEXT,
ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'scientific_literature';

-- AlterTable
ALTER TABLE "NutritionFacts" ADD COLUMN     "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reviewDate" TIMESTAMP(3),
ADD COLUMN     "reviewerId" TEXT,
ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'crowdsourced',
ADD COLUMN     "sourceUrl" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "productType" DROP DEFAULT;

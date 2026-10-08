-- DropForeignKey
ALTER TABLE "IngredientAuthorityAssessment" DROP CONSTRAINT "IngredientAuthorityAssessment_ingredientId_fkey";

-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "allergensCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "IngredientAuthorityAssessment" ALTER COLUMN "assessedDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "dataPulledDate" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "dataPulledDate" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "IngredientAuthorityAssessment" ADD CONSTRAINT "IngredientAuthorityAssessment_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

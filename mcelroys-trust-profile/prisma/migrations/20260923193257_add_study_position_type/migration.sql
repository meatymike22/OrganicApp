-- AlterTable
ALTER TABLE "IngredientStudy" ADD COLUMN     "challengesStudyId" TEXT,
ADD COLUMN     "positionType" TEXT NOT NULL DEFAULT 'primary_finding';

-- AddForeignKey
ALTER TABLE "IngredientStudy" ADD CONSTRAINT "IngredientStudy_challengesStudyId_fkey" FOREIGN KEY ("challengesStudyId") REFERENCES "IngredientStudy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "IngredientRegulatoryStatus" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "ingredientId" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "limitValue" TEXT,
    "notes" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'regulatory_filing',
    "dataPulledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "reviewDate" TIMESTAMP(3),

    CONSTRAINT "IngredientRegulatoryStatus_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "IngredientRegulatoryStatus" ADD CONSTRAINT "IngredientRegulatoryStatus_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

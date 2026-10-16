-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "offTaxonomyCheckedAt" TIMESTAMP(3),
ADD COLUMN     "offTaxonomyId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "additiveENumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "additivesCheckedAt" TIMESTAMP(3),
ADD COLUMN     "additivesSource" TEXT,
ADD COLUMN     "imageHeight" INTEGER,
ADD COLUMN     "imageWidth" INTEGER,
ADD COLUMN     "ingredientsTextLang" TEXT,
ADD COLUMN     "ingredientsTextRaw" TEXT,
ADD COLUMN     "ingredientsTextRawCheckedAt" TIMESTAMP(3),
ADD COLUMN     "ingredientsTextRawSource" TEXT,
ADD COLUMN     "labelAllergenTraces" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "labelAllergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "labelAllergensCheckedAt" TIMESTAMP(3),
ADD COLUMN     "labelAllergensSource" TEXT,
ADD COLUMN     "labelClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "labelClaimsCheckedAt" TIMESTAMP(3),
ADD COLUMN     "labelClaimsSource" TEXT;

-- AlterTable
ALTER TABLE "ProductIngredient" ADD COLUMN     "parentIngredientId" TEXT;

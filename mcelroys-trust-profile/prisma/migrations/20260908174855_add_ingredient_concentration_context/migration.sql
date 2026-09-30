-- AlterTable
ALTER TABLE "ProductIngredient" ADD COLUMN     "concentrationNote" TEXT,
ADD COLUMN     "isTrace" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "listPosition" INTEGER;

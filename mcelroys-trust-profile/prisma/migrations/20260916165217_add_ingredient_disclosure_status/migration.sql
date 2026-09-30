-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "ingredientCheckedAt" TIMESTAMP(3),
ADD COLUMN     "ingredientDisclosureStatus" TEXT NOT NULL DEFAULT 'unchecked';

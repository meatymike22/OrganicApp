-- How each company was vetted, the evidence, and the brand owner USDA
-- reports (see the comments on Company in schema.prisma).
ALTER TABLE "Company" ADD COLUMN "vettingMethod" TEXT;
ALTER TABLE "Company" ADD COLUMN "vettedAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "vettingNotes" TEXT;
ALTER TABLE "Company" ADD COLUMN "brandOwner" TEXT;

-- Every company vetted so far was checked by a person.
UPDATE "Company" SET "vettingMethod" = 'human' WHERE "vettingStatus" = 'vetted';

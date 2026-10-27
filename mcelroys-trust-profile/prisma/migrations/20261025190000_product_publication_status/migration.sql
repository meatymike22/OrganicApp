-- WITHHOLDING A RECORD THAT CANNOT SAY WHAT THE PRODUCT IS.
--
-- Michael, 2026-10-25: "if the title is the same as the product without any
-- additional information then it shouldnt go into the database because its
-- not a real product unless the photo or barcode gives us more information
-- about it in which case we should try to research to get the product name.
-- If we cant in the end then it should be in a part of the database that has
-- a 'missing info' category and doesnt get displayed on the website."
--
-- So this is a publication gate, not a display tweak: the three-state rule
-- turned on the product's own identity. A page that cannot name the product
-- it describes is not published.
--
-- publicationStatus defaults to 'published', so this migration changes
-- nothing on its own. Classification and the query gate are separate
-- changes, deliberately — a column that silently hid rows the moment it
-- landed would be impossible to review.
--
-- NO INDEX ON publicationStatus, on purpose. It has two values and ~99.4% of
-- rows are 'published', so a btree on it would be ignored by the planner and
-- cost writes for nothing. If display queries regress once the gate is wired
-- in, the right fix is a PARTIAL index on the existing sort key —
--   CREATE INDEX ... ON "Product"("sourceRank", name, id)
--     WHERE "publicationStatus" = 'published';
-- added after measuring, not before. (r24: a comment claiming an
-- optimisation is not evidence the code needs it.)
--
-- nameSource / nameSourceUrl / nameCheckedAt fill a real gap: every other
-- column on this table carries provenance and `name` never has. Once a name
-- can come from USDA FoodData Central or be read off a package photograph,
-- "where did this name come from and when" stops being rhetorical.
ALTER TABLE "Product"
  ADD COLUMN "publicationStatus" TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN "publicationNote"   TEXT,
  ADD COLUMN "nameSource"        TEXT,
  ADD COLUMN "nameSourceUrl"     TEXT,
  ADD COLUMN "nameCheckedAt"     TIMESTAMP(3);

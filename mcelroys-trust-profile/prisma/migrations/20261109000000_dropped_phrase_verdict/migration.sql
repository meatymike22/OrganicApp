-- WHAT A LEADING NAME FIELD ACTUALLY IS: a product line, a motto, or the
-- company again.
--
-- Open Food Facts stores product_name as a comma-delimited field list. r37
-- established that the field carrying a product-type noun is the title and
-- what follows it describes the product. What LEADS it is none of those
-- things -- it is a brand, a product line, or marketing -- and 12,780
-- products have one.
--
-- Michael, 2026-11-06: "i dont want the company motto near the product at
-- all. we have to figure out a way to distinguish motto from legitimate
-- product information."
--
-- TWO STRUCTURAL HYPOTHESES WERE TESTED FIRST AND BOTH FAILED, which is the
-- argument for storing a judgement rather than computing one:
--
--   "a line belongs to one company, a motto spreads across many"
--      6,973 of 7,470 phrases belong to exactly one company.
--   "a line covers a meaningful share of its company's catalogue"
--      INVERTED: "our specialty" sits at 8.4% while lindor is 1.0%, grill
--      mates 0.5%, oikos 0.2%, true goodness 0.1%.
--
-- "Does this phrase name something, or only praise the product?" is a
-- language judgement, and nothing in the catalogue encodes it. See
-- claude/round-38-dropped-phrase-classification.md.
--
-- KEYED ON THE PHRASE, NOT THE PRODUCT. 6,852 distinct phrases cover 12,780
-- products, so judging "Lindor" once serves every Lindt product carrying it.
-- It also means a human correcting one row corrects every page it touches --
-- Michael, 2026-11-08: "i think a human could correct this too since the
-- scale is low."
--
-- NO CHECK CONSTRAINT ON verdict, for the same reason 20261030010000 put
-- none on imageKind: the taxonomy is expected to gain a value, the writer is
-- a single script reading from one constant in src/lib/titleOrientation.ts,
-- and a migration per label is friction with no payoff.
CREATE TABLE "DroppedPhraseVerdict" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The phrase exactly as splitByProductNoun returns it, lower-cased. This
  -- is the join key, so it must be produced by that function and nothing
  -- else; a second normaliser here would drift from the first and every
  -- lookup would silently miss. That failure mode has already cost this
  -- project a false "zero failures" twice (r30, r33).
  phrase TEXT NOT NULL,

  -- product_line | motto | company_name | unclear
  --
  -- 'unclear' IS A REAL ANSWER AND IS NOT SHOWN. The prompt encourages it
  -- and the parser fails closed on anything it does not recognise, because
  -- an honest refusal is worth more than a confident guess about what a
  -- shopper reads.
  verdict TEXT NOT NULL,
  reason  TEXT,

  -- PROVENANCE, and it is not decoration. This verdict CANNOT be re-derived
  -- from the source tables: no query can tell a brand from a slogan. A
  -- verdict without its model is a number with no provenance, and a future
  -- change of model would otherwise leave a mix with no way to tell which
  -- came from where. Same reasoning as Product.imageKindModel.
  --
  -- The PROMPT is part of the provenance too and is deliberately NOT stored
  -- here: it lives in scripts/classify-dropped-phrases.ts, where changing it
  -- invalidates the hand scoring. A copy in the database would drift from
  -- the one actually being sent.
  model      TEXT      NOT NULL,
  "judgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- THE SECOND OPINION, on about 7.5% of rows: those where the first pass
  -- said "brand" and the catalogue recognises a food word inside the phrase.
  --
  -- A DIFFERENT MODEL ASKED A DIFFERENT QUESTION. Re-asking the same model
  -- the same question is not verification -- it agrees with itself, raising
  -- confidence without raising accuracy, which is worse than no check
  -- because it looks like one. verifierCall is name | description | unsure,
  -- deliberately NOT the same vocabulary as verdict, so the two can never be
  -- confused for each other in a query.
  verifier         TEXT,
  "verifierCall"   TEXT,
  "verifierReason" TEXT,
  "verifiedAt"     TIMESTAMP(3),

  -- A HUMAN CORRECTION, WHICH WINS OVER EVERYTHING ABOVE.
  --
  -- Stored separately rather than overwriting `verdict` so that three things
  -- stay true: a correction is visible AS a correction, a re-run of the
  -- classifier can never silently undo one, and the model's accuracy stays
  -- measurable against the rows a person has actually checked. Those
  -- hand-scored rows are the only ground truth there will ever be, because
  -- nothing else can confirm them.
  "humanVerdict" TEXT,
  "humanNote"    TEXT,
  "humanAt"      TIMESTAMP(3),

  -- How many products carried the phrase when it was judged. FOR REVIEW
  -- ORDERING ONLY -- it tells a reviewer which rows are worth their
  -- attention first. It is a snapshot and goes stale; never read it as a
  -- current count, which a query over Product answers properly.
  "productCount" INTEGER NOT NULL DEFAULT 0
);

-- One verdict per phrase. The unique index is also what lets the classifier
-- resume: it upserts, so a run interrupted halfway costs only the calls it
-- had not yet made.
CREATE UNIQUE INDEX "DroppedPhraseVerdict_phrase_key"
  ON "DroppedPhraseVerdict"(phrase);

-- The display path filters on the verdict, once per page render.
CREATE INDEX "DroppedPhraseVerdict_verdict_idx"
  ON "DroppedPhraseVerdict"(verdict);

-- Required of every new table by 20260930170000_enable_row_level_security:
-- Supabase exposes every public-schema table through PostgREST, and with RLS
-- off the anon key could read or change it. No policies, so anon and
-- authenticated see nothing; Prisma connects as postgres and is unaffected.
ALTER TABLE "DroppedPhraseVerdict" ENABLE ROW LEVEL SECURITY;

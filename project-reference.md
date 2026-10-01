# Rootify — Project Reference

*Updated 2026-10-01. Replaces the first-build version (6 tables, USDA only).*

This file explains **how the code and database are put together**. For
accounts, commands, maintenance and SQL recipes see `important_info.txt` (same
folder). For legal/licensing notes see `mcelroys-trust-profile\compliance\`.
The single source of truth for the database is
`mcelroys-trust-profile\prisma\schema.prisma` — every field there has a comment
explaining what it means and why it exists. If this file and the schema ever
disagree, the schema wins.

---

## 1. Project structure

```
D:\AppDev\OrganicApp\                  ← git repo root (.git lives here)
├── important_info.txt                 handoff notes: accounts, commands, maintenance, SQL
├── project-reference.md               this file
├── powershell-reference.md            PowerShell / git basics
└── mcelroys-trust-profile\            ← the Next.js app (run all commands from here)
    ├── .env                           secrets (DATABASE_URL etc.) — never commit
    ├── prisma.config.ts               tells Prisma 7 where the schema and DATABASE_URL are
    ├── prisma\
    │   ├── schema.prisma              all tables + fields, fully commented
    │   └── migrations\                one folder per schema change (dated)
    ├── src\
    │   ├── app\                       pages (Next.js App Router)
    │   │   ├── layout.tsx             wraps every page (fonts, globals.css)
    │   │   ├── page.tsx               home page
    │   │   ├── search\page.tsx        product/company search
    │   │   ├── companies\page.tsx     company list
    │   │   ├── companies\[id]\page.tsx  one company: products, parent/brands, recalls, filings
    │   │   └── products\[id]\page.tsx   one product: ingredients, nutrition, certifications, recalls
    │   ├── components\                shared UI
    │   │   ├── SiteChrome.tsx         header, footer, Open Food Facts licence notice
    │   │   ├── StatusChip.tsx         small status labels (certified, recalled, …)
    │   │   ├── CategoryGlyph.tsx      category icons
    │   │   └── DataFreshnessBanner.tsx  "data as of" banner
    │   └── lib\                       logic shared by pages and scripts
    │       ├── prisma.ts              the one database client the app uses
    │       ├── design.ts              colours, spacing (design tokens)
    │       ├── vetting.ts             VETTED_COMPANIES filter — what counts as visible
    │       ├── recalls.ts             which recalls show where + their evidence wording
    │       ├── recallMatching.ts      name/brand matching rules for recalls
    │       ├── brandMatching.ts       brand ↔ company name comparison
    │       ├── productTypes.ts        product types and the categories valid for each
    │       ├── categoryDisplay.ts     how a category is labelled ("(estimated)" etc.)
    │       ├── usdaCategoryMap.ts     USDA category → Rootify category
    │       ├── offCategoryMap.ts      Open Food Facts tags → Rootify category
    │       ├── nameCategoryMap.ts     product-name keywords → Rootify category
    │       ├── ingredientParsing.ts   splits an ingredient label into ingredients
    │       ├── ingredientNormalization.ts  cleans/merges ingredient names
    │       ├── ingredientClassification.ts flags ingredients of interest
    │       ├── ingredientStore.ts     writes ingredient rows
    │       ├── offIngredients.ts / offNutrition.ts  read OFF ingredient & nutrition data
    │       ├── productSignals.ts      the 5 shopper facts (Flagged · Recalls · Organic · Non-GMO · Owner), used by search + product page
    │       ├── staleness.ts           is a source overdue? (last ingestion run > 45 days)
    │       ├── upc.ts                 normalizeUpc(): every barcode stored as 13 digits
    │       └── userAgent.ts           User-Agent sent to SEC / Open Food Facts
    ├── scripts\                       import, cleanup and matching scripts (see important_info.txt §5)
    │   └── recall-firms.json          decisions about recall firms used by match-recalls.ts
    ├── compliance\                    legal/licensing drafts for the lawyer review
    ├── data\                          downloaded source files (git-ignored, large)
    └── logs\                          script logs, dry-run plans, undo files (git-ignored)
```

---

## 2. How data gets in

```
Open Food Facts dump ─ bulk-import-off.ts ─┐
OFF / OBF APIs ─ ingest-openfoodfacts / ingest-openbeautyfacts / discover-products ─┤
USDA FoodData Central ─ ingest-fooddata-central / vet-companies / categorize ─┤
                                                     ▼
                                     Company + Product (+ ingredients, nutrition)
                                                     │
          vet-companies.ts / apply-held-decisions.ts │ decide which companies are real
                                                     ▼  ("vetted" = visible + matchable)
USDA Organic Integrity ─ ingest-usda ───────────► OrganicCertification
Non-GMO Project sheets ─ ingest-nongmo ─────────► ProductCertification
FDA / FSIS / CPSC recalls ─ match-recalls ──────► RegulatoryAction + RegulatoryActionLink
FDA warning letters ─ ingest-fda-warning-letters ► RegulatoryAction
CBP forced labor ─ ingest-cbp-forced-labor ─────► RegulatoryAction
SEC EDGAR ─ ingest-sec-edgar ───────────────────► InvestorFiling
```

Key idea: **only vetted companies are matched against outside sources** (recalls,
certificates, filings all match by name). Matching against unverified brand text
would attach one company's recall to another that shares a word.

---

## 3. Database tables (21)

**Every fact table carries the same provenance fields:**
`sourceUrl` (where it came from), `sourceType`, `dataPulledDate` (when it was
read), `aiDrafted`, `reviewerId` + `reviewDate` (set only when a person reviewed
it — scripts never set these).

### Companies and products

| Table | What it holds | Key fields |
|---|---|---|
| **Company** | A brand, maker, supplier or retailer | `legalName`, `dbaNames[]` (brand names), `parentCompanyId` (owner), `vettingStatus`, `vettingMethod`, `vettingNotes`, `brandOwner` (manufacturer per USDA), `businessRole` |
| **Product** | One product (each flavour/size variant is its own row) | `name`, `upc` (unique, 13-digit), `companyId`, `productType`, `category`, `categorySource`, `ingredientDisclosureStatus`, `ingredientSource`, `importSource`, `commodityId` (branded produce only) |
| **Ingredient** | One normalised ingredient name | `name` (unique), `category`, `flaggedForResearch` |
| **ProductIngredient** | Ingredient list of a product | `productId`+`ingredientId`, `listPosition`, `isOrganicSourced`, `isTrace` |
| **NutritionFacts** | Nutrition panel (one per product) | serving size, calories, fat, sugar, carbs, sodium, protein |

Allowed values (kept in code, not enforced by the database):

- `vettingStatus`:
  - `unvetted` ("held", hidden)
  - `vetted`
  - `rejected` (junk; kept so re-imports don't recreate it)
- `vettingMethod`:
  - `human`
  - `automated_usda`
  - `automated_ai`
  - `automated_recall`
- `businessRole`:
  - null (unclassified, most are brands)
  - `brand`
  - `supply_chain` (co-packer, distributor, importer)
  - `retailer`
- `categorySource` (strongest first):
  - `usda_fdc`
  - `open_food_facts`
  - `name_estimate`
  - `ai_estimate`
  - `manual` (never changed by scripts)
- `ingredientDisclosureStatus`:
  - `unchecked` (say nothing)
  - `disclosed`
  - `not_disclosed` (checked everywhere, found nothing; show it with the date)
- `ingredientSource`:
  - `open_food_facts`
  - `usda_fooddata_central`
  - `manufacturer_site`
  - `retailer_listing`
  - `label_photo`
- `importSource`: `open_food_facts_bulk`, or null if added by hand or per-product scripts.
- `productType` and the categories valid for each type are listed in `src\lib\productTypes.ts`.

Note: for an **unvetted** company, `legalName` is the raw brand text from the
source (e.g. "Kirkland Signature"), not the legal entity. Vetting corrects it
by moving the brand into `dbaNames` and making `legalName` the real entity.

### Certifications, regulatory, investor

| Table | What it holds | Key fields |
|---|---|---|
| **OrganicCertification** | USDA organic certificate for a product | `certifyingAgency`, `certificateNumber`, `certificationStatus`, `certifiedScopes[]`, `lastVerifiedDate` |
| **ProductCertification** | Other certifications (Non-GMO Project, Non-UPF) | `scheme`, `status` (verified/expired/withdrawn), `lastVerifiedDate` |
| **OwnershipCertification** | MBE / WBE / veteran / DBE (low priority) | booleans + `certifyingBody` |
| **RegulatoryAction** | A recall, warning letter or CBP order, owned by the company that **issued/received** it | `sourceAgency`, `actionType`, `referenceNumber`, `classification`, `reason`, `productDescription`, `actionDate`, `productRelevance`, `commodityId` |
| **RegulatoryActionLink** | Ties an action to the **brand/product** it concerns, with the reason | `actionId`, `companyId`, `productId`, `matchMethod`, `matchedText` |
| **InvestorFiling** | SEC data for public companies | `ticker`, `filingDate`, `publicStatus`, `majorShareholders` |

- `productRelevance`:
  - `direct`
  - `supply_chain`
  - `unrelated_line` (never show on a product page)
  - `unreviewed`
- `matchMethod`, i.e. why a recall is linked to a brand/product:
  - `barcode`: the recall lists the product's barcode
  - `brand_name`: the brand is named in the notice
  - `owner_brand`: the recalling firm owns this brand
  - `firm_is_brand`: the firm's own name is the brand
  - `named_brand`: a brand named in the product description
  - The wording shown for each one lives in `src\lib\recalls.ts`.
- **Recall rule:**
  - A recall lives on the issuing company's page (`RegulatoryAction.companyId`).
  - Brand and product pages show it only through a `RegulatoryActionLink`, always with `productDescription` and the evidence note.

### Research records (AI-drafted, not yet reviewed)

| Table | What it holds |
|---|---|
| **SupplyChainDisclosure** | What a company publishes about its supply chain (`verificationBasis`: self_reported / independently_verified) |
| **IndependentInvestigation** | NGO/journalist investigations (`allegationSummary`, `companyResponse`, `status`) |
| **IngredientStudy** | Studies on an ingredient: `evidenceFraming`, `consensusStatus`, `fundingBasis`, `conflictOfInterestNote`, `positionType`; `challengesStudyId` links a dissenting study to the one it contests |
| **IngredientRegulatoryStatus** | How each country regulates an ingredient (`jurisdiction`, `status`, `limitValue`), e.g. hexane limits US vs EU |

### Loose produce

| Table | What it holds |
|---|---|
| **Commodity** | A generic produce item (Strawberries, Romaine Lettuce) |
| **PluCode** | Store PLU stickers → commodity |
| **CommodityNutrition** | Nutrition for the commodity |
| **OriginObservation** | Where a store's produce came from (sticker, sign, user photo), optionally the shipper company |
| **RegionalSupplyReport** | USDA market reports on which regions are supplying a commodity |

### Housekeeping

- **IngestionLog**: one row per ingestion run (source, file, records matched).
- **review_backup** schema (not in Prisma): backup and undo tables written by the cleanup scripts. Listed in `important_info.txt` §7.

---

## 4. Conventions in the code

- **Database client:** the app uses `src\lib\prisma.ts`. Scripts create their own client with the `PrismaPg` adapter (Prisma 7 requires it), reading `DATABASE_URL` from `.env` via `dotenv/config`.
- **New ids** default in the database (`gen_random_uuid()`), so raw SQL inserts work too.
- **Barcodes:** always pass them through `normalizeUpc()` before saving or comparing.
- **Scripts:**
  - They do a dry run by default; `--live` writes.
  - Each writes a timestamped log to `logs\`.
  - Bigger ones write an "applied" JSON that `--undo` reads.
  - Every script starts with a comment explaining WHY, WHAT and USAGE.
- **Visibility:** pages and matchers filter companies with `VETTED_COMPANIES` (`src\lib\vetting.ts`). Unvetted companies are hidden or labelled "not yet in Rootify's reviewed database".
- **Next.js 16:** this version has breaking changes. Check `node_modules\next\dist\docs\` before copying older examples.
- **Schema changes:**
  1. Edit `schema.prisma`.
  2. Run `npx prisma migrate dev --name <what>`.
  3. Run `npx prisma generate`.
  4. Restart the dev server.

---

## 5. Known gotchas (still true)

- **Prisma 7:**
  - `datasource.url` is in `prisma.config.ts`, not `schema.prisma`.
  - `new PrismaClient()` without an adapter fails with a "no options" error.
- **Id defaults:** `@default(uuid())` only works for inserts made through Prisma. Use `@default(dbgenerated("gen_random_uuid()"))`.
- **Connection:** the direct Supabase host is IPv6-only. Use the Session Pooler connection string.
- **Prisma Studio** is unreliable for array edits and deletes. Use the Supabase SQL Editor, deleting child rows before parents.
- **USDA Organic Integrity exports** download as `.csv` but are really `.xlsx`.
- **USDA organic data** is per operation (company), not per product. `ingest-usda.ts` applies a matched certificate to that company's products.
- **Recalls name legal entities**, which can cover sibling brands. That's why `RegulatoryActionLink` and `productRelevance` exist.
- **Prisma transactions** time out after 5 seconds by default. Pass `{ maxWait: 30000, timeout: 120000 }` and use smaller batches.

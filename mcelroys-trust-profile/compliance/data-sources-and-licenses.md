# Data sources and licences

**DRAFT for lawyer review.** "Verify" means the terms were not read in full
when this was written; check the source's current terms page before launch.

| Source | Used for | Script(s) | Licence / terms | What it requires of us |
|---|---|---|---|---|
| **Open Food Facts** (openfoodfacts.org) | Most product names, barcodes, brands, ingredient lists, nutrition panels, some categories | `bulk-import-off.ts`, `ingest-openfoodfacts.ts`, `discover-products.ts` | Database: **ODbL 1.0**. Individual contents: **DbCL 1.0**. Images: CC BY-SA (we don't use images) | Attribution with link; name the licence; **share-alike** for our derived database if used publicly. See [odbl-share-alike.md](odbl-share-alike.md). API use: send a descriptive User-Agent (done) |
| **Open Beauty / Products / Pet Food Facts** | Non-food products | `ingest-openbeautyfacts.ts` | Same family as Open Food Facts: ODbL + DbCL (verify) | Same as above. The current notice names only Open Food Facts; if non-food products are shown publicly, widen it |
| **USDA FoodData Central** (fdc.nal.usda.gov) | Brand owners, product categories, ingredients | `ingest-fooddata-central.ts` | US government work, public domain (CC0) | None legally; citing it is good practice |
| **USDA Organic Integrity Database** (organic.ams.usda.gov) | Organic certification status | `ingest-usda.ts` | US government public data | None legally. Note the date certification status was read; it can change |
| **FDA recalls / enforcement (openFDA)** (api.fda.gov) | Food recalls | `ingest-fda-recalls.ts` | openFDA data is public domain; openFDA terms disclaim accuracy and **forbid implying FDA endorsement** | Don't use FDA logos or suggest FDA endorses Rootify. Show recall dates and source links |
| **FDA Data Dashboard** (warning letters, seizures, injunctions) | Warning letters | `ingest-fda-warning-letters.ts` | Requires an FDA-issued key; **verify** the terms tied to that key (redistribution, rate limits) | Verify before launch |
| **USDA FSIS** (fsis.usda.gov) | Meat, poultry and egg recalls and public health alerts | `ingest-fsis-recalls.ts` | US government public data | Same endorsement caution as FDA |
| **CPSC / SaferProducts.gov** | Non-food product recalls | `ingest-cpsc-recalls.ts` | US government public data | Same endorsement caution |
| **US Customs and Border Protection** | Forced-labor Withhold Release Orders / findings | `ingest-cbp-forced-labor.ts` | US government public data | High-stakes claim: show exactly what CBP said, the date, and the link, nothing more |
| **SEC EDGAR** (sec.gov, data.sec.gov) | Investor filings | `ingest-sec-edgar.ts` | Public; SEC fair-access policy: User-Agent with contact, max 10 requests/second | Keep the User-Agent and rate limit (done) |
| **Non-GMO Project** (nongmoproject.org) | "Non-GMO Project Verified" and "Non-UPF Verified" status | `ingest-nongmo.ts` | Spreadsheet obtained on request through their form. **Verify** whether the terms allow republishing it, and how their marks may be named | Possibly permission or restrictions; don't show their butterfly logo without permission |
| **Retailer and manufacturer websites** | Some ingredient lists (`ingredientSource` = retailer_listing, manufacturer_site) | manual / earlier research | Each site's terms; facts themselves aren't copyrightable, page text and photos are | Store facts plus source link only; never copy photos or marketing text |

## Our own additions (not from any source)

- Company merges, parent/subsidiary links, brand → company matching.
- Product categories marked `name_estimate` (keyword rules) or `ai_estimate`
  (AI review, 2026-10-01, about 28,000 products).
- Company vetting decisions made by automated AI review (`automated_ai`),
  including the held-company review of 2026-10-01.
- Recall → company links and their evidence notes (`match-recalls.ts`,
  `classify-recall-firms.ts`).

These are Rootify's work. Where they are built on Open Food Facts data, they
become part of the ODbL "derivative database" (see the share-alike doc). They
also need to be described honestly on the methodology and AI pages (see
[disclosures-to-publish.md](disclosures-to-publish.md)).

## Data we do NOT collect (today)

No user accounts, no sign-in, no cookies set by the app, no analytics library,
no payment data. The host (Vercel) and database host (Supabase) keep server
logs that include IP addresses. This changes as soon as subscriptions,
accounts, analytics or a contact form are added; update the privacy section
then.

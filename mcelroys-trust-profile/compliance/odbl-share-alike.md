# Open Food Facts licence (ODbL): attribution and share-alike

**DRAFT for lawyer review.** Summary of the obligations as understood, and what
Rootify does about each.

## The licences

- **Open Database License (ODbL) 1.0** covers the Open Food Facts *database*
  as a whole. <https://opendatacommons.org/licenses/odbl/1-0/>
- **Database Contents License (DbCL) 1.0** covers the individual entries
  (a product's name, ingredients, nutrition). <https://opendatacommons.org/licenses/dbcl/1-0/>
- Product **images** are CC BY-SA. Rootify does not display them. If that
  ever changes, each image needs its own attribution.
- Open Food Facts' own summary: <https://world.openfoodfacts.org/terms-of-use>

## 1. Attribution (done)

ODbL section 4.2/4.3 requires a notice, wherever the data is shown or used, that
credits the source and names the licence.

- Site-wide: `OpenFoodFactsNotice` in the footer and on company pages reads:
  *"Product names, ingredients, nutrition and brand text include data from
  Open Food Facts, made available under the Open Database License (ODbL);
  individual entries under the Database Contents License."* All three names
  link to their pages.
- Per product: under the barcode, *"Product data from this product's Open Food
  Facts record (ODbL)"*, linking to
  `https://world.openfoodfacts.org/product/<barcode>`.
- Gap: the companies **list** page (`src/app/companies/page.tsx`) has no footer,
  so it has no notice. Add the footer or the notice there once the design work
  settles.
- Gap: the notice names Open Food Facts only. Non-food products come from Open
  Beauty / Products Facts; widen the wording if those are shown publicly.

## 2. Share-alike (needs a decision)

ODbL section 4.4: a **Derivative Database** (the original data changed or
added to) that is **Publicly Used** must be offered under the ODbL. Section 4.6:
when it's publicly used, the derivative database itself (or a file of the
changes) must be made available in a machine-readable form.

Rootify has changed Open Food Facts data: merged duplicate brands, matched
brands to companies and parents, assigned categories, cleaned ingredient lists.
Showing it on a public website is very likely "Publicly Used". The working
assumption is therefore that **the OFF-derived part of Rootify's database must
be published under the ODbL**.

What is *not* covered (working assumption, confirm with the lawyer): data from
other sources that is kept in separate tables and only shown alongside OFF data
(recalls, SEC filings, certifications, USDA data, Rootify's own research). ODbL
treats such combinations as a "Collective Database"; only the OFF-derived part
must be shared.

### How to produce the export

```
npx tsx scripts/export-odbl-data.ts
```

Read-only. Writes `./data/odbl-export/<date>/`:

| File | Contents |
|---|---|
| `products.csv.gz` | Products imported from OFF: barcode, name, company, parent company, category and category source |
| `companies.csv.gz` | Companies those products belong to: name, other names, parent, verified flag |
| `ingredients.csv.gz` | Ingredient lists read from OFF |
| `nutrition.csv.gz` | Nutrition panels read from OFF |
| `LICENSE.txt` | ODbL/DbCL notice, attribution, file list, meaning of category sources |

`./data/` is git-ignored, so the export never lands in the repo.

### How to publish it (options)

1. Host the files (e.g. Supabase Storage public bucket, GitHub release, or a
   static file on the site) and link them from a "Data & licences" page and
   the footer notice. Simplest.
2. Re-run the export on a schedule (monthly) and keep the latest plus dates.
3. Contribute the changes back to Open Food Facts instead / as well. Good
   citizenship, but it doesn't by itself satisfy 4.6 unless the changes are
   offered in full.

Decision needed: which option, and whether the companies file should include
Rootify's company names and parent links (current export does, because they
were built from OFF brand text).

## 3. Other ODbL points

- Don't add technical restrictions (DRM) to the export (section 4.7).
- Keep the export's licence notice intact.
- Open Food Facts asks re-users not to imply its endorsement.

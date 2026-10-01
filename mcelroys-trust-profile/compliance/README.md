# Compliance folder

**Status: DRAFT, not reviewed by a lawyer.** Nothing here is legal advice. It
collects everything Rootify may have to disclose, publish or keep on file, so a
lawyer can check it in one sitting before public launch. Keep it in the repo
and update it whenever a data source, AI step or user-facing feature changes.

| File | What it covers |
|---|---|
| [data-sources-and-licenses.md](data-sources-and-licenses.md) | Every outside source the database uses, its licence or terms, and what each one requires of us |
| [odbl-share-alike.md](odbl-share-alike.md) | The Open Food Facts licence (ODbL): attribution already on the site, the share-alike duty, and how to produce the public data export |
| [disclosures-to-publish.md](disclosures-to-publish.md) | Pages and notices the public site should carry before launch (methodology, AI use, corrections, privacy, terms, etc.) |
| [questions-for-lawyer.md](questions-for-lawyer.md) | The short list of questions for the one-time lawyer review |

## Already in place (as of 2026-10-01)

- **Open Food Facts attribution** on every page that uses the site footer and
  on company pages (`OpenFoodFactsNotice` in `src/components/SiteChrome.tsx`).
- **Per-product link** to the product's Open Food Facts record, shown under
  the barcode when the product came from Open Food Facts
  (`src/app/products/[id]/page.tsx`).
- **Data export script** for the ODbL share-alike offer:
  `npx tsx scripts/export-odbl-data.ts` (read-only; writes
  `./data/odbl-export/<date>/`).
- **Source → claim → date log**: every recall, filing, certification and
  nutrition row in the database stores `sourceUrl` and `dataPulledDate`. That
  is the log the project plan called for. Archiving copies of source pages
  (screenshots or saved HTML) is still not automated.
- **Estimates labelled as estimates**: AI and name-based categories show as
  "(estimated)" (`src/lib/categoryDisplay.ts`).
- **No scores or verdicts**: the site reports sourced facts, not a trust score.

## Not yet in place

See the checklist at the end of [disclosures-to-publish.md](disclosures-to-publish.md).

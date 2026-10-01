# Disclosures and pages to publish before launch

**DRAFT for lawyer review.** Each item says why it's needed and what it should
say. Text is a starting point, not final wording.

## 1. How we source and present information (methodology page)

Why: the project's main legal protection is that every claim is a specific,
sourced, dated fact. Saying so publicly sets reader expectations and shows good
faith.

Should say:
- Every fact links to its primary source (agency notice, filing, certification
  record, Open Food Facts entry) and shows the date it was read.
- Rootify reports what sources say. It does not rate, score or rank companies.
- Data can be out of date; check the linked source for the current status.
- What "verified company" and "not yet verified" mean on the site.

## 2. Recall wording policy

Why: linking a recall to the wrong company is the highest-risk false claim on
the site.

Should say:
- How a recall is linked to a company page: by barcode, by brand name in the
  notice, by the recalling firm owning the brand, etc. Each link already shows
  its reason in plain words (`src/lib/recalls.ts` evidence notes).
- A recall issued by a supplier, co-packer or retailer is labelled as such, and
  is not a statement that the brand owner was at fault.
- Recall listings are historical records; a recall doesn't mean the product on
  shelves today is affected.

## 3. AI use disclosure

Why: honesty, and some states require disclosure of AI-generated content in
certain contexts (verify current state laws). Also the project plan originally
treated a human review step as the key safeguard; the current pipeline has none
(see questions-for-lawyer.md).

Should say, specifically:
- About 28,000 product categories were estimated by AI from the product name,
  brand and ingredients. They are shown as "(estimated)".
- Some company records (whether a name is a real brand, which company a brand
  belongs to, parent companies) were decided by automated AI review.
- Some recall-to-company links were decided with AI help.
- AI is not used to write claims about companies; summaries come from source
  text. *(Update if AI-drafted blurbs are added later.)*
- How to report a mistake (see 4).

## 4. Corrections and disputes

Why: prompt corrections reduce defamation exposure and are the plan's stated
policy ("correct if wrong, hold ground with sources if right").

Should say:
- A contact address (dedicated email, not a personal one) for corrections and
  disputes, from companies and the public.
- What to include (page link, what's wrong, evidence).
- Target response time (e.g. acknowledge in 3 business days).
- Corrections are made promptly; corrected pages note the change and date.

Also needed internally: a corrections log (date, page, complaint, outcome).

## 5. Terms of use

Should cover: information only, no warranty of accuracy or completeness; data
is dated; links to third-party sources; not affiliated with or endorsed by any
agency, Open Food Facts, the Non-GMO Project or any company named; limitation
of liability; governing law (state of the LLC); the ODbL licence for the
OFF-derived data (users may reuse it under the ODbL); acceptable use (no
scraping of the site beyond the published export, if desired).

## 6. Not medical or dietary advice

Ingredient, nutrition, allergen and recall information is for general
information. Always read the product label; allergen data may be incomplete
or out of date. Not a substitute for advice from a doctor or dietitian.

## 7. Privacy policy

Today the app collects nothing directly, but the host keeps server logs with IP
addresses. A short privacy policy is still expected (California's CalOPPA
applies to any commercial site that collects personal information from
California residents). It must be expanded before adding accounts,
subscriptions, analytics, cookies, newsletters or a contact form. Not directed
at children under 13 (COPPA).

## 8. Trademarks

Company and brand names are used only to identify them (nominative use). Don't
display company logos or certification marks (USDA Organic seal, Non-GMO
Project butterfly, agency logos) without permission or a clear right to.
Footer line: "Brand names and trademarks belong to their owners. Their
appearance doesn't imply endorsement."

## 9. Data & licences page

Lists every source with link and licence (from data-sources-and-licenses.md),
the Open Food Facts attribution, and the link to the ODbL data export.

## 10. Data freshness

Each source's last update date (the `DataFreshnessBanner` component already
exists). Mention it on the methodology page.

## Later, when charging money

- Subscription terms: auto-renewal disclosures and easy cancellation
  (California and other state automatic-renewal laws; check the current status
  of any federal "click to cancel" rule).
- Sales tax on digital subscriptions in some states.
- Refund policy.
- Payment processor terms (Stripe etc.) and their privacy requirements.
- If affiliate links or sponsorships are ever added: FTC disclosure rules.

## Checklist

- [x] Open Food Facts attribution (footer, company pages)
- [x] Per-product Open Food Facts link
- [x] ODbL export script
- [ ] Notice on the companies list page
- [ ] Widen notice wording if non-food products are shown
- [ ] Decide how to host the ODbL export; link it
- [ ] Methodology page
- [ ] Recall wording policy (on methodology page)
- [ ] AI use page or section
- [ ] Corrections page + dedicated contact email + internal corrections log
- [ ] Terms of use
- [ ] Not-medical-advice notice
- [ ] Privacy policy
- [ ] Trademark footer line
- [ ] Data & licences page
- [ ] Verify Non-GMO Project and FDA Data Dashboard terms
- [ ] Archive copies of source pages at time of publication (plan item 1)
- [ ] LLC formed (plan item 3)
- [ ] Lawyer review (questions-for-lawyer.md)

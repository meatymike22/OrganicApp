import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
// The filter catalogue, so a category chip on this page links to the search
// filter that means the same thing by the same word.
import { INGREDIENT_FILTERS } from '@/lib/ingredientFilters'
import { colors, font, isoDate, layout, status } from '@/lib/design'
import { describeCategory } from '@/lib/categoryDisplay'
import { flaggedSignal, ingredientCount, nonGmoSignal, organicSignal, ownerSignal, recallSignal, type ProductForSignals, type Signal } from '@/lib/productSignals'
import {
  companyDisplayName,
  headingWithBrand,
  isShortened,
  productBrand,
  productDisplayName,
  shortProductName,
} from '@/lib/productName'
import { assessmentWeight, classificationMeaning } from '@/lib/authorities'
import { plainReason } from '@/lib/plainRecall'
import { getRelatedProducts, type RelatedProduct, type RelatedSet } from '@/lib/relatedProducts'
import { evidenceNote, getProductRecalls, getRecallsListingProducts, groupRecalls, type RecallGroup } from '@/lib/recalls'
import { ProductThumb } from '@/components/ProductThumb'
import { Collapsible } from '@/components/Collapsible'
import { CopyBarcode } from '@/components/CopyBarcode'
import { AisleBar, BackLink, SiteFooter, TopNav } from '@/components/SiteChrome'
import { SignalTable, SignalTableNote, StatusChip } from '@/components/StatusChip'

// Everything on this page in one query. The product page is the place a
// shopper goes to check our work, so it pulls the actual source rows — the
// certificate numbers, the agencies, the dates — not just the summaries.
const PRODUCT_FIELDS = {
  id: true,
  name: true,
  upc: true,
  category: true,
  categorySource: true,
  productType: true,
  ingredientDisclosureStatus: true,
  ingredientCheckedAt: true,
  ingredientSource: true,
  ingredientSourceUrl: true,
  importSource: true,
  productIngredients: {
    select: {
      isOrganicSourced: true,
      listPosition: true,
      isTrace: true,
      concentrationNote: true,
      ingredient: {
        select: {
          id: true,
          name: true,
          category: true,
          flaggedForResearch: true,
          _count: { select: { studies: true } },
          // The codes, not a count: "IARC Group 2B" is information and "2
          // rulings" is not. A handful of rows per ingredient at most.
          authorityAssessments: { select: { classificationCode: true } },
        },
      },
    },
  },
  certifications: {
    select: {
      id: true,
      certifyingAgency: true,
      certificateNumber: true,
      certificationStatus: true,
      certifiedScopes: true,
      lastVerifiedDate: true,
      sourceUrl: true,
      reviewDate: true,
    },
  },
  productCertifications: {
    select: {
      id: true,
      scheme: true,
      certifyingBody: true,
      certificateNumber: true,
      status: true,
      scopeNote: true,
      lastVerifiedDate: true,
      sourceUrl: true,
      reviewDate: true,
    },
  },
  imageUrl: true,
  imageSource: true,
  imageSourceUrl: true,
  company: {
    select: {
      id: true,
      legalName: true,
      dbaNames: true,
      vettingStatus: true,
      businessRole: true,
      parentCompany: { select: { id: true, legalName: true } },
    },
  },
} as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await prisma.product.findUnique({
    where: { id },
    select: { name: true, company: { select: { legalName: true, dbaNames: true } } },
  })
  if (!product) return { title: 'Product not found' }
  const title = productDisplayName(product.name, product.company.legalName, product.company.dbaNames)
  return { title: `${title} — ${companyDisplayName(product.company.legalName)}` }
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  // Only `from` is read here, and only to offer a way back to the list the
  // reader came from. Nothing on this page varies by query string.
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // In Next.js 15+ the dynamic part of the URL arrives as a Promise.
  const { id } = await params
  const sp = searchParams ? await searchParams : {}
  const fromParam = Array.isArray(sp.from) ? sp.from[0] : sp.from

  const product = await prisma.product.findUnique({ where: { id }, select: PRODUCT_FIELDS })

  // A product whose company a reviewer rejected is kept only so bulk
  // ingestion will not recreate it. Treated the same as not existing.
  if (!product || product.company.vettingStatus === 'rejected') notFound()

  // The company name is printed as its own line and in the breadcrumb, so
  // the brand comes off the front of the product name. Computed once here so
  // the breadcrumb, the glyph label and the h1 cannot disagree.
  const title = productDisplayName(product.name, product.company.legalName, product.company.dbaNames)

  const forSignals = product as unknown as ProductForSignals

  // Related products cost about 250 ms (measured; see relatedProducts.ts), so
  // they go in the same Promise.all as the recall queries rather than in
  // series after them. A separate floating promise would also have worked and
  // would have been worse: a rejection on a promise nobody awaits in the same
  // tick is an unhandled rejection.
  const [listed, recalls, related] = await Promise.all([
    getRecallsListingProducts([product.id]),
    getProductRecalls(product.id),
    getRelatedProducts({
      id: product.id,
      category: product.category,
      companyId: product.company.id,
    }),
  ])

  const flagged = flaggedSignal(forSignals)
  const recall = recallSignal(forSignals, listed.get(product.id))
  const organic = organicSignal(forSignals)
  const nonGmo = nonGmoSignal(forSignals)
  const owner = ownerSignal(forSignals)
  const count = ingredientCount(forSignals)

  // Ingredients in the order they appear on the label. Label order is itself
  // information — it is roughly descending by weight — so a product whose
  // positions were never recorded says so rather than showing a list in
  // whatever order the database returned.
  const hasOrder = product.productIngredients.every((pi) => pi.listPosition !== null)

  // THE INGREDIENT ROW OF THE TABLE, as a Signal like the others.
  //
  // `ingredientCount` returns a number or null, which is not enough for a
  // table whose whole job is to distinguish three states. Null means two
  // different things here and they must not share a row: the disclosure
  // status says whether we looked.
  const ingredientSignal: Signal =
    count !== null
      ? {
          column: 'flagged',
          state: 'confirmed',
          label: `${count} ingredient${count === 1 ? '' : 's'}`,
          detail: hasOrder ? 'Listed in label order' : 'Label order was not recorded',
        }
      : product.ingredientDisclosureStatus === 'not_disclosed'
        ? {
            column: 'flagged',
            state: 'nothingOnFile',
            label: 'Not published',
            detail: 'No ingredient list was found in any source we check.',
          }
        : {
            column: 'flagged',
            state: 'unchecked',
            label: 'Not checked',
            detail: 'We have not looked up an ingredient list for this product yet.',
          }

  const cat = describeCategory(product.category, product.categorySource)
  const isUnvetted = product.company.vettingStatus !== 'vetted'

  const ingredients = [...product.productIngredients].sort(
    (a, b) => (a.listPosition ?? 0) - (b.listPosition ?? 0)
  )

  return (
    <>
      <TopNav />
      <AisleBar />
      {/* THE COMPANY IS NOT IN THIS TRAIL ANY MORE.
          Michael, 2026-10-08: "why am i getting the campbells company in the
          tab history bar here? i never clicked on the campbells page. this
          needs to be fixed."

          The trail was correct — that product's company IS The Campbell's
          Company, and a breadcrumb shows where a page sits rather than where
          you have been. But he has now read it as browsing history twice (the
          same comment arrived in round 12), and a component that has to be
          explained is not doing its job.

          It also cost nothing to remove: the company name is a link in the
          product header about 40 pixels below this bar, which is the natural
          place to go up to the company from. One route up, not two, and no
          row that looks like a history entry nobody created. */}
      {/* Renders nothing unless the reader arrived from a list. See BackLink
          in SiteChrome.tsx for why the breadcrumb is gone. */}
      <BackLink from={fromParam} />

      {/* HEADER */}
      <div
        style={{
          boxSizing: 'border-box',
          padding: `26px ${layout.gutter}px 0`,
          display: 'flex',
          gap: 24,
          alignItems: 'flex-start',
        }}
      >
        {/* No `credit` here. The CC-BY-SA attribution moved to this
            product's sources page (decided 2026-10-06) — a credit under
            every photo was, in Michael's words, making the layman's eyes
            sore. The licence is still satisfied: the credit is one click
            from the image, named and linked, on a page reachable from here.
            Worth confirming at legal review. */}
        <ProductThumb
          product={product}
          category={product.category}
          productType={product.productType}
          // The one place a product's photograph is shown large, so it gets
          // the most room — and fluid, so it does not take over a phone.
          // Same em-based sizing as the search row; see ProductThumb.
          size="clamp(112px, 13vw, 184px)"
          intrinsic={320}
          label={title}
          // Portrait frame, so a package photograph fills it instead of
          // shrinking to fit a square. See the note on `tall` in
          // ProductThumb.tsx.
          tall
        />
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: colors.ink3,
            }}
          >
            {cat.label && (
              <span
                title={cat.note ?? undefined}
                style={{ padding: '2px 7px', background: '#EFEADD', borderRadius: 3, color: colors.ink2 }}
              >
                {cat.label}
              </span>
            )}
            <Link href={`/companies/${product.company.id}`} style={{ color: colors.ink3 }}>
              {companyDisplayName(product.company.legalName)}
            </Link>
          </div>

          {/* BRAND, THEN A CONCISE NAME. Michael, 2026-10-08, on CROPP
              Cooperative's "1% Lowfat Milk": "this should say 'Organic Valley
              1% Lowfat Milk'. it should be 'brand, then, concise product
              name'. then the full product name can go below this title."

              Both halves of that are now true:
              - headingWithBrand adds the shelf brand when it differs from the
                legal company name, and adds nothing when the company name IS
                the brand (the common case, and it is already printed above).
              - shortProductName strips a leading stack of label claims before
                any tail cut, so "A2/A2 100% Grass-fed Regenerative Organic
                Probiotic Kefir" reads "Probiotic Kefir" rather than losing the
                word "Kefir" off the end — which is what it did before.
              The stored name in full is on the line below. */}
          <h1
            style={{
              margin: '7px 0 0',
              fontFamily: font.display,
              fontSize: 34,
              lineHeight: 1.1,
              fontWeight: 600,
              letterSpacing: '-0.015em',
            }}
          >
            {headingWithBrand(
              shortProductName(title),
              productBrand(product.company.legalName, product.company.dbaNames)
            )}
          </h1>

          {/* The stored name in full, whenever the heading is showing less
              than all of it. This line is what makes shortening safe —
              nothing is hidden, it is just no longer the first thing you
              have to read. See shortProductName in productName.ts. */}
          {isShortened(title) && (
            <div style={{ fontSize: 13, lineHeight: 1.5, color: colors.ink3, marginTop: 7, maxWidth: '68ch' }}>
              On the label: {title}
            </div>
          )}

          {product.upc && (
            <div style={{ marginTop: 9 }}>
              <CopyBarcode value={product.upc} />
            </div>
          )}

          {/* WHAT THE RECORD SAYS — one labelled row per question.

              Michael, 2026-10-07: "how are they supposed to know what isn't
              on file here? Nothing is labeled. There should be an aesthetic
              table for the layman so they can understand what all of this
              is." He was looking at a row of bare chips — "Not on file",
              "Maker certified", "3 flagged" — with nothing saying which
              question each one answered. The information was all there and
              none of it was readable.

              This replaces BOTH the chip strip and the separate tile row
              that used to sit under the hero. Those two showed the same
              five signals twice, once unlabelled and once labelled, and the
              unlabelled one came first. One table, each row naming its own
              question and linking to the section that answers it. */}
          <div style={{ marginTop: 16 }}>
            <SignalTable
              rows={[
                {
                  question: 'What is in it',
                  signal: ingredientSignal,
                  href: '#ingredients',
                },
                { question: 'Open research', signal: flagged, href: '#flagged' },
                { question: 'Recalls', signal: recall, href: '#recalls' },
                // These two used to point at #certificates, which no longer
                // exists — Michael, 2026-10-07: "I am not sure how much
                // immediate value this section provides. At the very top we
                // already provide it. Remove this for now." The certificate
                // record and its date live on the sources page, so that is
                // where the rows now go. A row that links to a deleted anchor
                // silently does nothing, which is worse than not linking.
                {
                  question: 'Certified organic',
                  signal: organic,
                  href: `/products/${product.id}/sources`,
                },
                {
                  question: 'Non-GMO verified',
                  signal: nonGmo,
                  href: `/products/${product.id}/sources`,
                },
                { question: 'Who owns the brand', signal: owner, href: owner.href },
              ]}
            />
            <SignalTableNote />
          </div>

          {/* WHERE THE SOURCES WENT.
              Every claim on this page still has a dated primary source and
              every one is still reachable — they are all on this product's
              sources page, which is linked from here and from each section.
              Decided 2026-10-06: a fact checker needs one click, a shopper
              needs none. What must never happen is a claim about a named
              company with no route to its record at all. */}
          <div style={{ fontSize: 13, marginTop: 12 }}>
            <Link href={`/products/${product.id}/sources`}>Every source and date for this page &rarr;</Link>
          </div>
        </div>
      </div>

      {/* The brand has not been confirmed as a company, so every
          name-matched source (recalls, organic, verification registers) was
          never run against it. Said once, plainly, at the top — not repeated
          beside each empty section. */}
      {isUnvetted && (
        <div style={{ boxSizing: 'border-box', padding: `18px ${layout.gutter}px 0` }}>
          <Callout state="unchecked">
            <strong>This brand has not been confirmed yet.</strong> It came from an open product
            database as a line of brand text. Until a person or a barcode confirms which company it
            is, we cannot safely attach government notices, organic records or certifications to
            it — so those sections are empty because nobody has looked, not because there is
            nothing there.
          </Callout>
        </div>
      )}

      {/* SIGNAL ROW */}
      {/* The tile row that used to sit here is gone. It was the same five
          signals as the table in the hero above — labelled, but a second
          copy, and a reader who had just read the table had to read it again
          to find out it said nothing new. The table kept the one thing the
          tiles did that the old chip strip did not: every row links to its
          section, so it is still the table of contents. */}

      {/* BODY */}
      <div
        style={{
          flexGrow: 1,
          boxSizing: 'border-box',
          padding: `30px ${layout.gutter}px 0`,
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
        }}
      >
        {/* INGREDIENTS FIRST. Michael: "The ingredients should be shown
            first before research, recalls, open research, etc." It is also
            the one section that is about the product itself rather than
            about its maker's record, and the one a shopper standing in an
            aisle actually came for. */}
        <Ingredients ingredients={ingredients} product={product} hasOrder={hasOrder} signal={flagged} />
        <Flagged ingredients={ingredients} signal={flagged} productId={product.id} />
        <Recalls recalls={recalls} product={product} />
        {/* WHERE THE CERTIFICATES SECTION WAS. Michael, 2026-10-07:
            "Honestly I am not sure how much immediate value this section
            provides. At the very top we already provide it. Remove this for
            now. Instead, in this space maybe include a section for 'related
            products'."
            He is right that it was a second copy of the signal table: the
            same organic and non-GMO answers, three screens further down. The
            certificate records and their dates are still every bit as
            reachable — they are on this product's sources page, which is
            where the two table rows now link. */}
        <Related set={related} />
      </div>

      <SiteFooter />
    </>
  )
}

// ------------------------------------------------------------------ pieces

// SectionHead is gone from this page. Every section is a Collapsible now, and
// Collapsible draws its own heading — keeping a second heading component
// around meant two places decided what a section looked like. It still exists
// in PageParts for the pages that have not been converted.

// A tinted box used for the statements that aren't a record — the unvetted
// notice, the "nobody looked" explanations.
function Callout({ state, children }: { state: keyof typeof status; children: React.ReactNode }) {
  const s = status[state]
  return (
    <div
      style={{
        boxSizing: 'border-box',
        padding: '12px 15px',
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 7,
        fontSize: 13,
        lineHeight: 1.6,
        color: colors.ink2,
      }}
    >
      {children}
    </div>
  )
}

// Every fact on this page still carries a dated primary source — it is just
// not printed beside the fact any more. This is the pointer that replaces the
// old per-line citation: one quiet link per section to the product's sources
// page, where the URL, the reference number and the date all live.
//
// Michael, 2026-10-06: "All of our sources should be somewhere else, where
// any fact checkers can go look but the layman simply doesn't care."
//
// THE LINE THAT CANNOT BE CROSSED: a section may stop PRINTING its sources.
// It may not stop HAVING them, and it may not be reachable from nowhere. If
// you add a section to this page, give it one of these.
function SourceNote({ productId, what }: { productId: string; what: string }) {
  return (
    <div style={{ fontSize: 11.5, color: colors.ink4, marginTop: 10 }}>
      <Link href={`/products/${productId}/sources`}>{what} &mdash; sources and dates</Link>
    </div>
  )
}

type IngredientRows = {
  isOrganicSourced: boolean
  listPosition: number | null
  isTrace: boolean
  concentrationNote: string | null
  ingredient: {
    id: string
    name: string
    category: string | null
    flaggedForResearch: boolean
    _count: { studies: number }
    authorityAssessments: { classificationCode: string }[]
  }
}[]

// INGREDIENTS WORTH READING ABOUT — split by whether we actually hold
// research, because we mostly do not.
//
// Michael, 2026-10-07, on a flagged ingredient with an empty page: "why is
// this flagged but then there are no studies?" And: "are you really telling
// me there are no studies against enriched pasta?"
//
// The numbers: 6,250 ingredients carry `flaggedForResearch` and 16 have a
// study on file. The flag is set by a classification rule in
// ingredientClassification.ts — an additive or processing ingredient rather
// than a whole food — and has never meant "research exists".
//
// This section used to open with "These ingredients have studies that
// disagree with each other, or research that is still open", which was false
// for 6,234 of them, and then showed a chip reading "0 studies" in the amber
// open-research colour. Amber plus a zero is the worst of both: it looks like
// a warning and contains no information.
//
// So the list is now three lists, in descending order of what we hold:
//
//   1. Studies on file. Says how many.
//   2. No study, but a named authority has published a classification. This
//      is the third research category Michael asked for on 2026-10-07 — the
//      authority's own category, shown as the authority's own words, with the
//      source a click away. A classification is NOT a study: it is a
//      committee's reading of evidence we may not hold ourselves, so it is
//      labelled as one and never counted among the studies.
//   3. Flagged by our classifier and nothing on file yet. Neutral grey,
//      under a heading that says exactly that.
//
// Nothing is hidden and nothing is implied.
function Flagged({
  ingredients,
  signal,
  productId,
}: {
  ingredients: IngredientRows
  signal: Signal
  productId: string
}) {
  const flagged = ingredients.filter((pi) => pi.ingredient.flaggedForResearch)
  const withStudies = flagged.filter((pi) => pi.ingredient._count.studies > 0)
  const withAuthority = flagged.filter(
    (pi) => pi.ingredient._count.studies === 0 && pi.ingredient.authorityAssessments.length > 0,
  )
  const classifiedOnly = flagged.filter(
    (pi) => pi.ingredient._count.studies === 0 && pi.ingredient.authorityAssessments.length === 0,
  )

  return (
    <Collapsible
      id="flagged"
      // Michael, 2026-10-07: "this should just say Flagged Ingredients".
      // The count still leads, so this renders "3 flagged ingredients".
      title="flagged ingredients"
      count={flagged.length}
      countState={flagged.length > 0 ? 'openResearch' : undefined}
      note={
        flagged.length === 0
          ? 'Nothing flagged'
          : [
              withStudies.length > 0 ? `${withStudies.length} with studies` : null,
              withAuthority.length > 0 ? `${withAuthority.length} with an official ruling` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Nothing on file yet'
      }
      // THE THREE EXPLANATIONS, IN ONE TOOLTIP.
      //
      // Michael, 2026-10-08: "this info should be in the 'i' next to the
      // title. We do not need to show this information it is simply causing
      // text clutter and will turn off the layman."
      //
      // This section had three paragraphs of prose above three lists — about
      // 600 characters before a reader reached the first ingredient name. The
      // paragraphs were each true and each worth having; none of them was
      // worth being the first thing on the section.
      //
      // WHAT STAYED IN THE BODY, and the distinction is the three-state rule:
      // each group keeps its own one-line heading, because the heading is the
      // claim — "we hold research on these" and "classified as worth
      // checking, not yet researched" are different statements and a reader
      // must not have to hover to tell which list they are looking at. What
      // moved is the explanation of what the heading means.
      info={
        'Flagged means our classifier marked an ingredient as an additive or a processing ' +
        'ingredient rather than a whole food. It is not a finding that anything is harmful. ' +
        'The lists below are in order of what we actually hold: studies we can show you, ' +
        'then rulings published by a named agency in that agency\u2019s own words, then ' +
        'ingredients we have classified but not yet researched \u2014 which is a gap in our ' +
        'records rather than a verdict either way.'
      }
      open={flagged.length > 0}
    >
      <div style={{ marginTop: 4 }}>
        {flagged.length === 0 ? (
          <Callout state={signal.state}>{signal.detail}</Callout>
        ) : (
          <>
            {withStudies.length > 0 && (
              <>
                <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 600, color: colors.ink }}>
                  We hold research on these
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {withStudies.map((pi) => (
                    <FlaggedRow key={pi.ingredient.id} pi={pi} />
                  ))}
                </div>
              </>
            )}

            {withAuthority.length > 0 && (
              <div style={{ marginTop: withStudies.length > 0 ? 20 : 0 }}>
                <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 600, color: colors.ink }}>
                  An official ruling, but no study we hold{' '}
                  <Link href="/sourcing" style={{ color: colors.link, fontWeight: 400, fontSize: 12.5 }}>
                    what the agencies are
                  </Link>
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {withAuthority.map((pi) => (
                    <AuthorityRow key={pi.ingredient.id} pi={pi} />
                  ))}
                </div>
              </div>
            )}

            {classifiedOnly.length > 0 && (
              <div style={{ marginTop: withStudies.length > 0 || withAuthority.length > 0 ? 20 : 0 }}>
                {/* THE HEADING STAYS, THE PANEL AND THE CAVEAT GO.
                    Michael, 2026-10-08, pointing at this box: "remove this.
                    all disclaimers go to the disclaimer page, not included in
                    the browsing experience."

                    The sentence he is objecting to was "A gap in our records,
                    not a finding either way" — a caveat about what the list
                    does not mean, which is exactly the kind of line he has
                    now twice asked to collect in one place. It is on
                    /disclaimer.

                    "Classified as worth checking, not yet researched" is not
                    a caveat, it is the heading, and round 14 settled that the
                    heading is the claim: a reader must be able to tell which
                    of the three lists they are looking at without hovering.
                    So it stays — and now it is a plain bold line like the two
                    headings above it instead of a boxed grey panel, which is
                    how it should have looked from the start. */}
                <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 600, color: colors.ink }}>
                  Classified as worth checking, not yet researched
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {classifiedOnly.map((pi) => (
                    <Link
                      key={pi.ingredient.id}
                      href={`/ingredients/${pi.ingredient.id}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        boxSizing: 'border-box',
                        padding: '5px 10px',
                        background: colors.card,
                        border: `1px solid ${colors.line}`,
                        borderRadius: 6,
                        fontSize: 13,
                        color: colors.ink,
                        textDecoration: 'none',
                      }}
                    >
                      {pi.ingredient.name}
                      {pi.ingredient.category && (
                        <span style={{ fontSize: 11, color: colors.ink4 }}>{pi.ingredient.category}</span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {(withStudies.length > 0 || withAuthority.length > 0) && (
          <SourceNote
            productId={productId}
            what={
              withStudies.length > 0 && withAuthority.length > 0
                ? 'Every study and classification above'
                : withStudies.length > 0
                  ? 'Every study above'
                  : 'Every classification above'
            }
          />
        )}
      </div>
    </Collapsible>
  )
}

// One flagged ingredient we actually hold research on.
function FlaggedRow({ pi }: { pi: IngredientRows[number] }) {
  return (
    <Link
      href={`/ingredients/${pi.ingredient.id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxSizing: 'border-box',
        padding: '13px 16px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderLeft: `4px solid ${status.openResearch.fg}`,
        borderRadius: layout.radius,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div style={{ fontFamily: font.display, fontSize: 17, fontWeight: 600 }}>
          {pi.ingredient.name}
        </div>
        <div style={{ fontSize: 12.5, color: colors.ink3, marginTop: 3 }}>
          {[
            pi.ingredient.category,
            pi.listPosition !== null ? `#${pi.listPosition} on the label` : null,
            pi.isTrace ? 'listed as a trace amount' : null,
            pi.concentrationNote,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      <StatusChip state="openResearch">
        {pi.ingredient._count.studies === 1 ? '1 study' : `${pi.ingredient._count.studies} studies`}
      </StatusChip>
      <span style={{ fontSize: 20, color: colors.link }} aria-hidden>
        &rsaquo;
      </span>
    </Link>
  )
}

// One flagged ingredient we hold no study on, but which a named authority has
// classified. The chip carries the STRONGEST classification on file, in the
// authority's own category name — not a count, and not a word of ours. A code
// we hold but have not written a plain-English reading for still gets a row;
// it just gets a neutral chip saying a classification exists, because the
// alternative is hiding a record we have.
function AuthorityRow({ pi }: { pi: IngredientRows[number] }) {
  const codes = [...pi.ingredient.authorityAssessments].sort(
    (a, b) => assessmentWeight(a.classificationCode) - assessmentWeight(b.classificationCode),
  )
  const strongest = classificationMeaning(codes[0].classificationCode)
  const extra = codes.length - 1

  return (
    <Link
      href={`/ingredients/${pi.ingredient.id}#authorities`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxSizing: 'border-box',
        padding: '13px 16px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderLeft: `4px solid ${strongest ? status[strongest.state].fg : colors.ink4}`,
        borderRadius: layout.radius,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div style={{ fontFamily: font.display, fontSize: 17, fontWeight: 600 }}>
          {pi.ingredient.name}
        </div>
        <div style={{ fontSize: 12.5, color: colors.ink3, marginTop: 3 }}>
          {[
            pi.ingredient.category,
            pi.listPosition !== null ? `#${pi.listPosition} on the label` : null,
            pi.isTrace ? 'listed as a trace amount' : null,
            pi.concentrationNote,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      {strongest ? (
        <StatusChip state={strongest.state} title={strongest.plain}>
          {strongest.label}
          {extra > 0 ? ` + ${extra} more` : ''}
        </StatusChip>
      ) : (
        <StatusChip state="nothingOnFile">
          {codes.length === 1 ? '1 classification' : `${codes.length} classifications`}
        </StatusChip>
      )}
      <span style={{ fontSize: 20, color: colors.link }} aria-hidden>
        &rsaquo;
      </span>
    </Link>
  )
}

// The three kinds of recall, kept apart on purpose. See the comments on
// getProductRecalls() in src/lib/recalls.ts: only a notice that lists this
// product's barcode is a recall OF this product. The other two are shown
// because a shopper should know about them, worded as what they are.
function Recalls({
  recalls,
  product,
}: {
  recalls: Awaited<ReturnType<typeof getProductRecalls>>
  product: { id: string; company: { legalName: string } }
}) {
  if (!recalls) return null
  const { thisProduct, brand, process } = recalls

  // Grouped before counting, so the number in the collapsed header is the
  // number of recall EVENTS a reader would recognise, not the number of
  // enforcement records the agency happened to file.
  const listed = groupRecalls(thisProduct.items)
  const named = groupRecalls(brand.items)
  const processed = groupRecalls(process.items)
  const total = listed.length + named.length + processed.length

  return (
    // Collapsible, and closed by default: Michael asked for it, and on most
    // products this section is three lines of "nothing on file" that pushes
    // the ingredients off the screen. The count in the header is what makes
    // a closed section honest — you can see there is something here without
    // opening it.
    <Collapsible
      id="recalls"
      title="recalls and government notices"
      count={total}
      countState="recall"
      note={total === 0 ? 'Nothing on file' : 'FDA, FSIS, CPSC and CBP records'}
      open={listed.length > 0}
    >
      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Group
          heading="Notices that list this product"
          empty="No government notice we hold lists this product."
          groups={listed}
          state="recall"
        />
        <Group
          heading={`Notices naming ${companyDisplayName(
            product.company.legalName
          )}, without naming this product`}
          empty={`No notice names ${companyDisplayName(
            product.company.legalName
          )} without naming a product.`}
          groups={named}
          state="nothingOnFile"
        />
        {processed.length > 0 && (
          <Group
            heading="Notices about how food was made or handled"
            empty=""
            groups={processed}
            state="unchecked"
            // THIS SENTENCE WAS FALSE. It said "These name no product",
            // and the notice that prompted Michael's comment names three:
            // "specific varieties of SKITTLES Gummies, STARBURST Gummies, and
            // LIFE SAVERS Gummies". The bucket's condition is "has no link to
            // any product of ours", which is NOT the same as "names no
            // product" — it also catches notices that name products we failed
            // to match. So the wording now says what is true of both cases.
            /* TIGHTENED, NOT REMOVED. 42 words to 10. The fact it carries
                cannot go: every notice in this bucket names the company, not
                this product, and a list of recalls under a product heading
                reads as "this product was recalled" without saying so. That
                would be a false statement about a named company, which is the
                exact exposure the sourcing rules exist to prevent. This is
                not a caveat about our opinion; it is which fact is on screen.
                Flagged to Michael in thread. */
            preamble="These name this company or its parent, not this product."
          />
        )}
      </div>
      <SourceNote productId={product.id} what="Every notice above" />
    </Collapsible>
  )
}

function Group({
  heading,
  empty,
  groups,
  state,
  preamble,
}: {
  heading: string
  empty: string
  groups: RecallGroup[]
  state: keyof typeof status
  preamble?: string
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: colors.ink2,
        }}
      >
        <span>{heading}</span>
        <span style={{ fontFamily: font.mono, fontWeight: 500, color: colors.ink4 }}>{groups.length}</span>
        <span style={{ flexGrow: 1, height: 1, background: colors.line }} />
      </div>

      {preamble && (
        <p style={{ margin: '9px 0 0', fontSize: 12.5, lineHeight: 1.6, color: colors.ink3, maxWidth: 760 }}>
          {preamble}
        </p>
      )}

      {groups.length === 0 ? (
        <p style={{ margin: '9px 0 0', fontSize: 13, color: colors.ink3 }}>{empty}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          {groups.map((g) => (
            <RecallItemCard key={g.lead.id} g={g} state={state} />
          ))}
        </div>
      )}
    </div>
  )
}

// ONE RECALL NOTICE, COLLAPSED.
//
// Michael, 2026-10-07: "each of these individual recalls should be
// collapseable as well." Same reasoning as the sections two rounds ago, and
// it bites harder here: a company with seventeen notices produced seventeen
// full cards, each with its own "What it covered" box, so the page was
// several screens of recall before anything else on it could be reached.
//
// WHAT STAYS IN THE SUMMARY is the part that decides whether to open: the
// agency, the date, and the reason. The reason is the headline of a recall —
// collapsing that behind a chevron would make seventeen notices look
// identical and force you to open all of them.
//
// Native <details> again: no JavaScript, no hydration, and the nested
// .rt-collapse rules are all direct-child selectors so this sits inside the
// section's own <details> without the two fighting.
function RecallItemCard({ g, state }: { g: RecallGroup; state: keyof typeof status }) {
  const item = g.lead
  const note = evidenceNote(item)
  // PLAIN WORDS IN THE SUMMARY, THE AGENCY'S IN THE BODY. Michael,
  // 2026-10-07: "these recalls and notices need to be heavily condensed and
  // explained to a 5 year old (not in baby talk but in concise simple
  // terms)". Returns null for a reason we cannot summarise safely, and then
  // the agency's own sentence is the headline as before — see plainRecall.ts.
  const plain = plainReason(item.reason)
  // How many agency records make up this one event. The FDA files one per
  // affected product line, so a single recall arrives as sixteen
  // near-identical records (see groupRecalls in recalls.ts). They are all
  // kept and all citable; they are just not read out one by one.
  const extra = g.items.length - 1
  // Is there anything behind the chevron? A notice with no description, no
  // evidence note and no sibling records has an empty body, and a control
  // that opens onto nothing is worse than no control. When we summarised the
  // reason, the agency's wording is itself body content.
  const hasBody = Boolean(plain) || Boolean(item.productDescription) || Boolean(note) || extra > 0

  const head = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {hasBody && (
          <svg
            className="rt-chev"
            aria-hidden
            width="9"
            height="9"
            viewBox="0 0 12 12"
            fill="none"
            stroke={colors.ink3}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 2l5 4-5 4" />
          </svg>
        )}
        <StatusChip state={state}>
          {item.sourceAgency}
          {item.classification ? ` · ${item.classification}` : ''}
        </StatusChip>
        {item.actionDate && (
          <span style={{ fontFamily: font.mono, fontSize: 12, color: colors.ink4 }}>
            {isoDate(item.actionDate)}
          </span>
        )}
        {item.status && <span style={{ fontSize: 12, color: colors.ink3 }}>{item.status}</span>}
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, color: colors.ink }}>
        {plain ? plain.text : item.reason}
      </p>
    </>
  )

  const body = (
    <>
      {/* THE AGENCY'S OWN SENTENCE, whenever the summary above is ours. This
          is what makes the paraphrase defensible: a reader can always check
          it against the original without leaving the page. */}
      {plain && (
        <p style={{ margin: '11px 0 0', fontSize: 12.5, lineHeight: 1.6, color: colors.ink3 }}>
          <strong style={{ color: colors.ink2 }}>The notice says: </strong>
          {item.reason}
        </p>
      )}

      {/* What the notice actually covered, in its own words. This is the box
          that stops a 2018 notice about one product line reading as a recall
          of everything the company makes. */}
      {item.productDescription && (
        <div
          style={{
            marginTop: 11,
            boxSizing: 'border-box',
            padding: '10px 12px',
            background: colors.panel,
            borderRadius: 6,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: colors.ink2,
          }}
        >
          <strong style={{ color: colors.ink }}>What it covered: </strong>
          {item.productDescription}
        </div>
      )}

      {note && (
        <p style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.6, color: colors.ink3 }}>
          {note}
        </p>
      )}

      {/* The one line that replaces fifteen repeated cards. */}
      {extra > 0 && (
        <p style={{ margin: '9px 0 0', fontSize: 12.5, color: colors.ink3 }}>
          The agency filed {g.items.length} records under this notice, one per affected product
          line.
        </p>
      )}

      {/* THE RECORD ITSELF, as a page a person can read. Michael,
          2026-10-07: "i dont think people will get any value out of a JSON
          file. Is there a more intelligent way to link this?" See
          /recalls/[id] — the agency URL for 94% of our notices is an
          api.fda.gov JSON endpoint, and FDA publishes no human page keyed by
          recall number, so the readable record has to be ours. */}
      <div style={{ fontSize: 11.5, marginTop: 10 }}>
        <Link href={`/recalls/${item.id}`} style={{ color: colors.link }}>
          Read the full notice
        </Link>
      </div>
    </>
  )

  const shell: React.CSSProperties = {
    boxSizing: 'border-box',
    padding: '14px 16px',
    background: colors.card,
    border: `1px solid ${colors.line}`,
    borderLeft: `4px solid ${status[state].fg}`,
    borderRadius: layout.radius,
  }

  if (!hasBody) {
    return (
      <div style={shell}>
        {head}
        <div style={{ fontSize: 11.5, marginTop: 10 }}>
          <Link href={`/recalls/${item.id}`} style={{ color: colors.link }}>
            Read the full notice
          </Link>
        </div>
      </div>
    )
  }

  return (
    <details className="rt-collapse" style={shell}>
      <summary style={{ cursor: 'pointer' }}>{head}</summary>
      {body}
    </details>
  )
}

// RELATED PRODUCTS — the shelf, not a recommendation.
//
// Replaces the certificates section. Michael, 2026-10-07: "At the very top we
// already provide it. Remove this for now. Instead, in this space maybe
// include a section for 'related products', where the user can find similar
// products (same type of product, similar ingredients (but not too similar,
// etc)."
//
// THE ORDERING IS SIMILARITY AND NOTHING ELSE. I put this to him before
// building it: a related shelf sorted by "fewer flagged ingredients" would be
// a trust score reintroduced sideways, and this site does not score products.
// So the number on each card is how much the two ingredient lists coincide,
// the heading says that, and nothing here implies the neighbour is better or
// worse than what you are looking at. See relatedProducts.ts for the measure
// and why it is Jaccard rather than share-of-their-list.
function Related({ set }: { set: RelatedSet }) {
  const total = set.similar.length + set.shorter.length
  return (
    <Collapsible
      id="related"
      title="similar products"
      count={total}
      note={total === 0 ? 'None found' : 'By shared ingredients'}
      open={total > 0}
    >
      <div style={{ marginTop: 4 }}>
        {total === 0 ? (
          <Callout state="nothingOnFile">
            We did not find another product with a similar ingredient list. That usually means we
            hold no ingredient list for this product, or none of the products we checked in this
            category shared enough of it.
          </Callout>
        ) : (
          <>
            {/* THE PARAGRAPH THAT WAS HERE IS GONE. Michael, 2026-10-08:
                "we dont need to disclaim on the actual website. we will have
                a separate page for disclaimers. please take all disclaimers
                out everywhere that isnt the specific disclaimer page."

                It explained that the percentage measures similarity rather
                than quality and that the order implies no ranking. That
                commitment has NOT been dropped — it is the no-scoring rule
                this whole site is built on, and it is now stated once on
                /disclaimer and once on /sourcing instead of restated on
                every product page.
                What replaces it is the cards doing their own work: each one
                reads "28% overlap · 7 of 25 ingredients shared", which is a
                figure a reader can check against the two labels. A statistic
                that explains itself needs no paragraph defending it. */}
            <Shelf products={set.similar} />

            {/* THE SECOND SHELF. Michael, 2026-10-07: "maybe any products
                that try to mock M&Ms but use better ingredients should also
                apply. add that to the algorithm."
                Ordered by how many ingredients are on the label, which is a
                count off the packet rather than a judgement — see the long
                note in relatedProducts.ts for why it is not "fewer
                additives" yet. */}
            {set.shorter.length > 0 && (
              <div style={{ marginTop: set.similar.length > 0 ? 20 : 0 }}>
                {/* Michael, 2026-10-08: "this description is too wordy.
                    exclude the number of the list."
                    Three sentences became one line. The count he objected to
                    ("this product lists 21") is gone from the prose; each
                    card still carries "12 ingredients vs 21 here", which is
                    where a comparison belongs — next to the thing being
                    compared, not in a preamble above all of them. */}
                <p
                  style={{
                    margin: '0 0 11px',
                    fontSize: 13.5,
                    color: colors.ink,
                    fontWeight: 600,
                  }}
                >
                  Same kind of product, shorter ingredient list
                </p>
                <Shelf products={set.shorter} myTotal={set.myTotal} />
              </div>
            )}
          </>
        )}
      </div>
    </Collapsible>
  )
}

function Shelf({ products, myTotal }: { products: RelatedProduct[]; myTotal?: number }) {
  return (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 10,
              }}
            >
              {products.map((p) => (
                <Link
                  key={p.id}
                  href={`/products/${p.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    boxSizing: 'border-box',
                    padding: '12px 14px',
                    background: colors.card,
                    border: `1px solid ${colors.line}`,
                    borderRadius: layout.radius,
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <ProductThumb
                    product={p}
                    category={p.category}
                    productType={p.productType}
                    size={48}
                    intrinsic={120}
                    label={p.name}
                  />
                  <span style={{ flexGrow: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 13.5,
                        fontWeight: 600,
                        lineHeight: 1.35,
                        color: colors.ink,
                      }}
                    >
                      {p.name}
                    </span>
                    <span style={{ display: 'block', fontSize: 11.5, color: colors.ink3, marginTop: 3 }}>
                      {companyDisplayName(p.company.legalName)}
                    </span>
                    {/* The raw counts as well as the percentage. "12 of 43"
                        can be checked against the two ingredient lists;
                        "28%" on its own cannot. */}
                    <span style={{ display: 'block', fontSize: 11, color: colors.ink4, marginTop: 3 }}>
                      {myTotal === undefined
                        ? `${p.percent}% overlap · ${p.shared} of ${p.distinct} ingredients shared`
                        : `${p.theirTotal} ingredients vs ${myTotal} here · ${p.shared} shared`}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
  )
}

function Ingredients({
  ingredients,
  product,
  hasOrder,
  signal,
}: {
  ingredients: IngredientRows
  product: { id: string; ingredientSource: string | null; ingredientDisclosureStatus: string }
  hasOrder: boolean
  signal: Signal
}) {
  // COLLAPSIBLE, like every other section.
  //
  // I argued last round that this one should stay open because it is the
  // reason the page exists. Michael, twice: "Every single section should be
  // collapseable on every single page." He is right that consistency beats
  // my per-section judgement — a page where some headings fold and others do
  // not is a page where the reader has to find out which is which.
  //
  // It opens by default, which keeps the round-7 reordering intact: the
  // ingredient list is still the first thing you read.
  return (
    <Collapsible
      id="ingredients"
      // Michael, 2026-10-07: "this should just say Ingredients".
      title="ingredients"
      count={product.ingredientDisclosureStatus === 'disclosed' ? ingredients.length : null}
      note={hasOrder ? 'In label order' : 'Label order not recorded'}
      open
    >
      <div style={{ marginTop: 4 }}>
        {product.ingredientDisclosureStatus !== 'disclosed' ? (
          <Callout state={signal.state}>{signal.detail}</Callout>
        ) : (
          <>
            <IngredientSummary ingredients={ingredients} />
            <div className="rt-inglist" style={{ marginTop: 13 }}>
              {ingredients.map((pi) => (
                <IngredientRow key={pi.ingredient.id} pi={pi} />
              ))}
            </div>
            <SourceNote productId={product.id} what="This ingredient list" />
          </>
        )}
      </div>
    </Collapsible>
  )
}

// THE FAST READ, ABOVE THE LIST.
//
// Three numbers a shopper can take in without reading anything: how many
// ingredients the label has, how many of them the label calls organic, and
// how many we are researching. The last of those is the only one with a
// colour, and only when it is not zero.
//
// These are counts of rows we hold, not claims about the food. "18 listed as
// organic" says the label said so for 18 of them — the wording has to carry
// that, because an organic CERTIFICATE is a different record on this page and
// a reader should not come away thinking the two are the same thing.
function IngredientSummary({ ingredients }: { ingredients: IngredientRows }) {
  const organic = ingredients.filter((pi) => pi.isOrganicSourced).length
  const flagged = ingredients.filter((pi) => pi.ingredient.flaggedForResearch).length

  // Which kinds of additive are on this label, with how many of each. Read
  // off Ingredient.category, so it says the same thing the search filters
  // mean by the same words.
  const kinds = new Map<string, number>()
  for (const pi of ingredients) {
    const c = pi.ingredient.category
    if (c) kinds.set(c, (kinds.get(c) ?? 0) + 1)
  }
  const byKind = [...kinds.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

  const facts: { text: string; color?: string }[] = [
    { text: `${ingredients.length} on the label` },
    ...(organic > 0 ? [{ text: `${organic} listed as organic`, color: status.confirmed.fg }] : []),
    ...(flagged > 0
      ? [{ text: `${flagged} we are researching`, color: status.openResearch.fg }]
      : []),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {facts.map((fact) => (
          <span
            key={fact.text}
            style={{ fontSize: 13, fontWeight: 600, color: fact.color ?? colors.ink2 }}
          >
            {fact.text}
          </span>
        ))}
      </div>
      {byKind.length > 0 && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {byKind.map(([kind, n]) => (
            // Each kind links to the search filtered to products WITHOUT it,
            // which is the thing someone reading this list wants next.
            <Link
              key={kind}
              href={filterHref(kind)}
              title={`Find products with no ${kind}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 9px',
                background: colors.panel,
                borderRadius: 99,
                fontSize: 12,
                color: colors.ink2,
                textDecoration: 'none',
              }}
            >
              <span style={{ fontFamily: font.mono, fontWeight: 700, color: colors.ink }}>{n}</span>
              {kind}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// A category chip links to the search filter that excludes it, when there is
// one. INGREDIENT_FILTERS is keyed by filter, each covering one or more
// category values, so the lookup runs the other way round.
function filterHref(category: string): string {
  const filter = INGREDIENT_FILTERS.find((f) => f.categories.includes(category))
  return filter ? `/search?free=${filter.key}` : `/search?without=${encodeURIComponent(category)}`
}

// ONE INGREDIENT, ONE ROW.
//
// What each row says, left to right: where it sits on the label, what it is
// called, and what we know about it. Nothing is ranked and nothing is
// scored — the amber on a flagged row is the same amber the rest of the site
// uses for "there is research to read", and a row with nothing on file is
// plain, not green.
function IngredientRow({ pi }: { pi: IngredientRows[number] }) {
  const studies = pi.ingredient._count.studies
  const authorities = pi.ingredient.authorityAssessments.length

  // What we hold, said in as few words as fits on the row. Studies and
  // authority classifications are counted separately and never added
  // together: a classification is a committee reading evidence we may not
  // hold, which is the distinction /sourcing exists to explain.
  //
  // Michael, 2026-10-08: "if there is nothing on file it shouldn't be
  // highlighted. also, remove the 'nothing on file' subtext and leave the
  // 'undisclosed flavorin' subtext."
  //
  // Both halves are right, and the first one is the three-state rule rather
  // than a style preference. Amber on this site means "there is research to
  // read". A flagged row with nothing on file wore the amber and then had
  // nothing behind it — a promise the page could not keep, on the ingredient
  // most likely to be clicked. The classification still shows: the category
  // line under the name says "undisclosed flavoring", which is the fact, and
  // is what he asked to keep.
  const holding =
    studies > 0
      ? `${studies} research ${studies === 1 ? 'record' : 'records'}`
      : authorities > 0
        ? `${authorities} authority ${authorities === 1 ? 'ruling' : 'rulings'}`
        : null

  // Highlighted only when there is something to open. `flagged` still drives
  // the flagged-ingredients section below, which counts and explains the
  // classification; it no longer colours a row on its own.
  const holdsSomething = holding !== null

  return (
    <Link
      href={`/ingredients/${pi.ingredient.id}`}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 9,
        boxSizing: 'border-box',
        padding: '7px 10px 7px 9px',
        borderLeft: `3px solid ${holdsSomething ? status.openResearch.fg : 'transparent'}`,
        borderBottom: `1px solid ${colors.line}`,
        background: holdsSomething ? status.openResearch.bg : 'transparent',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      {/* The label position. Absent when the source record did not keep the
          order, and then the column is simply empty rather than guessed. */}
      <span
        style={{
          flexShrink: 0,
          minWidth: 18,
          fontFamily: font.mono,
          fontSize: 11,
          color: colors.ink4,
          textAlign: 'right',
        }}
      >
        {pi.listPosition ?? ''}
      </span>

      <span style={{ flexGrow: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: holdsSomething ? 600 : 400,
            color: holdsSomething ? status.openResearch.fg : colors.ink,
          }}
        >
          {sentenceCase(pi.ingredient.name)}
        </span>
        {pi.isOrganicSourced && (
          <span
            title="Listed on the label as an organic ingredient"
            style={{ marginLeft: 7, fontSize: 10, fontWeight: 700, color: status.confirmed.fg }}
          >
            ORG
          </span>
        )}
        {pi.isTrace && (
          <span title="Listed as a trace amount" style={{ marginLeft: 7, fontSize: 10.5, color: colors.ink4 }}>
            trace
          </span>
        )}
        {/* What kind of thing it is, under the name rather than beside it, so
            a long ingredient name never pushes it off the row. */}
        {(pi.ingredient.category || holding) && (
          <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: colors.ink3 }}>
            {[pi.ingredient.category, holding].filter(Boolean).join(' \u00b7 ')}
          </span>
        )}
      </span>
    </Link>
  )
}

// Ingredient names are stored lower case, because that is how they are
// matched and counted. A label does not read "corn meal, whole grain rolled
// oats"; printing them as stored made the list look like a database dump.
// Only the first letter changes — anything else would be us deciding how a
// brand capitalises its own ingredients.
function sentenceCase(name: string): string {
  return name.length === 0 ? name : name[0]!.toUpperCase() + name.slice(1)
}


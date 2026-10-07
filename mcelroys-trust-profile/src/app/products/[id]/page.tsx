import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { colors, font, isoDate, layout, status } from '@/lib/design'
import { describeCategory } from '@/lib/categoryDisplay'
import { flaggedSignal, ingredientCount, nonGmoSignal, organicSignal, ownerSignal, recallSignal, type ProductForSignals, type Signal } from '@/lib/productSignals'
import { isShortened, productDisplayName, shortProductName } from '@/lib/productName'
import { assessmentWeight, classificationMeaning } from '@/lib/authorities'
import { plainReason } from '@/lib/plainRecall'
import { getRelatedProducts, type RelatedProduct, type RelatedSet } from '@/lib/relatedProducts'
import { evidenceNote, getProductRecalls, getRecallsListingProducts, groupRecalls, type RecallGroup } from '@/lib/recalls'
import { ProductThumb } from '@/components/ProductThumb'
import { Collapsible } from '@/components/Collapsible'
import { CopyBarcode } from '@/components/CopyBarcode'
import { AisleBar, Breadcrumb, SiteFooter, TopNav } from '@/components/SiteChrome'
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
  return { title: `${title} — ${product.company.legalName}` }
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  // In Next.js 15+ the dynamic part of the URL arrives as a Promise.
  const { id } = await params

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
      <Breadcrumb
        trail={[
          { label: 'Rootify', href: '/' },
          { label: 'Search', href: '/search' },
          { label: product.company.legalName, href: `/companies/${product.company.id}` },
          { label: title },
        ]}
      />

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
          size="clamp(104px, 12vw, 168px)"
          intrinsic={256}
          label={title}
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
              {product.company.legalName}
            </Link>
          </div>

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
            {shortProductName(title)}
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
              withAuthority.length > 0 ? `${withAuthority.length} classified by an authority` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Nothing on file yet'
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
                <p style={{ margin: '0 0 11px', fontSize: 13.5, lineHeight: 1.6, color: colors.ink2, maxWidth: 760 }}>
                  We hold research on these. Open one to read the studies, what each found, and who
                  paid for it. Appearing here is not a finding that an ingredient is harmful.
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
                <p
                  style={{
                    margin: '0 0 11px',
                    fontSize: 13.5,
                    lineHeight: 1.6,
                    color: colors.ink2,
                    maxWidth: 760,
                  }}
                >
                  <strong style={{ color: colors.ink }}>Classified by an authority.</strong> We hold
                  no study on these, but a named body — a cancer agency, a food safety authority, a
                  state regulator — has published a decision placing the substance in a category.
                  The category is that body's own, shown in its own words, and it is not a finding
                  about this product.{' '}
                  <Link href="/sourcing" style={{ color: colors.link }}>
                    What each authority is, and what its category means
                  </Link>
                  .
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
                {/* THE HONEST HEADING. This is the to-do list, and saying so
                    is the whole point — a reader who clicks one of these and
                    finds an empty page has been misled, not informed. */}
                <div
                  style={{
                    boxSizing: 'border-box',
                    padding: '11px 14px',
                    background: colors.panel,
                    border: `1px solid ${colors.line}`,
                    borderRadius: 7,
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    color: colors.ink2,
                    maxWidth: 760,
                  }}
                >
                  <strong style={{ color: colors.ink }}>
                    Classified as worth checking, not yet researched.
                  </strong>{' '}
                  These are additives or processing ingredients rather than whole foods, which is
                  how our classifier marks them. We hold no study and no authority classification
                  for any of them yet, and that is a gap in our records — not a finding either way
                  about the ingredient.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 11 }}>
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
          heading={`Notices naming ${product.company.legalName}, without naming this product`}
          empty={`No notice names ${product.company.legalName} without naming a product.`}
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
            preamble="These concern how food was made or handled at this company or its parent. None is matched to this product, and some name other products the company makes — so they cannot tell you whether this one was affected."
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
            <p style={{ margin: '0 0 12px', fontSize: 13.5, lineHeight: 1.6, color: colors.ink2, maxWidth: 760 }}>
              Other products in the same category, made by a different company, whose ingredient
              list overlaps this one. The percentage is how much of the two lists coincide &mdash;
              it is a measure of similarity, not of quality, and the order says nothing about which
              is better.
            </p>
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
                <p
                  style={{
                    margin: '0 0 11px',
                    fontSize: 13.5,
                    lineHeight: 1.6,
                    color: colors.ink2,
                    maxWidth: 760,
                  }}
                >
                  <strong style={{ color: colors.ink }}>
                    Same kind of product, shorter ingredient list.
                  </strong>{' '}
                  These share much of what is in this one but list fewer
                  ingredients overall &mdash; this product lists {set.myTotal}. A shorter list is
                  not automatically better, and we are not saying it is; it is simply a different
                  label to read.
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
                      {p.company.legalName}
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {ingredients.map((pi) => (
                <Link
                  key={pi.ingredient.id}
                  href={`/ingredients/${pi.ingredient.id}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    boxSizing: 'border-box',
                    padding: '6px 11px',
                    background: pi.ingredient.flaggedForResearch ? status.openResearch.bg : colors.card,
                    border: `1px solid ${pi.ingredient.flaggedForResearch ? status.openResearch.border : colors.line}`,
                    borderRadius: 6,
                    fontSize: 13,
                    color: pi.ingredient.flaggedForResearch ? status.openResearch.fg : colors.ink,
                    textDecoration: 'none',
                  }}
                >
                  {pi.listPosition !== null && (
                    <span style={{ fontFamily: font.mono, fontSize: 11, color: colors.ink4 }}>
                      {pi.listPosition}
                    </span>
                  )}
                  {pi.ingredient.name}
                  {pi.isOrganicSourced && (
                    <span
                      title="Listed on the label as an organic ingredient"
                      style={{ fontSize: 10.5, fontWeight: 700, color: status.confirmed.fg }}
                    >
                      ORG
                    </span>
                  )}
                  {pi.isTrace && (
                    <span title="Listed as a trace amount" style={{ fontSize: 10.5, color: colors.ink4 }}>
                      trace
                    </span>
                  )}
                </Link>
              ))}
            </div>
            <SourceNote productId={product.id} what="This ingredient list" />
          </>
        )}
      </div>
    </Collapsible>
  )
}


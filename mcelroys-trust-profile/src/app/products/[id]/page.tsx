import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { colors, font, isoDate, layout, status } from '@/lib/design'
import { describeCategory } from '@/lib/categoryDisplay'
import { flaggedSignal, ingredientCount, nonGmoSignal, organicSignal, ownerSignal, recallSignal, type ProductForSignals, type Signal } from '@/lib/productSignals'
import { isShortened, productDisplayName, shortProductName } from '@/lib/productName'
import { evidenceNote, getProductRecalls, getRecallsListingProducts, groupRecalls, type RecallGroup } from '@/lib/recalls'
import { ProductThumb } from '@/components/ProductThumb'
import { Collapsible } from '@/components/Collapsible'
import { CopyBarcode } from '@/components/CopyBarcode'
import { AisleBar, Breadcrumb, SiteFooter, TopNav } from '@/components/SiteChrome'
import { SignalTable, StatusChip } from '@/components/StatusChip'

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

  const [listed, recalls] = await Promise.all([
    getRecallsListingProducts([product.id]),
    getProductRecalls(product.id),
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
                { question: 'Certified organic', signal: organic, href: '#certificates' },
                { question: 'Non-GMO verified', signal: nonGmo, href: '#certificates' },
                { question: 'Who owns the brand', signal: owner, href: owner.href },
              ]}
            />
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
        <Checks product={product} organic={organic} nonGmo={nonGmo} />
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
  ingredient: { id: string; name: string; category: string | null; flaggedForResearch: boolean; _count: { studies: number } }
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
// So the list is now two lists. The ones with research lead and say how much.
// The ones without are below, in neutral grey, under a heading that says what
// the flag is. Nothing is hidden and nothing is implied.
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
  const classifiedOnly = flagged.filter((pi) => pi.ingredient._count.studies === 0)

  return (
    <Collapsible
      id="flagged"
      title="ingredients worth reading about"
      count={flagged.length}
      countState={flagged.length > 0 ? 'openResearch' : undefined}
      note={
        flagged.length === 0
          ? 'Nothing flagged'
          : withStudies.length > 0
            ? `${withStudies.length} with research on file`
            : 'None with research on file yet'
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

            {classifiedOnly.length > 0 && (
              <div style={{ marginTop: withStudies.length > 0 ? 20 : 0 }}>
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
                  how our classifier marks them. We have no study on file for any of them yet, and
                  that is a gap in our records — not a finding either way about the ingredient.
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

        {withStudies.length > 0 && <SourceNote productId={productId} what="Every study above" />}
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
            preamble="These name no product, so we cannot tell you whether this one was affected. They are here because they concern the company or its parent."
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
          {groups.map((g) => {
            const item = g.lead
            const note = evidenceNote(item)
            // How many agency records make up this one event. The FDA files
            // one per affected product line, so a single recall arrives as
            // sixteen near-identical records (see groupRecalls in
            // recalls.ts). They are all kept and all citable; they are just
            // not read out one by one.
            const extra = g.items.length - 1
            return (
              <div
                key={item.id}
                style={{
                  boxSizing: 'border-box',
                  padding: '14px 16px',
                  background: colors.card,
                  border: `1px solid ${colors.line}`,
                  borderLeft: `4px solid ${status[state].fg}`,
                  borderRadius: layout.radius,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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

                <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.6 }}>{item.reason}</p>

                {/* What the notice actually covered, in its own words. This
                    is the box that stops a 2018 notice about one product line
                    reading as a recall of everything the company makes. */}
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

                {/* The one line that replaces fifteen repeated cards. The
                    reference numbers themselves are on the sources page. */}
                {extra > 0 && (
                  <p style={{ margin: '9px 0 0', fontSize: 12.5, color: colors.ink3 }}>
                    The agency filed {g.items.length} records under this notice, one per affected
                    product line.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// EVERY CHECK WE RUN, AND WHAT IT SAYS — as one table.
//
// Replaces a section headed "Verified" that listed only the certificates a
// product happened to have. Michael: 'Saying simply "Verified" doesn't make
// sense. It just isn't organic... I think there should simply be a table of
// all of the potential caveats like "Non-gmo, organic, supply chain
// disclosed, etc".'
//
// He is right, and the table form fixes something the old one got wrong. A
// list of what we FOUND cannot be read: a product with no rows looks
// identical whether we checked and found nothing or never looked at all. A
// table of every check we run, each with its own state, can only be read one
// way — and it is the three-state rule in its natural shape.
function Checks({
  product,
  organic,
  nonGmo,
}: {
  product: {
    id: string
    ingredientDisclosureStatus: string
    productCertifications: { id: string; scheme: string; status: string; scopeNote: string | null }[]
  }
  organic: Signal
  nonGmo: Signal
}) {
  // Any verification scheme we hold that is not the non-GMO one already
  // shown above — so a scheme nobody anticipated still gets a row rather
  // than being silently dropped.
  const otherSchemes = product.productCertifications.filter((c) => !/non-?gmo/i.test(c.scheme))

  // `note` is optional because `Signal.detail` is. Every organic and non-GMO
  // branch in productSignals.ts does in fact set one today, but the type does
  // not promise it, and the honest response to a missing note is an empty
  // column — not a sentence invented here to fill it.
  const rows: { check: string; state: keyof typeof status; label: string; note?: string }[] = [
    {
      check: 'Certified organic',
      state: organic.state,
      label: organic.label,
      note: organic.detail,
    },
    {
      check: 'Non-GMO verified',
      state: nonGmo.state,
      label: nonGmo.label,
      note: nonGmo.detail,
    },
    {
      check: 'Ingredients disclosed',
      state:
        product.ingredientDisclosureStatus === 'disclosed'
          ? 'confirmed'
          : product.ingredientDisclosureStatus === 'not_disclosed'
            ? 'nothingOnFile'
            : 'unchecked',
      label:
        product.ingredientDisclosureStatus === 'disclosed'
          ? 'Published'
          : product.ingredientDisclosureStatus === 'not_disclosed'
            ? 'Not on file'
            : 'Not checked',
      note:
        product.ingredientDisclosureStatus === 'disclosed'
          ? 'A full ingredient list is published and is shown above.'
          : product.ingredientDisclosureStatus === 'not_disclosed'
            ? 'No ingredient list was found in any source we check.'
            : 'We have not looked up an ingredient list for this product yet.',
    },
    ...otherSchemes.map((c) => ({
      check: c.scheme,
      state: (c.status === 'verified' ? 'confirmed' : 'nothingOnFile') as keyof typeof status,
      label: c.status === 'verified' ? 'Verified' : 'Not current',
      note: c.scopeNote ?? `The register for "${c.scheme}" records this product as "${c.status}".`,
    })),
  ]

  return (
    <Collapsible
      id="certificates"
      // No count: "4 what we checked" reads like nonsense, and the rows are
      // visible anyway because this section opens by default.
      title="what we checked"
      note="Each row is a check we run, not a score"
      open
    >
      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => (
          <div
            key={r.check}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 14,
              flexWrap: 'wrap',
              padding: '12px 0',
              borderTop: i === 0 ? undefined : `1px solid ${colors.line}`,
            }}
          >
            <div style={{ flexBasis: 190, flexShrink: 0, fontSize: 14, fontWeight: 600 }}>{r.check}</div>
            <div style={{ flexShrink: 0 }}>
              <StatusChip state={r.state}>{r.label}</StatusChip>
            </div>
            <div style={{ flexGrow: 1, flexBasis: 280, minWidth: 0, fontSize: 12.5, lineHeight: 1.55, color: colors.ink3 }}>
              {r.note ?? ''}
            </div>
          </div>
        ))}
      </div>
      <SourceNote productId={product.id} what="Every register above" />
    </Collapsible>
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
      title="every ingredient"
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


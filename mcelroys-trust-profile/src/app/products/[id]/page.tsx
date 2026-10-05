import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { colors, font, isoDate, layout, status } from '@/lib/design'
import { describeCategory } from '@/lib/categoryDisplay'
import { flaggedSignal, ingredientCount, nonGmoSignal, organicSignal, ownerSignal, recallSignal, type ProductForSignals, type Signal } from '@/lib/productSignals'
import { productDisplayName } from '@/lib/productName'
import { evidenceNote, getProductRecalls, getRecallsListingProducts, type RecallItem } from '@/lib/recalls'
import { ProductThumb } from '@/components/ProductThumb'
import { AisleBar, Breadcrumb, SignalTile, SiteFooter, TopNav } from '@/components/SiteChrome'
import { SignalStrip, StatusChip, StatusLegend } from '@/components/StatusChip'

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

  const cat = describeCategory(product.category, product.categorySource)
  const isUnvetted = product.company.vettingStatus !== 'vetted'

  // Ingredients in the order they appear on the label. Label order is itself
  // information — it is roughly descending by weight — so a product whose
  // positions were never recorded says so rather than showing a list in
  // whatever order the database returned.
  const hasOrder = product.productIngredients.every((pi) => pi.listPosition !== null)
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
        {/* `credit` on: this is the one place a product's photograph is
            shown large, so the CC-BY-SA attribution goes directly under it
            and links to the source record. */}
        <ProductThumb
          product={product}
          category={product.category}
          productType={product.productType}
          size={92}
          label={title}
          credit
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
            {title}
          </h1>

          {product.upc && (
            <div style={{ fontFamily: font.mono, fontSize: 13, color: colors.ink4, marginTop: 6 }}>
              {product.upc}
            </div>
          )}

          {/* Open Food Facts' licence asks for a link to the product's own
              record wherever its data for that product is shown. */}
          {product.upc && isFromOpenFoodFacts(product) && (
            <div style={{ fontSize: 12.5, color: colors.ink3, marginTop: 4 }}>
              Product data from{' '}
              <a
                href={`https://world.openfoodfacts.org/product/${product.upc}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                this product&apos;s Open Food Facts record
              </a>{' '}
              (ODbL)
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <SignalStrip signals={[flagged, recall, organic, nonGmo, owner]} />
          </div>

          <div style={{ marginTop: 13 }}>
            <StatusLegend />
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
      <div
        style={{
          boxSizing: 'border-box',
          padding: `22px ${layout.gutter}px 0`,
          display: 'flex',
          gap: 12,
        }}
      >
        <SignalTile
          label="Flagged ingredients"
          value={flagged.state === 'openResearch' ? flagged.label.replace(' flagged', '') : flagged.label}
          note={flagged.detail}
          accent={status[flagged.state].fg}
          href={flagged.state === 'openResearch' ? '#flagged' : undefined}
          mono={flagged.state === 'openResearch'}
        />
        <SignalTile
          label="Recalls"
          value={recall.label}
          note={recall.detail}
          accent={status[recall.state].fg}
          href="#recalls"
        />
        <SignalTile
          label="Verified"
          value={organic.state === 'confirmed' || nonGmo.state === 'confirmed' ? 'Yes' : organic.label}
          note={[organic.label, nonGmo.label].join(' · ')}
          accent={status[organic.state].fg}
          href="#certificates"
        />
        <SignalTile
          label="Who owns it"
          value={owner.label}
          note={owner.detail}
          accent={status.ownership.fg}
          href={owner.href}
        />
        <SignalTile
          label="Ingredients"
          value={count === null ? '—' : count}
          note={
            count === null
              ? flagged.detail
              : `${hasOrder ? 'In label order' : 'Label order was not recorded for this product'}${product.ingredientSource ? ` · from ${product.ingredientSource}` : ''}`
          }
          mono={count !== null}
        />
      </div>

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
        <Flagged ingredients={ingredients} signal={flagged} />
        <Recalls recalls={recalls} product={product} />
        <Certificates product={product} organic={organic} nonGmo={nonGmo} />
        <Ingredients ingredients={ingredients} product={product} hasOrder={hasOrder} signal={flagged} />
      </div>

      <SiteFooter />
    </>
  )
}

// ------------------------------------------------------------------ pieces

function SectionHead({ title, source, id }: { title: string; source?: string; id?: string }) {
  return (
    <div
      id={id}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 16,
        borderBottom: `2px solid ${colors.ink}`,
        paddingBottom: 9,
        // So an anchor link doesn't tuck the heading under the top of the
        // viewport.
        scrollMarginTop: 16,
      }}
    >
      <h2 style={{ margin: 0, fontFamily: font.display, fontSize: 22, fontWeight: 600 }}>{title}</h2>
      {source && <span style={{ fontSize: 12, color: colors.ink3 }}>{source}</span>}
    </div>
  )
}

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

// Every fact on this page carries where it came from and when we read it.
// This is the component that prints that, so the rule is enforced in one
// place rather than remembered in twenty.
function SourceLine({
  url,
  label,
  readAt,
  reviewedAt,
}: {
  url?: string | null
  label: string
  readAt?: Date | string | null
  reviewedAt?: Date | string | null
}) {
  const read = isoDate(readAt)
  const reviewed = isoDate(reviewedAt)
  return (
    <div style={{ fontSize: 11.5, color: colors.ink4, marginTop: 7, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      ) : (
        <span>{label}</span>
      )}
      {read && <span style={{ fontFamily: font.mono }}>read {read}</span>}
      {/* Whether a person has checked this line against the original
          document. The absence of a reviewer is itself worth showing — it is
          the difference between a record and a draft. */}
      <span>{reviewed ? `checked by a person ${reviewed}` : 'not yet checked by a person'}</span>
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

function Flagged({ ingredients, signal }: { ingredients: IngredientRows; signal: Signal }) {
  const flagged = ingredients.filter((pi) => pi.ingredient.flaggedForResearch)

  return (
    <section>
      <SectionHead id="flagged" title="Ingredients with open research" source="Peer-reviewed literature and regulator findings" />
      <div style={{ marginTop: 14 }}>
        {flagged.length === 0 ? (
          <Callout state={signal.state}>{signal.detail}</Callout>
        ) : (
          <>
            <p style={{ margin: '0 0 12px', fontSize: 13.5, lineHeight: 1.6, color: colors.ink2, maxWidth: 760 }}>
              These ingredients have studies that disagree with each other, or research that is
              still open. Open one to read the studies, what each one found, and who paid for it.
              An ingredient appearing here is not a finding that it is harmful.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {flagged.map((pi) => (
                <Link
                  key={pi.ingredient.id}
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
                    {pi.ingredient._count.studies === 1
                      ? '1 study'
                      : `${pi.ingredient._count.studies} studies`}
                  </StatusChip>
                  <span style={{ fontSize: 20, color: colors.link }} aria-hidden>
                    &rsaquo;
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
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
  product: { company: { legalName: string } }
}) {
  if (!recalls) return null
  const { thisProduct, brand, process } = recalls

  return (
    <section>
      <SectionHead id="recalls" title="Recalls and government notices" source="FDA, FSIS, CPSC and CBP records" />
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Group
          heading="Notices that list this product"
          empty="No government notice we hold lists this product."
          items={thisProduct.items}
          count={thisProduct.count}
          state="recall"
        />
        <Group
          heading={`Notices naming ${product.company.legalName}, without naming this product`}
          empty={`No notice names ${product.company.legalName} without naming a product.`}
          items={brand.items}
          count={brand.count}
          state="nothingOnFile"
        />
        {process.count > 0 && (
          <Group
            heading="Notices about how food was made or handled"
            empty=""
            items={process.items}
            count={process.count}
            state="unchecked"
            preamble="These name no product, so we cannot tell you whether this one was affected. They are here because they concern the company or its parent."
          />
        )}
      </div>
    </section>
  )
}

function Group({
  heading,
  empty,
  items,
  count,
  state,
  preamble,
}: {
  heading: string
  empty: string
  items: RecallItem[]
  count: number
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
        <span style={{ fontFamily: font.mono, fontWeight: 500, color: colors.ink4 }}>{count}</span>
        <span style={{ flexGrow: 1, height: 1, background: colors.line }} />
      </div>

      {preamble && (
        <p style={{ margin: '9px 0 0', fontSize: 12.5, lineHeight: 1.6, color: colors.ink3, maxWidth: 760 }}>
          {preamble}
        </p>
      )}

      {items.length === 0 ? (
        <p style={{ margin: '9px 0 0', fontSize: 13, color: colors.ink3 }}>{empty}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          {items.map((item) => {
            const note = evidenceNote(item)
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
                  {item.referenceNumber && (
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: colors.ink4 }}>
                      {item.referenceNumber}
                    </span>
                  )}
                  {item.actionDate && (
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: colors.ink4 }}>
                      {isoDate(item.actionDate)}
                    </span>
                  )}
                  {item.status && (
                    <span style={{ fontSize: 12, color: colors.ink3 }}>{item.status}</span>
                  )}
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

                <SourceLine url={item.sourceUrl} label={`${item.sourceAgency} record`} reviewedAt={null} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Certificates({
  product,
  organic,
  nonGmo,
}: {
  product: {
    certifications: {
      id: string
      certifyingAgency: string
      certificateNumber: string
      certificationStatus: string
      certifiedScopes: string[]
      lastVerifiedDate: Date | null
      sourceUrl: string
      reviewDate: Date | null
    }[]
    productCertifications: {
      id: string
      scheme: string
      certifyingBody: string | null
      certificateNumber: string | null
      status: string
      scopeNote: string | null
      lastVerifiedDate: Date | null
      sourceUrl: string
      reviewDate: Date | null
    }[]
  }
  organic: Signal
  nonGmo: Signal
}) {
  const nothing = product.certifications.length === 0 && product.productCertifications.length === 0

  return (
    <section>
      <SectionHead id="certificates" title="Verified" source="USDA Organic Integrity Database and the schemes' own registers" />
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {nothing ? (
          <>
            <Callout state={organic.state}>{organic.detail}</Callout>
            {nonGmo.state !== organic.state && <Callout state={nonGmo.state}>{nonGmo.detail}</Callout>}
          </>
        ) : (
          <>
            {product.certifications.map((c) => (
              <div key={c.id} style={cardStyle(c.certificationStatus === 'Certified' ? 'confirmed' : 'nothingOnFile')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <StatusChip state={c.certificationStatus === 'Certified' ? 'confirmed' : 'nothingOnFile'}>
                    USDA Organic
                  </StatusChip>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{c.certificationStatus}</span>
                  <span style={{ fontFamily: font.mono, fontSize: 12, color: colors.ink4 }}>
                    {c.certificateNumber}
                  </span>
                </div>
                <p style={{ margin: '9px 0 0', fontSize: 13.5, lineHeight: 1.6, color: colors.ink2 }}>
                  Certified by {c.certifyingAgency}.
                  {/* Scope is the whole point of an organic certificate: it
                      covers specific products, not a company. */}
                  {c.certifiedScopes.length > 0 && ` Scope on file: ${c.certifiedScopes.join(', ')}.`}
                </p>
                <SourceLine
                  url={c.sourceUrl}
                  label="USDA Organic Integrity Database"
                  readAt={c.lastVerifiedDate}
                  reviewedAt={c.reviewDate}
                />
              </div>
            ))}

            {product.productCertifications.map((c) => (
              <div key={c.id} style={cardStyle(c.status === 'verified' ? 'confirmed' : 'nothingOnFile')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <StatusChip state={c.status === 'verified' ? 'confirmed' : 'nothingOnFile'}>
                    {c.scheme}
                  </StatusChip>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{c.status}</span>
                  {c.certificateNumber && (
                    <span style={{ fontFamily: font.mono, fontSize: 12, color: colors.ink4 }}>
                      {c.certificateNumber}
                    </span>
                  )}
                </div>
                {c.certifyingBody && (
                  <p style={{ margin: '9px 0 0', fontSize: 13.5, lineHeight: 1.6, color: colors.ink2 }}>
                    Evaluated by {c.certifyingBody}.
                  </p>
                )}
                {/* The documented limits of the scheme. The schema comment on
                    scopeNote explains why this matters: a mark can signal far
                    less than a shopper assumes, and the gap is where people
                    are most often misled. */}
                {c.scopeNote && (
                  <div
                    style={{
                      marginTop: 10,
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      background: colors.panel,
                      borderRadius: 6,
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      color: colors.ink2,
                    }}
                  >
                    <strong style={{ color: colors.ink }}>What this mark covers: </strong>
                    {c.scopeNote}
                  </div>
                )}
                <SourceLine
                  url={c.sourceUrl}
                  label={`${c.scheme} register`}
                  readAt={c.lastVerifiedDate}
                  reviewedAt={c.reviewDate}
                />
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  )
}

function Ingredients({
  ingredients,
  product,
  hasOrder,
  signal,
}: {
  ingredients: IngredientRows
  product: { ingredientSource: string | null; ingredientSourceUrl: string | null; ingredientCheckedAt: Date | null; ingredientDisclosureStatus: string }
  hasOrder: boolean
  signal: Signal
}) {
  return (
    <section>
      <SectionHead
        id="ingredients"
        title="Every ingredient"
        source={hasOrder ? 'In label order' : 'Label order not recorded'}
      />
      <div style={{ marginTop: 14 }}>
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
            <SourceLine
              url={product.ingredientSourceUrl}
              label={product.ingredientSource ? `Ingredient list from ${product.ingredientSource}` : 'Ingredient list'}
              readAt={product.ingredientCheckedAt}
              reviewedAt={null}
            />
          </>
        )}
      </div>
    </section>
  )
}

function cardStyle(state: keyof typeof status): React.CSSProperties {
  return {
    boxSizing: 'border-box',
    padding: '14px 16px',
    background: colors.card,
    border: `1px solid ${colors.line}`,
    borderLeft: `4px solid ${status[state].fg}`,
    borderRadius: layout.radius,
  }
}

// True when any of this product's data came from Open Food Facts: the bulk
// import, or an ingredient list read from it.
function isFromOpenFoodFacts(product: { importSource: string | null; ingredientSource: string | null }): boolean {
  return product.importSource === 'open_food_facts_bulk' || /open[_ ]food[_ ]facts/i.test(product.ingredientSource ?? '')
}

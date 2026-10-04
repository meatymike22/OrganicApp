import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { colors, font, isoDate, layout, status } from '@/lib/design'
import { describeCategory } from '@/lib/categoryDisplay'
import {
  companyAndParents,
  evidenceNote,
  getCompanyRecalls,
  getRecallsListingProducts,
  getUnlinkedProcessRecalls,
  type RecallItem,
  type RecallList,
} from '@/lib/recalls'
import { displayName } from '@/lib/productName'
import { CategoryGlyph } from '@/components/CategoryGlyph'
import { AisleBar, Breadcrumb, SignalTile, SiteFooter, TopNav } from '@/components/SiteChrome'
import { StatusChip } from '@/components/StatusChip'
import { Callout, Eyebrow, Monogram, SectionHead, SourceLine } from '@/components/PageParts'

// ONE COMPANY: who it is, who owns it, the brands it owns, the products we
// list under it, and the government notices that name it.
//
// Layout follows the "Company profile" screen in the Rootify design canvas:
// header with an ownership panel, a signal row, then a main column (brands,
// notices, products) and a sidebar (investor filings, sourcing).
//
// The data rules are unchanged from the earlier version of this page:
//  - an unverified company gets no recalls/filings matched to it, and says so;
//  - a recall is always shown with the product it described;
//  - recalls issued by another firm that name this brand are listed apart,
//    with the reason they are here (evidenceNote in src/lib/recalls.ts).

// How many recalls each list shows before "Show all". Some firms have
// hundreds of notices (one product line per notice); ?recalls=all lists them all.
const RECALLS_SHOWN = 20

// How many products are listed by name. Store brands and big makers have
// thousands; the rest are a search away.
const PRODUCTS_SHOWN = 24

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const company = await prisma.company.findUnique({ where: { id }, select: { legalName: true } })
  return { title: company?.legalName ?? 'Company not found' }
}

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // In Next.js 15+ the dynamic part of the URL arrives as a Promise.
  const { id } = await params
  const showAllRecalls = (await searchParams).recalls === 'all'

  const company = await prisma.company.findUnique({
    where: { id },
    select: {
      id: true,
      legalName: true,
      dbaNames: true,
      hqLocation: true,
      vettingStatus: true,
      businessRole: true,
      ownershipNote: true,
      parentCompany: { select: { id: true, legalName: true } },
      subsidiaries: {
        select: { id: true, legalName: true, _count: { select: { products: true } } },
        orderBy: { legalName: 'asc' },
      },
      investorFilings: true,
      supplyChainDisclosures: true,
    },
  })

  // "rejected" means a reviewer decided this isn't a usable company (junk
  // brand text, a duplicate). The row is kept only so bulk ingestion doesn't
  // recreate it, so it's treated the same as not existing.
  if (!company || company.vettingStatus === 'rejected') notFound()

  const isUnvetted = company.vettingStatus !== 'vetted'

  // Products: counted in full, listed up to PRODUCTS_SHOWN by name.
  const [productCount, organicCount, products] = await Promise.all([
    prisma.product.count({ where: { companyId: company.id } }),
    prisma.product.count({
      where: { companyId: company.id, certifications: { some: { certificationStatus: 'Certified' } } },
    }),
    prisma.product.findMany({
      where: { companyId: company.id },
      select: {
        id: true,
        name: true,
        category: true,
        categorySource: true,
        productType: true,
        certifications: { select: { certificationStatus: true } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: PRODUCTS_SHOWN,
    }),
  ])

  // Recalls: loaded only for verified companies, as the unverified notice
  // says. See src/lib/recalls.ts for how they are matched and linked.
  const recalls = isUnvetted ? null : await getCompanyRecalls(company.id, showAllRecalls ? undefined : RECALLS_SHOWN)
  // Which of the listed products a notice names by barcode.
  const listedProducts = isUnvetted
    ? new Map<string, RecallItem[]>()
    : await getRecallsListingProducts(products.map((p) => p.id))
  // Recalls by this company or its parents about how food was made or
  // handled that name no product, so we can't say whether these products
  // were affected. Shown once as a note, never as a recall of any of them.
  const family = isUnvetted ? [] : await companyAndParents(company.id)
  const processHint = isUnvetted ? null : await getUnlinkedProcessRecalls(family.map((c) => c.id))

  const recallTotal = (recalls?.issued.count ?? 0) + (recalls?.naming.count ?? 0)
  const brandsTotal = company.subsidiaries.length

  return (
    <>
      <TopNav />
      <AisleBar />
      <Breadcrumb
        trail={[
          { label: 'Rootify', href: '/' },
          { label: 'Companies', href: '/companies' },
          { label: company.legalName },
        ]}
      />

      {/* HEADER */}
      <div
        style={{
          boxSizing: 'border-box',
          padding: `30px ${layout.gutter}px 0`,
          display: 'flex',
          gap: 32,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <Monogram name={company.legalName} />

        <div style={{ flexGrow: 1, flexBasis: 420, minWidth: 0 }}>
          <Eyebrow color={status.ownership.fg}>
            {company.businessRole === 'retailer'
              ? 'Retailer'
              : company.businessRole === 'supply_chain'
                ? 'Supply-chain company'
                : 'Company profile'}
          </Eyebrow>
          <h1
            style={{
              margin: '8px 0 0',
              fontFamily: font.display,
              fontSize: 36,
              lineHeight: 1.1,
              fontWeight: 600,
              letterSpacing: '-0.015em',
            }}
          >
            {company.legalName}
          </h1>

          <MetaLine company={company} />

          {/* Said once, at the top, not repeated beside each empty section. */}
          {isUnvetted && (
            <div style={{ marginTop: 14, maxWidth: 760 }}>
              <Callout state="unchecked">
                <strong>Not yet verified.</strong> This brand and its products come from Open Food
                Facts and haven&apos;t been verified yet. Recalls, ownership and certifications appear
                once it&apos;s verified.
              </Callout>
            </div>
          )}
          {company.businessRole === 'supply_chain' && (
            <div style={{ marginTop: 14, maxWidth: 760 }}>
              <Callout state="nothingOnFile">
                <strong>Supply-chain company.</strong> {company.legalName} mainly makes, packs,
                imports or distributes food sold under other companies&apos; brands. Its recalls often
                concern those brands&apos; products.
              </Callout>
            </div>
          )}
          {company.businessRole === 'retailer' && (
            <div style={{ marginTop: 14, maxWidth: 760 }}>
              <Callout state="nothingOnFile">
                <strong>Retailer.</strong> {company.legalName} sells food to consumers. Its recalls
                usually concern its store-brand products or items it sold.
              </Callout>
            </div>
          )}
        </div>

        {/* Who owns it. Only drawn when a parent is on record: no parent in
            our records is not the same as "independently owned". */}
        {company.parentCompany && (
          <div
            style={{
              width: 280,
              flexShrink: 0,
              boxSizing: 'border-box',
              padding: '15px 17px',
              background: '#F5EFF6',
              border: `1px solid ${status.ownership.border}`,
              borderRadius: layout.radius,
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: status.ownership.fg,
              }}
            >
              Who owns it
            </div>
            <Link
              href={`/companies/${company.parentCompany.id}`}
              style={{
                display: 'block',
                fontFamily: font.display,
                fontSize: 22,
                fontWeight: 600,
                marginTop: 8,
                color: colors.ink,
              }}
            >
              {company.parentCompany.legalName}
            </Link>
            {company.ownershipNote && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: colors.ink2, marginTop: 7 }}>
                {company.ownershipNote}
              </div>
            )}
          </div>
        )}
      </div>

      {/* SIGNAL ROW */}
      <div
        style={{
          boxSizing: 'border-box',
          padding: `24px ${layout.gutter}px 0`,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <SignalTile
          label="Products we list"
          value={productCount.toLocaleString()}
          note={productCount === 0 ? 'None in our database yet' : 'Under this company in our database'}
          href={productCount > 0 ? '#products' : undefined}
          mono
        />
        <SignalTile
          label="Recalls & notices"
          value={recalls ? recallTotal.toLocaleString() : '—'}
          note={
            !recalls
              ? 'Not checked until the company is verified'
              : recallTotal === 0
                ? 'None on record from FDA, FSIS or CPSC'
                : 'Each shown with the product it covered'
          }
          accent={recalls && recallTotal > 0 ? status.recall.fg : undefined}
          href={recalls ? '#recalls' : undefined}
          mono={!!recalls}
        />
        <SignalTile
          label="Brands it owns"
          value={brandsTotal.toLocaleString()}
          note={brandsTotal === 0 ? 'None on record' : 'Each has its own page'}
          accent={brandsTotal > 0 ? status.ownership.fg : undefined}
          href={brandsTotal > 0 ? '#brands' : undefined}
          mono
        />
        <SignalTile
          label="Organic certified"
          value={organicCount.toLocaleString()}
          note={organicCount === 0 ? 'No current USDA organic certificate on file' : 'Products with a current USDA certificate'}
          accent={organicCount > 0 ? status.confirmed.fg : undefined}
          mono
        />
      </div>

      {/* BODY: main column and sidebar */}
      <div
        style={{
          flexGrow: 1,
          boxSizing: 'border-box',
          padding: `32px ${layout.gutter}px 0`,
          display: 'flex',
          gap: 32,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flexGrow: 1, flexBasis: 560, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 34 }}>
          {brandsTotal > 0 && <Brands company={company} />}
          {recalls && (
            <Recalls
              companyId={company.id}
              companyName={company.legalName}
              issued={recalls.issued}
              naming={recalls.naming}
              showAll={showAllRecalls}
              processHint={processHint}
              family={family}
            />
          )}
          <Products
            companyName={company.legalName}
            products={products}
            total={productCount}
            listed={listedProducts}
          />
        </div>

        <Sidebar company={company} />
      </div>

      <SiteFooter />
    </>
  )
}

// ------------------------------------------------------------------ header

function MetaLine({
  company,
}: {
  company: { dbaNames: string[]; hqLocation: string | null; investorFilings: { ticker: string | null }[] }
}) {
  const ticker = company.investorFilings.find((f) => f.ticker)?.ticker
  const parts: React.ReactNode[] = []
  if (company.dbaNames.length > 0) {
    parts.push(
      <span key="dba">
        Also sold as{' '}
        <strong style={{ color: colors.ink, fontWeight: 600 }}>{company.dbaNames.join(', ')}</strong>
      </span>
    )
  }
  if (ticker) {
    parts.push(
      <span key="ticker">
        Ticker <span style={{ fontFamily: font.mono, color: colors.ink }}>{ticker}</span>
      </span>
    )
  }
  if (company.hqLocation) parts.push(<span key="hq">{company.hqLocation}</span>)
  if (parts.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 11, fontSize: 13, color: colors.ink2 }}>
      {parts.map((p, i) => (
        <span key={i} style={{ display: 'inline-flex', gap: 18 }}>
          {i > 0 && (
            <span aria-hidden style={{ color: '#C9C2B2' }}>
              |
            </span>
          )}
          {p}
        </span>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ main column

function Brands({
  company,
}: {
  company: { legalName: string; subsidiaries: { id: string; legalName: string; _count: { products: number } }[] }
}) {
  return (
    <section>
      <SectionHead id="brands" title="Brands this company owns" source="From our ownership records" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 10,
          marginTop: 16,
        }}
      >
        {company.subsidiaries.map((b) => (
          <Link
            key={b.id}
            href={`/companies/${b.id}`}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              boxSizing: 'border-box',
              padding: '12px 14px',
              background: colors.card,
              border: `1px solid ${colors.line}`,
              borderRadius: 8,
              textDecoration: 'none',
              color: 'inherit',
              minWidth: 0,
            }}
          >
            <Monogram name={b.legalName} size={34} />
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: font.display,
                  fontSize: 15.5,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {b.legalName}
              </div>
              <div style={{ fontSize: 12, color: colors.ink2, marginTop: 3 }}>
                {b._count.products === 0 ? (
                  'No products listed yet'
                ) : (
                  <>
                    <span style={{ fontFamily: font.mono, fontWeight: 500, color: colors.ink }}>
                      {b._count.products.toLocaleString()}
                    </span>{' '}
                    {b._count.products === 1 ? 'product' : 'products'}
                  </>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function Products({
  companyName,
  products,
  total,
  listed,
}: {
  companyName: string
  products: {
    id: string
    name: string
    category: string | null
    categorySource: string | null
    productType: string
    certifications: { certificationStatus: string }[]
  }[]
  total: number
  listed: Map<string, RecallItem[]>
}) {
  return (
    <section>
      <SectionHead
        id="products"
        title="Products we list"
        source={total > products.length ? `${products.length} of ${total.toLocaleString()} shown, A–Z` : undefined}
      />
      <div style={{ marginTop: 16 }}>
        {total === 0 ? (
          <Callout state="nothingOnFile">No products under this company in our database yet.</Callout>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 9,
              }}
            >
              {products.map((p) => {
                const cat = describeCategory(p.category, p.categorySource)
                const inRecall = (listed.get(p.id)?.length ?? 0) > 0
                const organic = p.certifications.some((c) => c.certificationStatus === 'Certified')
                return (
                  <Link
                    key={p.id}
                    href={`/products/${p.id}`}
                    style={{
                      display: 'flex',
                      gap: 11,
                      alignItems: 'center',
                      boxSizing: 'border-box',
                      padding: '10px 13px',
                      background: colors.card,
                      border: `1px solid ${colors.line}`,
                      borderLeft: inRecall ? `4px solid ${status.recall.fg}` : `1px solid ${colors.line}`,
                      borderRadius: layout.radius,
                      textDecoration: 'none',
                      color: 'inherit',
                      minWidth: 0,
                    }}
                  >
                    <CategoryGlyph category={p.category} productType={p.productType} size={40} label={displayName(p.name)} />
                    <div style={{ flexGrow: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: font.display,
                          fontSize: 15,
                          fontWeight: 600,
                          lineHeight: 1.25,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {displayName(p.name)}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                        {cat.label && (
                          <span
                            title={cat.note ?? undefined}
                            style={{
                              fontSize: 9.5,
                              fontWeight: 700,
                              letterSpacing: '0.06em',
                              textTransform: 'uppercase',
                              color: colors.ink3,
                            }}
                          >
                            {cat.label}
                          </span>
                        )}
                        {inRecall && <StatusChip state="recall">In a recall notice</StatusChip>}
                        {organic && <StatusChip state="confirmed">Organic</StatusChip>}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
            {total > products.length && (
              <div style={{ marginTop: 12, fontSize: 13.5 }}>
                <Link href={`/search?q=${encodeURIComponent(companyName)}`}>
                  Search all {total.toLocaleString()} products from {companyName} &rarr;
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function Recalls({
  companyId,
  companyName,
  issued,
  naming,
  showAll,
  processHint,
  family,
}: {
  companyId: string
  companyName: string
  issued: RecallList
  naming: RecallList
  showAll: boolean
  processHint: RecallList | null
  family: { id: string; legalName: string }[]
}) {
  const processFirms = processHint ? [...new Set(processHint.items.map((a) => a.company.id))] : []
  return (
    <section>
      <SectionHead id="recalls" title="Recalls & notices" source="FDA, FSIS and CPSC records" />
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {issued.count === 0 && naming.count === 0 && (
          <Callout state="nothingOnFile">No FDA, FSIS or CPSC notice we hold names {companyName}.</Callout>
        )}

        {/* About how food was made or handled, naming no product. */}
        {processHint && processHint.count > 0 && (
          <Callout state="unchecked">
            <strong>Manufacturing-related recalls.</strong>{' '}
            {processFirms
              .map((cid) => family.find((c) => c.id === cid)?.legalName)
              .filter(Boolean)
              .join(' and ')}{' '}
            {processHint.count === 1 ? 'has had 1 recall' : `has had ${processHint.count} recalls`} about how food
            was made or handled (for example contamination, unsanitary conditions or foreign material) that{' '}
            {processHint.count === 1 ? "doesn't" : "don't"} name a specific product. There is no evidence linking{' '}
            {processHint.count === 1 ? 'it' : 'them'} to the products on this page, and we can&apos;t say whether
            they were affected.{' '}
            {processFirms.map((cid, i) => (
              <span key={cid}>
                {i > 0 && ' · '}
                <Link href={`/companies/${cid}?recalls=all#recalls`}>
                  See {family.find((c) => c.id === cid)?.legalName}&apos;s recalls
                </Link>
              </span>
            ))}
          </Callout>
        )}

        {issued.count > 0 && (
          <RecallGroup
            heading={`Notices naming ${companyName}`}
            preamble="Each notice covers the product described in it, not every product on this page."
            list={issued}
            companyId={companyId}
            showAll={showAll}
          />
        )}

        {/* Issued under another firm's name (a parent, or a manufacturer
            making the product for this brand) and tied to this brand. */}
        {naming.count > 0 && (
          <RecallGroup
            heading="Notices about this brand, issued by other companies"
            list={naming}
            companyId={companyId}
            showAll={showAll}
          />
        )}
      </div>
    </section>
  )
}

// One list of notices, newest first, with a "Show all" link when capped.
// Every notice MUST show productDescription: a notice covers the product it
// describes, which is often only one of a company's products.
function RecallGroup({
  heading,
  preamble,
  list,
  companyId,
  showAll,
}: {
  heading: string
  preamble?: string
  list: RecallList
  companyId: string
  showAll: boolean
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
        <span style={{ fontFamily: font.mono, fontWeight: 500, color: colors.ink4 }}>{list.count}</span>
        <span style={{ flexGrow: 1, height: 1, background: colors.line }} />
      </div>
      {preamble && (
        <p style={{ margin: '9px 0 0', fontSize: 12.5, lineHeight: 1.6, color: colors.ink3, maxWidth: 760 }}>
          {preamble}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 11 }}>
        {list.items.map((action) => (
          <RecallCard key={action.id} action={action} companyId={companyId} />
        ))}
      </div>
      {!showAll && list.count > list.items.length && (
        <p style={{ margin: '11px 0 0', fontSize: 13 }}>
          <span style={{ color: colors.ink3 }}>
            Showing the {list.items.length} most recent of {list.count.toLocaleString()}.{' '}
          </span>
          <Link href={`/companies/${companyId}?recalls=all#recalls`}>Show all</Link>
        </p>
      )}
    </div>
  )
}

function RecallCard({ action, companyId }: { action: RecallItem; companyId: string }) {
  const issuedElsewhere = action.company.id !== companyId
  const note = issuedElsewhere ? evidenceNote(action) : null
  const kind = `${action.sourceAgency} ${action.actionType.replace(/_/g, ' ')}`
  return (
    <div
      id={`recall-${action.id}`}
      style={{
        boxSizing: 'border-box',
        padding: '15px 18px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderLeft: `3px solid ${status.recall.fg}`,
        borderRadius: 8,
        display: 'flex',
        gap: 18,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flexGrow: 1, flexBasis: 360, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <StatusChip state="recall">
            {kind}
            {action.classification ? ` · ${action.classification}` : ''}
          </StatusChip>
          {action.actionDate && (
            <span style={{ fontFamily: font.mono, fontSize: 12, color: colors.ink3 }}>{isoDate(action.actionDate)}</span>
          )}
          {action.status && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 7px',
                borderRadius: 4,
                background: '#F1EEE6',
                color: colors.ink2,
              }}
            >
              {action.status}
            </span>
          )}
          {action.referenceNumber && (
            <span style={{ fontFamily: font.mono, fontSize: 12, color: colors.ink4 }}>{action.referenceNumber}</span>
          )}
        </div>

        <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.45, marginTop: 8 }}>{action.reason}</div>

        {issuedElsewhere && (
          <div style={{ fontSize: 12.5, color: colors.ink2, marginTop: 5 }}>
            Issued by <Link href={`/companies/${action.company.id}`}>{action.company.legalName}</Link>
          </div>
        )}

        {action.productRelevance === 'supply_chain' && (
          <div style={{ fontSize: 12.5, color: colors.ink2, marginTop: 5 }}>
            Relates to a facility or supplier in the supply chain, not to a product itself.
          </div>
        )}

        <SourceLine url={action.sourceUrl} label={`${action.sourceAgency} record`} showReview={false} />
      </div>

      {/* What the notice actually covered, in its own words. This is the box
          that stops a 2018 notice about one product line reading as a recall
          of everything the company makes. */}
      {(action.productDescription || note) && (
        <div
          style={{
            width: 260,
            flexGrow: 1,
            maxWidth: 360,
            boxSizing: 'border-box',
            padding: '10px 12px',
            background: '#F7F5EF',
            border: '1px dashed #C9C2B2',
            borderRadius: 6,
          }}
        >
          {action.productDescription && (
            <>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: colors.ink2,
                }}
              >
                What it covered
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: '#3F4A42', marginTop: 5 }}>
                {action.productDescription}
              </div>
            </>
          )}
          {note && (
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.5,
                color: colors.ink3,
                marginTop: action.productDescription ? 8 : 0,
                paddingTop: action.productDescription ? 8 : 0,
                borderTop: action.productDescription ? '1px dashed #E0DACB' : undefined,
              }}
            >
              {note}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ sidebar

type Filing = {
  id: string
  ticker: string | null
  publicStatus: string
  filingDate: Date | null
  parentCompany: string | null
  majorShareholders: unknown
  sourceUrl: string
  dataPulledDate: Date
  reviewDate: Date | null
}

type Disclosure = {
  id: string
  disclosureStatus: string
  disclosureType: string | null
  verificationBasis: string
  notes: string | null
  sourceUrl: string
  dataPulledDate: Date
  reviewDate: Date | null
}

const PUBLIC_STATUS: Record<string, string> = {
  public: 'Publicly traded',
  delisted: 'Delisted',
  private: 'Privately held',
  acquired: 'Acquired',
}

const DISCLOSURE_STATUS: Record<string, string> = {
  full_disclosure: 'Publishes where it sources',
  partial_disclosure: 'Publishes some sourcing information',
  not_disclosed: 'No sourcing information found',
}

function Sidebar({ company }: { company: { investorFilings: Filing[]; supplyChainDisclosures: Disclosure[] } }) {
  const filings = company.investorFilings
  const disclosures = company.supplyChainDisclosures
  if (filings.length === 0 && disclosures.length === 0) return null
  return (
    <aside style={{ width: 350, flexGrow: 0, flexShrink: 0, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 17 }}>
      {filings.length > 0 && (
        <div style={sideBox}>
          <Eyebrow color={status.ownership.fg}>Investor filings</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
            {filings.map((f) => {
              const holders = shareholders(f.majorShareholders)
              return (
                <div key={f.id}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {PUBLIC_STATUS[f.publicStatus] ?? f.publicStatus}
                    {f.ticker && (
                      <span style={{ fontFamily: font.mono, fontWeight: 500, color: colors.ink3 }}> · {f.ticker}</span>
                    )}
                  </div>
                  {f.parentCompany && (
                    <div style={{ fontSize: 12.5, lineHeight: 1.5, color: colors.ink2, marginTop: 3 }}>
                      Parent company named in the filing: {f.parentCompany}
                    </div>
                  )}
                  {holders.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 9 }}>
                      {holders.map((h) => (
                        <div key={h.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
                          <span>{h.name}</span>
                          {h.percent !== null && (
                            <span style={{ fontFamily: font.mono, color: colors.ink3 }}>{h.percent}%</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <SourceLine
                    url={f.sourceUrl}
                    label={f.filingDate ? `SEC filing of ${isoDate(f.filingDate)}` : 'SEC filing'}
                    readAt={f.dataPulledDate}
                    reviewedAt={f.reviewDate}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {disclosures.length > 0 && (
        <div style={sideBox}>
          <Eyebrow color={status.unchecked.fg}>What it says about sourcing</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 12 }}>
            {disclosures.map((d, i) => (
              <div key={d.id} style={i > 0 ? { borderTop: '1px dashed #E0DACB', paddingTop: 10 } : undefined}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {DISCLOSURE_STATUS[d.disclosureStatus] ?? d.disclosureStatus}
                </div>
                {d.disclosureType && (
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: colors.ink2, marginTop: 3 }}>{d.disclosureType}</div>
                )}
                {d.notes && (
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: colors.ink2, marginTop: 5 }}>{d.notes}</div>
                )}
                <div style={{ fontSize: 11.5, color: colors.ink3, marginTop: 5 }}>
                  {d.verificationBasis === 'independently_verified'
                    ? 'Independently verified'
                    : 'As published by the company, not independently verified'}
                </div>
                <SourceLine url={d.sourceUrl} label="Source" readAt={d.dataPulledDate} reviewedAt={d.reviewDate} />
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}

const sideBox: React.CSSProperties = {
  boxSizing: 'border-box',
  padding: '17px 18px',
  background: colors.card,
  border: `1px solid ${colors.line}`,
  borderRadius: layout.radius,
}

// majorShareholders is stored as JSON, e.g. [{"name": "...", "percent": 100}].
// Anything that doesn't have that shape is skipped rather than guessed at.
function shareholders(raw: unknown): { name: string; percent: number | null }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (r): r is { name: string; percent?: unknown } =>
        typeof r === 'object' && r !== null && typeof (r as { name?: unknown }).name === 'string'
    )
    .map((r) => ({ name: r.name, percent: typeof r.percent === 'number' ? r.percent : null }))
}

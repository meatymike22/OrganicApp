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
  groupRecalls,
  type RecallGroup as RecallEventGroup,
  type RecallItem,
  type RecallList,
} from '@/lib/recalls'
import { plainReason } from '@/lib/plainRecall'
import { companyDisplayName, productDisplayName } from '@/lib/productName'
import { ProductThumb } from '@/components/ProductThumb'
import { AisleBar, Breadcrumb, SignalTile, SiteFooter, TopNav } from '@/components/SiteChrome'
import { Collapsible } from '@/components/Collapsible'
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
  return { title: company ? companyDisplayName(company.legalName) : 'Company not found' }
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
        imageUrl: true,
        imageSource: true,
        imageSourceUrl: true,
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
          { label: companyDisplayName(company.legalName) },
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
        <Monogram name={companyDisplayName(company.legalName)} />

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
            {companyDisplayName(company.legalName)}
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
                <strong>Supply-chain company.</strong> {companyDisplayName(company.legalName)} mainly makes, packs,
                imports or distributes food sold under other companies&apos; brands. Its recalls often
                concern those brands&apos; products.
              </Callout>
            </div>
          )}
          {company.businessRole === 'retailer' && (
            <div style={{ marginTop: 14, maxWidth: 760 }}>
              <Callout state="nothingOnFile">
                <strong>Retailer.</strong> {companyDisplayName(company.legalName)} sells food to consumers. Its recalls
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
              {companyDisplayName(company.parentCompany.legalName)}
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
              companyName={companyDisplayName(company.legalName)}
              issued={recalls.issued}
              naming={recalls.naming}
              showAll={showAllRecalls}
              processHint={processHint}
              family={family}
            />
          )}
          <Products
            companyName={companyDisplayName(company.legalName)}
            companyAliases={company.dbaNames}
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
  company: { hqLocation: string | null; investorFilings: { ticker: string | null }[] }
}) {
  const ticker = company.investorFilings.find((f) => f.ticker)?.ticker
  const parts: React.ReactNode[] = []
  // THE "ALSO SOLD AS" LINE IS GONE, DELIBERATELY.
  //
  // Michael: "Are these the other dba names? We have a products list below,
  // why are these here?" They were the dbaNames, and his instinct was right:
  // for Dole the line read "Also sold as Chopped Kit by Dole, Dole Dried
  // Fruit And Nut Co., Dole Fresh Vegetables Inc., Dole Good Crunch, Dole
  // Sunshine" — five names that all begin with the company's own, directly
  // above a list of its products. It read as repetition because it was.
  //
  // dbaNames still do real work; none of it is display work. They are how
  // productDisplayName() knows which brand prefix to strip off a product
  // name, and how the recall matcher ties a notice issued under a subsidiary
  // to this page. Deleting the column would break both. Not printing it in
  // the header breaks nothing.
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
            <Monogram name={companyDisplayName(b.legalName)} size={34} />
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
                {companyDisplayName(b.legalName)}
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
  companyAliases,
  products,
  total,
  listed,
}: {
  companyName: string
  companyAliases: string[]
  products: {
    id: string
    name: string
    category: string | null
    categorySource: string | null
    productType: string
    imageUrl: string | null
    imageSource: string | null
    imageSourceUrl: string | null
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
                    <ProductThumb
                      product={p}
                      category={p.category}
                      productType={p.productType}
                      size={40}
                      label={productDisplayName(p.name, companyName, companyAliases)}
                    />
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
                        {productDisplayName(p.name, companyName, companyAliases)}
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

// The manufacturing-recalls sentence, as one string.
//
// Singular and plural differ in four places, which as inline JSX produced a
// missing space in the shipped build ("linking themto the products"). Built
// here instead, where the spacing is literal and testable by reading it.
//
// The wording itself is load-bearing and was agreed in an earlier round: a
// notice that names no product cannot be reported as affecting a product. It
// says there is no evidence linking them, NOT that the products are fine —
// those are different claims and only the first one is ours to make.
function processNotice(
  firmIds: string[],
  family: { id: string; legalName: string }[],
  count: number
): string {
  const firms = firmIds
    .map((cid) => {
      const n = family.find((c) => c.id === cid)?.legalName
      return n === undefined ? undefined : companyDisplayName(n)
    })
    .filter((n): n is string => Boolean(n))
    .join(' and ')
  const one = count === 1
  return [
    firms,
    one ? 'has had 1 recall' : `has had ${count} recalls`,
    'about how food was made or handled (for example contamination,',
    'unsanitary conditions or foreign material) that',
    one ? "doesn't" : "don't",
    'name a specific product. There is no evidence linking',
    one ? 'it' : 'them',
    "to the products on this page, and we can't say whether they were affected.",
  ].join(' ')
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

  // Grouped before counting, so the number in the heading is the number of
  // recall EVENTS a reader would recognise, not the number of enforcement
  // records the agency happened to file. For Dole that is 28 rather than 232.
  const issuedGroups = groupRecalls(issued.items)
  const namingGroups = groupRecalls(naming.items)
  const grouped = issuedGroups.length + namingGroups.length

  return (
    <section>
      {/* GROUPED, AND COLLAPSIBLE.
          Michael: "these recalls need to be organized and displayed better.
          this feels like a wall of text and gleaning information from it
          seems insurmountable." He was looking at Dole, which holds 232
          enforcement records — and 28 actual recall events. The FDA files
          one record per affected product line, so the page was repeating the
          same notice up to sixteen times.

          groupRecalls() is the same display-side grouping the product page
          uses; it was built last round and simply never applied here. Every
          reference number is still kept and still shown, inside the notice it
          belongs to. The database is untouched: each number is a separately
          citable record and merging them would destroy the citation. */}
      <Collapsible
        id="recalls"
        title="recalls and government notices"
        count={grouped}
        countState="recall"
        note="FDA, FSIS and CPSC records"
        open={grouped > 0}
      >
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {issued.count === 0 && naming.count === 0 && (
            <Callout state="nothingOnFile">No FDA, FSIS or CPSC notice we hold names {companyName}.</Callout>
          )}

          {/* About how food was made or handled, naming no product.

              THE SENTENCE IS BUILT AS ONE STRING, ON PURPOSE. This paragraph
              used to be five JSX fragments with singular/plural ternaries
              between them, and it shipped reading "...linking themto the
              products on this page". The space was there in the source and
              gone in the build: JSX trims whitespace around an expression
              container in ways that are hard to predict by reading the file,
              and the identical shape two lines above it kept its space. A
              sentence with this much branching belongs in a template literal,
              where a space is just a space. Do not break it back into
              fragments. See processNotice() above. */}
          {processHint && processHint.count > 0 && (
            <Callout state="unchecked">
              <strong>Manufacturing-related recalls.</strong>{' '}
              {processNotice(processFirms, family, processHint.count)}{' '}
              {processFirms.map((cid, i) => (
                <span key={cid}>
                  {i > 0 && ' · '}
                  <Link href={`/companies/${cid}?recalls=all#recalls`}>
                    See {companyDisplayName(family.find((c) => c.id === cid)?.legalName ?? '')}&apos;s recalls
                  </Link>
                </span>
              ))}
            </Callout>
          )}

          {issuedGroups.length > 0 && (
            <RecallBlock
              heading={`Notices naming ${companyName}`}
              preamble="Each notice covers the product described in it, not every product on this page."
              groups={issuedGroups}
              total={issued.count}
              shown={issued.items.length}
              companyId={companyId}
              showAll={showAll}
            />
          )}

          {/* Issued under another firm's name (a parent, or a manufacturer
              making the product for this brand) and tied to this brand. */}
          {namingGroups.length > 0 && (
            <RecallBlock
              heading="Notices about this brand, issued by other companies"
              groups={namingGroups}
              total={naming.count}
              shown={naming.items.length}
              companyId={companyId}
              showAll={showAll}
            />
          )}
        </div>
      </Collapsible>
    </section>
  )
}

// One list of notice EVENTS, newest first, with a "Show all" link when the
// underlying record list was capped.
//
// Takes groups rather than raw items: see groupRecalls() in recalls.ts. Every
// notice MUST still show productDescription somewhere, because a notice
// covers the product it describes and that is often one line out of
// hundreds — it now lives one click inside the card rather than beside it.
function RecallBlock({
  heading,
  preamble,
  groups,
  total,
  shown,
  companyId,
  showAll,
}: {
  heading: string
  preamble?: string
  groups: RecallEventGroup[]
  // `total` and `shown` are RECORD counts, from the query. `groups.length` is
  // the event count. Keeping them apart is what makes "showing the 50 most
  // recent of 232" honest while the page displays 28 cards.
  total: number
  shown: number
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
        <span style={{ fontFamily: font.mono, fontWeight: 500, color: colors.ink4 }}>{groups.length}</span>
        <span style={{ flexGrow: 1, height: 1, background: colors.line }} />
      </div>
      {preamble && (
        <p style={{ margin: '9px 0 0', fontSize: 12.5, lineHeight: 1.6, color: colors.ink3, maxWidth: 760 }}>
          {preamble}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 11 }}>
        {groups.map((g) => (
          <RecallCard key={g.lead.id} group={g} companyId={companyId} />
        ))}
      </div>
      {!showAll && total > shown && (
        <p style={{ margin: '11px 0 0', fontSize: 13 }}>
          <span style={{ color: colors.ink3 }}>
            Showing the {shown.toLocaleString()} most recent records of {total.toLocaleString()}.{' '}
          </span>
          <Link href={`/companies/${companyId}?recalls=all#recalls`}>Show all</Link>
        </p>
      )}
    </div>
  )
}


// ONE RECALL EVENT, compact.
//
// This card used to be the whole notice spread across two columns: chip,
// date, status pill, reference number, reason, issuer, relevance line, source
// line, and a dashed "What it covered" panel beside it. Twelve lines each,
// 232 of them on Dole's page.
//
// Now the card is three lines you can scan — when, what, how big — and
// everything else is one click inside it. Nothing was removed: the reference
// numbers, the product description, the evidence note and the source link are
// all still here, in the <details>. "Organized better" has to mean reordered,
// not reduced, because every one of those lines is the citation for a claim
// about a named company.
function RecallCard({ group, companyId }: { group: RecallEventGroup; companyId: string }) {
  const action = group.lead
  const issuedElsewhere = action.company.id !== companyId
  const note = issuedElsewhere ? evidenceNote(action) : null
  const extra = group.items.length - 1
  const plain = plainReason(action.reason)

  return (
    <div
      id={`recall-${action.id}`}
      style={{
        boxSizing: 'border-box',
        padding: '12px 15px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderLeft: `3px solid ${status.recall.fg}`,
        borderRadius: 8,
      }}
    >
      {/* LINE 1 — when, and what kind. The date leads because a recall from
          2016 and one from last month are read completely differently, and
          the date was previously the third thing on the row. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap', fontSize: 12 }}>
        {action.actionDate && (
          <span style={{ fontFamily: font.mono, color: colors.ink2, fontWeight: 600 }}>
            {isoDate(action.actionDate)}
          </span>
        )}
        <StatusChip state="recall">
          {action.sourceAgency}
          {action.classification ? ` · ${action.classification}` : ''}
        </StatusChip>
        {action.status && <span style={{ color: colors.ink3 }}>{action.status}</span>}
      </div>

      {/* LINE 2 — what happened, in plain words. Michael, 2026-10-07:
          "for the layman, these recalls and notices need to be heavily
          condensed and explained to a 5 year old (not in baby talk but in
          concise simple terms)."
          The agency's own sentence moves into the collapsible below, so
          nothing is lost and the paraphrase stays checkable. A reason we
          cannot summarise safely prints unchanged — see plainRecall.ts. */}
      <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.45, marginTop: 7 }}>
        {plain ? plain.text : action.reason}
      </div>

      {/* LINE 3 — how big, and who issued it if not this company. */}
      {(extra > 0 || issuedElsewhere) && (
        <div style={{ fontSize: 12.5, color: colors.ink3, marginTop: 5 }}>
          {extra > 0 && (
            <>
              The agency filed {group.items.length} records under this notice, one per affected product
              line.
            </>
          )}
          {extra > 0 && issuedElsewhere && ' '}
          {issuedElsewhere && (
            <>
              Issued by <Link href={`/companies/${action.company.id}`}>{companyDisplayName(action.company.legalName)}</Link>.
            </>
          )}
        </div>
      )}

      {/* Everything a fact-checker needs, one click in. Native <details>, so
          no JavaScript and no hydration. */}
      <details className="rt-collapse" style={{ marginTop: 8 }}>
        <summary
          style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 12,
            color: colors.link,
          }}
        >
          <svg
            className="rt-chev"
            aria-hidden
            width="9"
            height="9"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 2l5 4-5 4" />
          </svg>
          What it covered, and the record
        </summary>

        <div style={{ paddingTop: 9 }}>
          {/* The verbatim sentence, whenever the headline above is ours. */}
          {plain && (
            <div style={{ fontSize: 12, lineHeight: 1.55, color: colors.ink3, marginBottom: 8 }}>
              <strong style={{ color: colors.ink2 }}>The notice says: </strong>
              {action.reason}
            </div>
          )}
          {action.productDescription && (
            <div
              style={{
                boxSizing: 'border-box',
                padding: '10px 12px',
                background: '#F7F5EF',
                border: '1px dashed #C9C2B2',
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.5,
                color: '#3F4A42',
              }}
            >
              <strong style={{ color: colors.ink }}>What it covered: </strong>
              {action.productDescription}
            </div>
          )}

          {note && (
            <div style={{ fontSize: 12, lineHeight: 1.5, color: colors.ink3, marginTop: 8 }}>{note}</div>
          )}

          {action.productRelevance === 'supply_chain' && (
            <div style={{ fontSize: 12, lineHeight: 1.5, color: colors.ink3, marginTop: 8 }}>
              Relates to a facility or supplier in the supply chain, not to a product itself.
            </div>
          )}

          {/* Every reference number in the group. These are the citations —
              one government record each — and they are the reason the display
              is allowed to collapse the group into one card. */}
          {group.references.length > 0 && (
            <div
              style={{
                fontFamily: font.mono,
                fontSize: 11.5,
                lineHeight: 1.7,
                color: colors.ink3,
                marginTop: 8,
                wordBreak: 'break-word',
              }}
            >
              {group.references.length === 1
                ? group.references[0]
                : `${group.references.length} records: ${group.references.join(', ')}`}
            </div>
          )}

          <SourceLine url={action.sourceUrl} label={`${action.sourceAgency} record`} />
        </div>
      </details>
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
                  {/* NO READ DATE IN THE RAIL. Michael, 2026-10-07:
                      "remove the read and the date."
                      This line was printing two dates side by side in a
                      350px column — "SEC filing of 2026-08-27 · read
                      2026-10-01" — and only one of them tells a reader
                      anything: the date the filing was made. When we read it
                      matters for a record that can change; a filed SEC
                      document does not change.
                      The read date is kept everywhere it has room — the
                      recall cards in the main column, the sources page —
                      because it is the backbone of the sourcing claim. It
                      was the rail it was cluttering. */}
                  <SourceLine
                    url={f.sourceUrl}
                    label={f.filingDate ? `SEC filing of ${isoDate(f.filingDate)}` : 'SEC filing'}
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
                <SourceLine url={d.sourceUrl} label="Source" />
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

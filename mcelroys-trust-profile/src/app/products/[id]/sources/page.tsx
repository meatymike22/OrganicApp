import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { colors, font, isoDate, layout } from '@/lib/design'
import { productDisplayName, shortProductName } from '@/lib/productName'
import { getProductRecalls, groupRecalls } from '@/lib/recalls'
import { AisleBar, Breadcrumb, SiteFooter, TopNav } from '@/components/SiteChrome'

// THE SOURCES PAGE — every record behind one product, with its date.
//
// WHY THIS PAGE EXISTS. Rootify used to print the source beside each fact.
// Michael, 2026-10-06: "All of our sources should be somewhere else, where
// any fact checkers can go look but the layman simply doesn't care." He is
// right about the reader. The product page is for a shopper deciding what to
// put in a cart, and a wall of reference numbers and read-dates was making
// that page unreadable.
//
// WHAT DID NOT CHANGE. Every claim still has a dated primary source, and
// every one is still reachable from the page that makes the claim. That is
// not a design preference: truth is the defence if a company ever objects to
// something Rootify says about it, and a claim whose record cannot be
// produced is a claim that cannot be defended. Moving the citations one click
// away is fine. Letting any of them stop existing is not.
//
// SO: if you add a fact to the product page, add its source here. The product
// page's SourceNote links here from every section, and this page must be able
// to account for all of them.

const FIELDS = {
  id: true,
  name: true,
  upc: true,
  importSource: true,
  imageUrl: true,
  imageSource: true,
  imageSourceUrl: true,
  imageCheckedAt: true,
  ingredientSource: true,
  ingredientSourceUrl: true,
  ingredientCheckedAt: true,
  ingredientDisclosureStatus: true,
  company: { select: { id: true, legalName: true, dbaNames: true } },
  certifications: {
    select: {
      id: true,
      certifyingAgency: true,
      certificateNumber: true,
      certificationStatus: true,
      certifiedScopes: true,
      effectiveDate: true,
      lastVerifiedDate: true,
      dataPulledDate: true,
      sourceUrl: true,
      sourceType: true,
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
      dataPulledDate: true,
      sourceUrl: true,
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
  const name = productDisplayName(product.name, product.company.legalName, product.company.dbaNames)
  return { title: `Sources — ${shortProductName(name)}` }
}

export default async function ProductSourcesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await prisma.product.findUnique({ where: { id }, select: FIELDS })
  if (!product) notFound()

  const name = productDisplayName(product.name, product.company.legalName, product.company.dbaNames)
  const recalls = await getProductRecalls(id)

  // Grouped the same way the product page groups them, so the two pages
  // agree about what counts as one notice — and then every reference number
  // inside each group is printed, which is the point of this page.
  const recallGroups = recalls
    ? [...groupRecalls(recalls.thisProduct.items), ...groupRecalls(recalls.brand.items), ...groupRecalls(recalls.process.items)]
    : []

  return (
    <>
      <TopNav />
      <AisleBar />
      <Breadcrumb
        trail={[
          { label: 'Rootify', href: '/' },
          { label: 'Search', href: '/search' },
          { label: shortProductName(name), href: `/products/${product.id}` },
          { label: 'Sources' },
        ]}
      />

      <div
        style={{
          flexGrow: 1,
          maxWidth: 900,
          marginLeft: 'auto',
          marginRight: 'auto',
          width: '100%',
          boxSizing: 'border-box',
          padding: `28px clamp(18px, 4vw, ${layout.gutter}px) 0`,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: font.display,
            fontSize: 'clamp(26px, 3.4vw, 34px)',
            fontWeight: 600,
            lineHeight: 1.12,
            letterSpacing: '-0.015em',
          }}
        >
          Where every line came from
        </h1>
        <p style={{ margin: '12px 0 0', fontSize: 15, lineHeight: 1.6, color: colors.ink2, maxWidth: '62ch' }}>
          Every record behind{' '}
          <Link href={`/products/${product.id}`}>{shortProductName(name)}</Link>, with the date we
          read it. Nothing on the product page is ours — it is all somebody else&apos;s published
          record, and this is the list.
        </p>
        <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.6, color: colors.ink3, maxWidth: '62ch' }}>
          On the label this product is called <strong style={{ color: colors.ink }}>{product.name}</strong>
          {product.upc && (
            <>
              , barcode <span style={{ fontFamily: font.mono }}>{product.upc}</span>
            </>
          )}
          .
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 26, margin: '30px 0 0' }}>
          {/* --- The product record itself --- */}
          <Block title="Product record">
            {product.upc && isFromOpenFoodFacts(product) ? (
              <Row
                what="Name, barcode, category and ingredient text"
                who="Open Food Facts"
                licence="Open Database License (ODbL)"
                url={`https://world.openfoodfacts.org/product/${product.upc}`}
                date={isoDate(product.ingredientCheckedAt)}
              />
            ) : (
              <Empty>This product was not imported from Open Food Facts.</Empty>
            )}
          </Block>

          {/* --- The photograph. This is the attribution the CC-BY-SA licence
                  requires, and it is the reason this page is linked from the
                  product page rather than buried in the footer: the credit
                  has to be reachable from where the image is shown. --- */}
          <Block title="Photograph">
            {product.imageUrl && product.imageSource === 'open_food_facts' ? (
              <Row
                what="Front-of-pack photograph"
                who="Open Food Facts contributors"
                licence="CC BY-SA 3.0"
                url={product.imageSourceUrl ?? product.imageUrl}
                date={isoDate(product.imageCheckedAt)}
              />
            ) : (
              <Empty>
                {product.imageCheckedAt
                  ? 'We looked and there is no photograph for this product.'
                  : 'Nobody has looked for a photograph of this product yet.'}
              </Empty>
            )}
          </Block>

          {/* --- Ingredients --- */}
          <Block title="Ingredient list">
            {product.ingredientDisclosureStatus === 'disclosed' ? (
              <Row
                what="The ingredient list, in label order"
                who={product.ingredientSource ?? 'Not recorded'}
                url={product.ingredientSourceUrl}
                date={isoDate(product.ingredientCheckedAt)}
              />
            ) : (
              <Empty>
                {product.ingredientDisclosureStatus === 'not_disclosed'
                  ? `No ingredient list was found in any source we check${isoDate(product.ingredientCheckedAt) ? `, as of ${isoDate(product.ingredientCheckedAt)}` : ''}.`
                  : 'We have not looked up an ingredient list for this product yet.'}
              </Empty>
            )}
          </Block>

          {/* --- Recalls. EVERY reference number, which is the whole reason
                  the product page is allowed to collapse them into one line
                  each. See groupRecalls in recalls.ts. --- */}
          <Block title="Recalls and government notices">
            {recallGroups.length === 0 ? (
              <Empty>No FDA, FSIS, CPSC or CBP record we hold names this product or its company.</Empty>
            ) : (
              recallGroups.map((g) => (
                <div key={g.lead.id} style={{ paddingBottom: 4 }}>
                  <Row
                    what={g.lead.reason ?? 'Notice'}
                    who={`${g.lead.sourceAgency}${g.lead.classification ? ` · ${g.lead.classification}` : ''}`}
                    url={g.lead.sourceUrl}
                    date={isoDate(g.lead.actionDate)}
                  />
                  {g.references.length > 0 && (
                    <div
                      style={{
                        fontFamily: font.mono,
                        fontSize: 11.5,
                        lineHeight: 1.7,
                        color: colors.ink3,
                        marginTop: 4,
                      }}
                    >
                      {g.references.length === 1
                        ? g.references[0]
                        : `${g.references.length} records: ${g.references.join(', ')}`}
                    </div>
                  )}
                </div>
              ))
            )}
          </Block>

          {/* --- Organic --- */}
          <Block title="USDA organic register">
            {product.certifications.length === 0 ? (
              <Empty>
                This product&apos;s company does not appear in the USDA Organic Integrity Database
                export we matched against.
              </Empty>
            ) : (
              product.certifications.map((c) => (
                <div key={c.id}>
                  <Row
                    what={`Certificate ${c.certificateNumber} — ${c.certificationStatus}${c.certifiedScopes.length ? ` (scope: ${c.certifiedScopes.join(', ')})` : ''}`}
                    who={c.certifyingAgency}
                    licence={c.sourceType ?? undefined}
                    url={c.sourceUrl}
                    date={isoDate(c.lastVerifiedDate ?? c.dataPulledDate)}
                  />
                  <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.55, color: colors.ink3 }}>
                    The register certifies <strong>operations</strong>, not individual products, so
                    this certificate covers the company — not a guarantee that this item is organic.
                  </p>
                </div>
              ))
            )}
          </Block>

          {/* --- Other verification schemes --- */}
          <Block title="Verification registers">
            {product.productCertifications.length === 0 ? (
              <Empty>This product is not in the verification registers we check.</Empty>
            ) : (
              product.productCertifications.map((c) => (
                <Row
                  key={c.id}
                  what={`${c.scheme} — ${c.status}${c.certificateNumber ? ` (${c.certificateNumber})` : ''}${c.scopeNote ? `. ${c.scopeNote}` : ''}`}
                  who={c.certifyingBody ?? c.scheme}
                  url={c.sourceUrl}
                  date={isoDate(c.lastVerifiedDate ?? c.dataPulledDate)}
                />
              ))
            )}
          </Block>
        </div>

        <p
          style={{
            margin: '34px 0 0',
            fontSize: 12.5,
            lineHeight: 1.65,
            color: colors.ink3,
            maxWidth: '68ch',
          }}
        >
          A date here is the date we read the record, not the date the record was published. If one
          of these is wrong, or a record has changed since we read it, we would rather hear it than
          not — see <Link href="/corrections">corrections</Link>.
        </p>
      </div>

      <SiteFooter />
    </>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: colors.ink2,
          borderBottom: `1px solid ${colors.line}`,
          paddingBottom: 8,
        }}
      >
        {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 13 }}>{children}</div>
    </section>
  )
}

// One record: what it tells us, who published it, its licence where one
// applies, a link to it, and the date we read it.
function Row({
  what,
  who,
  licence,
  url,
  date,
}: {
  what: string
  who: string
  licence?: string
  url?: string | null
  date?: string | null
}) {
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
      <div style={{ color: colors.ink }}>{what}</div>
      <div style={{ fontSize: 12.5, color: colors.ink3, marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span>{who}</span>
        {licence && <span>{licence}</span>}
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer">
            the record
          </a>
        )}
        {date && <span style={{ fontFamily: font.mono }}>read {date}</span>}
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: colors.ink3 }}>{children}</p>
}

// Products created by the Open Food Facts bulk import, or whose ingredient
// list came from it. The ODbL asks for attribution and a link to the record
// wherever that data is shown.
function isFromOpenFoodFacts(product: { importSource: string | null; ingredientSource: string | null }): boolean {
  return (
    product.importSource === 'open_food_facts_bulk' ||
    product.ingredientSource === 'open_food_facts' ||
    product.ingredientSource === 'open_beauty_facts'
  )
}

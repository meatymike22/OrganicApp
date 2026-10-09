import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { colors, font, isoDate, layout, type StatusKey } from '@/lib/design'
import { productDisplayName, shortProductName } from '@/lib/productName'
import { getProductRecalls, groupRecalls } from '@/lib/recalls'
import { AisleBar, BackTo, SiteFooter, TopNav } from '@/components/SiteChrome'
import { Collapsible } from '@/components/Collapsible'
import { StatusChip } from '@/components/StatusChip'

// THE SOURCES PAGE — every record behind one product, with its date.
//
// WHY THIS PAGE EXISTS. Rootify used to print the source beside each fact.
// Michael: "All of our sources should be somewhere else, where any fact
// checkers can go look but the layman simply doesn't care." The product page
// is for someone deciding what to put in a cart, and a wall of reference
// numbers and read-dates was making that page unreadable.
//
// WHY IT LOOKS LIKE THIS. The first version moved the wall rather than
// fixing it. Michael: "this entire page is just a wall of text. Organize in
// a way that a reader would actually enjoy the reading experience." So the
// page now answers its first question before any prose:
//
//   1. A LEDGER at the top — one row per source, each with a status chip.
//      Six rows tell you in a glance which sources we hold and which we do
//      not, which is the only thing most visitors came for.
//   2. The detail BELOW, one card per source, in the same order.
//   3. Recall reference numbers inside a collapsible. Sixteen F-numbers set
//      in mono is the single densest thing on this site, and printing them
//      inline is what made the page unreadable.
//
// WHAT DID NOT CHANGE, AND MUST NOT. Every claim still has a dated primary
// source, and every one is still reachable from the page that makes the
// claim. That is not a design preference: truth is the defence if a company
// objects to something Rootify says about it, and a claim whose record cannot
// be produced is a claim that cannot be defended. Moving citations one click
// away is fine. Letting any of them stop existing is not.
//
// SO: if you add a fact to the product page, add its source here, and give it
// a ledger row. The product page's SourceNote links here from every section,
// and this page must be able to account for all of them.

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

  // Grouped the same way the product page groups them, so the two pages agree
  // about what counts as one notice — and then every reference number inside
  // each group is printed, which is the point of this page.
  const recallGroups = recalls
    ? [
        ...groupRecalls(recalls.thisProduct.items),
        ...groupRecalls(recalls.brand.items),
        ...groupRecalls(recalls.process.items),
      ]
    : []
  const recallRecords = recallGroups.reduce((n, g) => n + g.items.length, 0)

  const fromOff = isFromOpenFoodFacts(product)
  const hasPhoto = Boolean(product.imageUrl) && product.imageSource === 'open_food_facts'
  const hasIngredients = product.ingredientDisclosureStatus === 'disclosed'

  // THE LEDGER. One row per source, in the order the cards appear below.
  // `state` is the three-state rule: confirmed (we hold it), nothingOnFile
  // (we looked, there is none), unchecked (nobody looked). Those are three
  // different facts and this table is the place they are least allowed to
  // blur together.
  const ledger: { key: string; what: string; state: StatusKey; said: string }[] = [
    {
      key: 'record',
      what: 'Product record',
      state: fromOff ? 'confirmed' : 'unchecked',
      said: fromOff ? 'Open Food Facts' : 'Not from a bulk source',
    },
    {
      key: 'photo',
      what: 'Photograph',
      state: hasPhoto ? 'confirmed' : product.imageCheckedAt ? 'nothingOnFile' : 'unchecked',
      said: hasPhoto ? 'Open Food Facts' : product.imageCheckedAt ? 'None published' : 'Not looked for yet',
    },
    {
      key: 'ingredients',
      what: 'Ingredient list',
      state: hasIngredients
        ? 'confirmed'
        : product.ingredientDisclosureStatus === 'not_disclosed'
          ? 'nothingOnFile'
          : 'unchecked',
      said: hasIngredients
        ? (product.ingredientSource ?? 'Source not recorded')
        : product.ingredientDisclosureStatus === 'not_disclosed'
          ? 'None found'
          : 'Not looked up yet',
    },
    {
      key: 'recalls',
      what: 'Recalls and notices',
      state: recallGroups.length > 0 ? 'recall' : 'nothingOnFile',
      said:
        recallGroups.length > 0
          ? `${recallGroups.length} ${recallGroups.length === 1 ? 'notice' : 'notices'}, ${recallRecords} records`
          : 'None name this product',
    },
    {
      key: 'organic',
      what: 'USDA organic register',
      state: product.certifications.length > 0 ? 'confirmed' : 'nothingOnFile',
      said:
        product.certifications.length > 0
          ? `${product.certifications.length} certificate${product.certifications.length === 1 ? '' : 's'}`
          : 'Company not in the export',
    },
    {
      key: 'verification',
      what: 'Verification registers',
      state: product.productCertifications.length > 0 ? 'confirmed' : 'nothingOnFile',
      said:
        product.productCertifications.length > 0
          ? product.productCertifications.map((c) => c.scheme).join(', ')
          : 'Not in the registers we check',
    },
  ]

  const held = ledger.filter((r) => r.state === 'confirmed' || r.state === 'recall').length

  return (
    <>
      <TopNav />
      <AisleBar />
      <BackTo href={`/products/${product.id}`} label={shortProductName(name)} />

      <div
        style={{
          flexGrow: 1,
          maxWidth: 940,
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

        <p style={{ margin: '11px 0 0', fontSize: 15, lineHeight: 1.6, color: colors.ink2, maxWidth: '58ch' }}>
          Every record behind <Link href={`/products/${product.id}`}>{shortProductName(name)}</Link>, with
          the date we read it. Nothing here is ours — it is all somebody else&apos;s published record.
        </p>

        {/* THE LEDGER — the whole page in six rows. */}
        <div
          style={{
            marginTop: 24,
            boxSizing: 'border-box',
            background: colors.card,
            border: `1px solid ${colors.line}`,
            borderRadius: layout.radius,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '11px 16px',
              borderBottom: `1px solid ${colors.line}`,
              background: colors.panel,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: colors.ink2,
            }}
          >
            {held} of {ledger.length} sources have a record
          </div>
          {ledger.map((row, i) => (
            <a
              key={row.key}
              href={`#${row.key}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                padding: '11px 16px',
                borderTop: i === 0 ? undefined : `1px solid ${colors.line}`,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <span style={{ flexBasis: 190, flexShrink: 0, fontSize: 14, fontWeight: 600 }}>{row.what}</span>
              <StatusChip state={row.state}>{STATE_WORD[row.state]}</StatusChip>
              <span style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, color: colors.ink3 }}>{row.said}</span>
            </a>
          ))}
        </div>

        <p style={{ margin: '14px 0 0', fontSize: 12.5, lineHeight: 1.6, color: colors.ink3, maxWidth: '68ch' }}>
          On the label this product is called{' '}
          <strong style={{ color: colors.ink }}>{product.name}</strong>
          {product.upc ? (
            <>
              , barcode <span style={{ fontFamily: font.mono }}>{product.upc}</span>.
            </>
          ) : (
            '.'
          )}
        </p>

        {/* THE DETAIL, same order as the ledger. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: '30px 0 0' }}>
          <Card id="record" title="Product record">
            {fromOff && product.upc ? (
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
          </Card>

          {/* The photograph. This is the attribution CC-BY-SA requires, and
              the reason this page is linked from the product page rather than
              buried in the footer: the credit has to be reachable from where
              the image is shown. */}
          <Card id="photo" title="Photograph">
            {hasPhoto ? (
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
          </Card>

          <Card id="ingredients" title="Ingredient list">
            {hasIngredients ? (
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
          </Card>

          {/* Recalls. EVERY reference number, which is the whole reason the
              product page is allowed to collapse them into one line each.
              They sit inside a collapsible because sixteen F-numbers in mono
              is the densest text on this site. */}
          <Card id="recalls" title="Recalls and government notices">
            {recallGroups.length === 0 ? (
              <Empty>No FDA, FSIS, CPSC or CBP record we hold names this product or its company.</Empty>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {recallGroups.map((g) => (
                  <div key={g.lead.id}>
                    <Row
                      what={g.lead.reason ?? 'Notice'}
                      who={`${g.lead.sourceAgency}${g.lead.classification ? ` · ${g.lead.classification}` : ''}`}
                      url={g.lead.sourceUrl}
                      date={isoDate(g.lead.actionDate)}
                    />
                    {g.references.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {g.references.length === 1 ? (
                          <span style={{ fontFamily: font.mono, fontSize: 11.5, color: colors.ink3 }}>
                            {g.references[0]}
                          </span>
                        ) : (
                          <Collapsible
                            title="agency records under this notice"
                            count={g.references.length}
                            note="One per affected product line"
                          >
                            <div
                              style={{
                                fontFamily: font.mono,
                                fontSize: 11.5,
                                lineHeight: 1.8,
                                color: colors.ink3,
                                wordBreak: 'break-word',
                                marginTop: 4,
                              }}
                            >
                              {g.references.join(', ')}
                            </div>
                          </Collapsible>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card id="organic" title="USDA organic register">
            {product.certifications.length === 0 ? (
              <Empty>
                This product&apos;s company does not appear in the USDA Organic Integrity Database
                export we matched against.
              </Empty>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {product.certifications.map((c) => (
                  <div key={c.id}>
                    <Row
                      what={`Certificate ${c.certificateNumber} — ${c.certificationStatus}${c.certifiedScopes.length ? ` (scope: ${c.certifiedScopes.join(', ')})` : ''}`}
                      who={c.certifyingAgency}
                      licence={c.sourceType ?? undefined}
                      url={c.sourceUrl}
                      date={isoDate(c.lastVerifiedDate ?? c.dataPulledDate)}
                    />
                    <p style={{ margin: '5px 0 0', fontSize: 12, lineHeight: 1.55, color: colors.ink3 }}>
                      The register certifies <strong>operations</strong>, not individual products, so this
                      certificate covers the company — not a guarantee that this item is organic.
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card id="verification" title="Verification registers">
            {product.productCertifications.length === 0 ? (
              <Empty>This product is not in the verification registers we check.</Empty>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {product.productCertifications.map((c) => (
                  <Row
                    key={c.id}
                    what={`${c.scheme} — ${c.status}${c.certificateNumber ? ` (${c.certificateNumber})` : ''}${c.scopeNote ? `. ${c.scopeNote}` : ''}`}
                    who={c.certifyingBody ?? c.scheme}
                    url={c.sourceUrl}
                    date={isoDate(c.lastVerifiedDate ?? c.dataPulledDate)}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>

        <p
          style={{
            margin: '30px 0 0',
            fontSize: 12.5,
            lineHeight: 1.65,
            color: colors.ink3,
            maxWidth: '68ch',
          }}
        >
          A date here is the date we read the record, not the date the record was published. If one of
          these is wrong, or a record has changed since we read it, we would rather hear it than not —
          see <Link href="/corrections">corrections</Link>.
        </p>
      </div>

      <SiteFooter />
    </>
  )
}

// The one word the ledger uses for each state. Short on purpose: the row's
// own text says what was found, the chip says only which of the three states
// it is.
const STATE_WORD: Record<StatusKey, string> = {
  confirmed: 'On file',
  nothingOnFile: 'Nothing on file',
  openResearch: 'Open research',
  recall: 'On file',
  unchecked: 'Not checked',
  ownership: 'On file',
  notApplicable: "Doesn't apply",
}

function Card({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section
      id={id}
      style={{
        boxSizing: 'border-box',
        padding: '15px 18px 17px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderRadius: layout.radius,
        // Anchored from the ledger, so it must not land under the sticky
        // aisle bar when jumped to.
        scrollMarginTop: 18,
      }}
    >
      <h2
        style={{
          margin: '0 0 11px',
          fontFamily: font.display,
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

// One record: what it tells us, who published it, its licence where one
// applies, a link to it, and the date we read it. The detail line is a single
// wrapped row rather than a paragraph, so a card with six records reads as six
// records and not as prose.
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
    <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
      <div style={{ color: colors.ink }}>{what}</div>
      <div
        style={{
          fontSize: 12.5,
          color: colors.ink3,
          marginTop: 3,
          display: 'flex',
          gap: 9,
          flexWrap: 'wrap',
          alignItems: 'baseline',
        }}
      >
        <span style={{ color: colors.ink2 }}>{who}</span>
        {licence && (
          <>
            <Dot />
            <span>{licence}</span>
          </>
        )}
        {date && (
          <>
            <Dot />
            <span style={{ fontFamily: font.mono }}>read {date}</span>
          </>
        )}
        {url && (
          <>
            <Dot />
            <a href={url} target="_blank" rel="noopener noreferrer">
              the record
            </a>
          </>
        )}
      </div>
    </div>
  )
}

function Dot() {
  return (
    <span aria-hidden style={{ color: '#C9C2B2' }}>
      ·
    </span>
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

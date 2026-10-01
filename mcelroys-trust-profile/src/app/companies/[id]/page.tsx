import Link from 'next/link'
// "prisma" is the shared database client we set up in src/lib/prisma.ts
import { prisma } from '@/lib/prisma'
import { describeCategory } from '@/lib/categoryDisplay'
import { companyAndParents, evidenceNote, getCompanyRecalls, getRecallsListingProducts, getUnlinkedProcessRecalls, type RecallItem } from '@/lib/recalls'

// How many recalls each list shows before "Show all". Some firms have
// hundreds of notices (one product line per notice); ?recalls=all lists them all.
const RECALLS_SHOWN = 20

// This is a Next.js "page" component — Next.js automatically renders this file
// for any URL matching /companies/[whatever-id-was-in-the-url]
//
// In Next.js 15+, the dynamic part of the URL ("params") is passed as a Promise
// rather than a plain object, so it has to be awaited before you can read "id" from it.
export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // Unwrap the Promise to get the actual id string from the URL
  const { id } = await params
  const showAllRecalls = (await searchParams).recalls === 'all'

  // Query the database for one Company matching this id.
  // "include" tells Prisma to also fetch related rows from other tables,
  // nesting one level deeper each time (company -> products -> certifications)
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      products: {
        include: {
          certifications: true,
        },
      },
      ownershipCertifications: true,
      investorFilings: true,
      supplyChainDisclosures: true,
      independentInvestigations: true,
      parentCompany: {
        select: { id: true, legalName: true },
      },
      subsidiaries: {
        select: { id: true, legalName: true },
      },
    },
  })

  // If no company matched that id (e.g., a typo'd or deleted UUID in the URL),
  // show a fallback instead of crashing
  // "rejected" means a reviewer decided this isn't a usable company (junk
  // brand text, a duplicate). The row is kept only so bulk ingestion doesn't
  // recreate it, so it's treated the same as not existing.
  if (!company || company.vettingStatus === 'rejected') {
    return <div>Company not found</div>
  }

  const isUnvetted = company.vettingStatus !== 'vetted'

  // Recalls: loaded only for verified companies, as the unverified banner
  // says. See src/lib/recalls.ts for how they are matched and linked.
  const recalls = isUnvetted ? null : await getCompanyRecalls(company.id, showAllRecalls ? undefined : RECALLS_SHOWN)
  const listedProducts = isUnvetted ? new Map<string, RecallItem[]>() : await getRecallsListingProducts(company.products.map((p) => p.id))
  // Recalls by this company or its parents about how food was made or
  // handled that name no product, so we can't say whether these products
  // were affected. Shown once as a hint above the products, never as a
  // recall of any of them.
  const family = isUnvetted ? [] : await companyAndParents(company.id)
  const processHint = isUnvetted ? null : await getUnlinkedProcessRecalls(family.map((c) => c.id))

  // Everything below is JSX — HTML-like syntax that React turns into actual webpage elements.
  // {company.legalName} etc. embeds a JavaScript value directly into the HTML.
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>{company.legalName}</h1>

      {/* Unvetted = created automatically from a product database's brand
          field. The name shown is that brand text, not a confirmed legal
          entity, and no recalls, filings or certifications have been matched
          to it (those scripts only run against vetted companies). Stated
          once, plainly, per the voice rules — no extra hedging. */}
      {isUnvetted && (
        <p style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}>
          <strong>Not yet verified.</strong> This brand and its products come
          from Open Food Facts and haven&apos;t been verified yet. Recalls,
          ownership and certifications appear once it&apos;s verified.
        </p>
      )}

      {/* Middlemen between source and shelf (co-packers, importers,
          distributors). Their recalls usually concern other companies'
          brands, so the page says so up front. */}
      {company.businessRole === 'supply_chain' && (
        <p style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}>
          <strong>Supply-chain company.</strong> {company.legalName} mainly makes,
          packs, imports or distributes food sold under other companies&apos;
          brands. Its recalls often concern those brands&apos; products.
        </p>
      )}

      {/* Stores and chains. Their recalls are usually of store-brand products
          or items they sold. */}
      {company.businessRole === 'retailer' && (
        <p style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}>
          <strong>Retailer.</strong> {company.legalName} sells food to consumers.
          Its recalls usually concern its store-brand products or items it sold.
        </p>
      )}

      {/* Only show this line at all if there's at least one DBA name to display */}
      {company.dbaNames.length > 0 && (
        <p>Also known as: {company.dbaNames.join(', ')}</p>
      )}
      <p>{company.hqLocation}</p>

      {/* Corporate ownership — who actually owns this brand. Surfaced
          prominently because it's information companies rarely advertise
          and that materially affects how a shopper reads everything else
          on the page. */}
      {company.parentCompany && (
        <p style={{ padding: '0.5rem', background: '#f5f5f5', borderRadius: '4px' }}>
          <strong>Owned by:</strong>{' '}
          <Link href={`/companies/${company.parentCompany.id}`}>
            {company.parentCompany.legalName}
          </Link>
          {company.ownershipNote && (
            <span style={{ display: 'block', fontSize: '0.85rem', color: '#555' }}>
              {company.ownershipNote}
            </span>
          )}
        </p>
      )}

      {company.subsidiaries.length > 0 && (
        <p style={{ padding: '0.5rem', background: '#f5f5f5', borderRadius: '4px' }}>
          <strong>Owns:</strong>{' '}
          {company.subsidiaries.map((sub, i) => (
            <span key={sub.id}>
              {i > 0 && ', '}
              <Link href={`/companies/${sub.id}`}>{sub.legalName}</Link>
            </span>
          ))}
        </p>
      )}

      <h2>Products</h2>
      {processHint && processHint.count > 0 && (
        <p style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}>
          <strong>Manufacturing-related recalls.</strong>{' '}
          {[...new Set(processHint.items.map((a) => a.company.id))]
            .map((cid) => family.find((c) => c.id === cid)?.legalName)
            .filter(Boolean)
            .join(' and ')}{' '}
          {processHint.count === 1 ? 'has had 1 recall' : `has had ${processHint.count} recalls`} about how
          food was made or handled (for example contamination, unsanitary
          conditions or foreign material) that {processHint.count === 1 ? "doesn't" : "don't"} name
          a specific product. There is no evidence linking {processHint.count === 1 ? 'it' : 'them'} to
          the products below, and we can&apos;t say whether they were affected.{' '}
          {[...new Set(processHint.items.map((a) => a.company.id))].map((cid, i) => (
            <span key={cid}>
              {i > 0 && ' · '}
              <Link href={`/companies/${cid}?recalls=all#recalls`}>
                See {family.find((c) => c.id === cid)?.legalName}&apos;s recalls
              </Link>
            </span>
          ))}
        </p>
      )}
      {/* .map() loops over every product and returns a block of JSX for each one.
          "key" is required by React so it can track each item in the list efficiently. */}
      {company.products.map((product) => (
        <div key={product.id} style={{ marginBottom: '1.5rem' }}>
          <h3>{product.name}</h3>
          <p title={describeCategory(product.category, product.categorySource).note ?? undefined}>
            {describeCategory(product.category, product.categorySource).label}
          </p>

          {/* Nested loop: each product can have its own certification(s) */}
          {/* Ingredient disclosure state. Deliberately distinguishes "we checked
              and found nothing published" from "we haven't checked" — showing
              a blank section for both would let a shopper read absence of data
              as absence of ingredients. Nothing is shown for "unchecked",
              since asserting non-disclosure without checking would be false. */}
          {/* A recall notice lists this product's barcode. Only exact
              barcode matches are flagged per product; brand-level recalls
              are listed once, below. */}
          {listedProducts.get(product.id)?.map((action) => (
            <p key={action.id} style={{ background: '#fdecea', border: '1px solid #f5c2c0', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}>
              <strong>Listed in a recall notice.</strong> A {action.sourceAgency}{' '}
              {action.actionType.replace(/_/g, ' ')}
              {action.actionDate && ` of ${new Date(action.actionDate).toLocaleDateString()}`}
              {action.company.id !== company.id && ` issued by ${action.company.legalName}`} lists this
              product&apos;s barcode
              {action.reason && `. Reason given: ${action.reason}`}{' '}
              <a href={action.sourceUrl} target="_blank" rel="noopener noreferrer">
                Source
              </a>
            </p>
          ))}

          {product.ingredientDisclosureStatus === 'not_disclosed' && (
            <p style={{ background: '#fff3cd', border: '1px solid #ffe69c', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}>
              <strong>No ingredient list found.</strong> We checked the public
              product databases we use and could not find a published ingredient
              list for this product
              {product.ingredientCheckedAt &&
                ` (as of ${new Date(product.ingredientCheckedAt).toLocaleDateString()})`}
              . That does not mean the manufacturer has never disclosed it —
              only that we could not locate one, so we cannot tell you what is
              in this product.
            </p>
          )}

          {product.certifications.map((cert) => (
            <div key={cert.id} style={{ paddingLeft: '1rem' }}>
              <p>
                Organic Certification: {cert.certificationStatus} by{' '}
                {cert.certifyingAgency.trim()}
              </p>
              <p>Certificate #: {cert.certificateNumber}</p>
              <p>Scopes: {cert.certifiedScopes.join(', ')}</p>
              <p>
                Source:{' '}
                {/* A real clickable link to the source citation */}
                <a href={cert.sourceUrl} target="_blank" rel="noopener noreferrer">
                  {cert.sourceUrl}
                </a>
              </p>
            </div>
          ))}
        </div>
      ))}

      {/* Only render this whole section if there's investor filing data to show */}
      {company.investorFilings.length > 0 && (
        <>
          <h2>Investor Relations</h2>
          {company.investorFilings.map((filing) => (
            <div key={filing.id}>
              <p>Status: {filing.publicStatus}</p>
              {filing.parentCompany && <p>Parent company: {filing.parentCompany}</p>}
            </div>
          ))}
        </>
      )}

      {recalls && recalls.issued.count > 0 && (
        <>
          <h2 id="recalls">Recalls and regulatory actions</h2>
          <p style={{ fontSize: '0.9rem', color: '#555' }}>
            Notices that name {company.legalName}. Each notice covers the product
            described in it, not every product listed on this page.
          </p>
          <RecallList list={recalls.issued} companyId={company.id} showAll={showAllRecalls} />
        </>
      )}

      {/* Recalls issued under another firm's name (a parent company, or a
          manufacturer making the product for this brand) that concern this
          brand. Without this section a brand whose recall was filed under its
          parent's name would show nothing. */}
      {recalls && recalls.naming.count > 0 && (
        <>
          <h2>Recalls of this brand issued by other companies</h2>
          <RecallList list={recalls.naming} companyId={company.id} showAll={showAllRecalls} />
        </>
      )}
    </div>
  )
}

// One list of recalls, newest first, with a "Show all" link when capped.
// Every action MUST show productDescription prominently: a notice covers the
// product it describes, which is often only one of a company's products.
// Never render these as a bare count or date list.
function RecallList({ list, companyId, showAll }: { list: { count: number; items: RecallItem[] }; companyId: string; showAll: boolean }) {
  return (
    <>
      {list.items.map((action) => (
        <div
          key={action.id}
          id={`recall-${action.id}`}
          style={{
            border: '1px solid #eee',
            borderRadius: '6px',
            padding: '0.75rem',
            marginBottom: '0.75rem',
          }}
        >
          <p style={{ fontWeight: 'bold' }}>
            {action.sourceAgency} {action.actionType.replace(/_/g, ' ')}
            {action.classification && ` — ${action.classification}`}
          </p>
          {action.company.id !== companyId && (
            <p style={{ fontSize: '0.85rem', color: '#555' }}>
              Issued by{' '}
              <Link href={`/companies/${action.company.id}`}>{action.company.legalName}</Link>
              {evidenceNote(action) && <span style={{ display: 'block' }}>{evidenceNote(action)}</span>}
            </p>
          )}
          {action.productRelevance === 'supply_chain' && (
            <p style={{ fontSize: '0.85rem', color: '#555' }}>
              Relates to a facility or supplier in this product&apos;s supply chain,
              not to the product itself.
            </p>
          )}
          {action.productDescription && (
            <p>
              <strong>Product:</strong> {action.productDescription}
            </p>
          )}
          <p>Reason: {action.reason}</p>
          {action.status && <p>Status: {action.status}</p>}
          {action.actionDate && (
            <p>Date: {new Date(action.actionDate).toLocaleDateString()}</p>
          )}
          <p>
            <a href={action.sourceUrl} target="_blank" rel="noopener noreferrer">
              View source record (raw government data)
            </a>
          </p>
        </div>
      ))}
      {!showAll && list.count > list.items.length && (
        <p>
          Showing the {list.items.length} most recent of {list.count}.{' '}
          <Link href={`/companies/${companyId}?recalls=all`}>Show all</Link>
        </p>
      )}
    </>
  )
}

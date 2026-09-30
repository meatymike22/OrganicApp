import Link from 'next/link'
// "prisma" is the shared database client we set up in src/lib/prisma.ts
import { prisma } from '@/lib/prisma'
import { describeCategory } from '@/lib/categoryDisplay'

// This is a Next.js "page" component — Next.js automatically renders this file
// for any URL matching /companies/[whatever-id-was-in-the-url]
//
// In Next.js 15+, the dynamic part of the URL ("params") is passed as a Promise
// rather than a plain object, so it has to be awaited before you can read "id" from it.
export default async function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // Unwrap the Promise to get the actual id string from the URL
  const { id } = await params

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
      regulatoryActions: true, // FDA/CPSC/CBP recalls and other regulatory actions
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

      {/* Only surface actions actually tied to this company's tracked products
          or their supply chain. Actions against the same legal entity in an
          unrelated business line (e.g. a pharmaceutical warning letter on a
          company whose tracked product is diapers) are TRUE but MISLEADING in
          a product context, so they are filtered out here rather than shown
          with a caveat. "unreviewed" is also withheld — a human hasn't yet
          judged which category it falls into. */}
      {company.regulatoryActions.filter(
        (a) => a.productRelevance === 'direct' || a.productRelevance === 'supply_chain'
      ).length > 0 && (
        <>
          <h2>Regulatory Actions</h2>
          {/* Important: every regulatory action MUST show productDescription prominently.
              Recalls match at the legal-entity level, which can pull in a parent company's
              other, unrelated brands (e.g. a sibling brand's recall showing up here even
              though it has nothing to do with this specific company's product). Never
              render these as a bare count or date list — that would misleadingly imply
              the action affected this company's own product line specifically. */}
          {company.regulatoryActions
            .filter((a) => a.productRelevance === 'direct' || a.productRelevance === 'supply_chain')
            .map((action) => (
            <div
              key={action.id}
              style={{
                border: '1px solid #eee',
                borderRadius: '6px',
                padding: '0.75rem',
                marginBottom: '0.75rem',
              }}
            >
              <p style={{ fontWeight: 'bold' }}>
                {action.sourceAgency} {action.actionType}
                {action.classification && ` — ${action.classification}`}
              </p>
              {action.productRelevance === 'supply_chain' && (
                <p style={{ fontSize: '0.85rem', color: '#555' }}>
                  Relates to a facility or supplier in this product&apos;s supply chain,
                  not to the product itself.
                </p>
              )}
              {/* Product description shown first and prominently — this is what actually
                  tells the reader whether this action relates to the product they're
                  looking at, or to an unrelated product from the same parent company */}
              {action.productDescription && (
                <p>
                  <strong>Product:</strong> {action.productDescription}
                </p>
              )}
              <p>Reason: {action.reason}</p>
              <p>Status: {action.status}</p>
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
        </>
      )}
    </div>
  )
}

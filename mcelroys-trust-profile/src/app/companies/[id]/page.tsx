// "prisma" is the shared database client we set up in src/lib/prisma.ts
import { prisma } from '@/lib/prisma'

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
    },
  })

  // If no company matched that id (e.g., a typo'd or deleted UUID in the URL),
  // show a fallback instead of crashing
  if (!company) {
    return <div>Company not found</div>
  }

  // Everything below is JSX — HTML-like syntax that React turns into actual webpage elements.
  // {company.legalName} etc. embeds a JavaScript value directly into the HTML.
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>{company.legalName}</h1>

      {/* Only show this line at all if there's at least one DBA name to display */}
      {company.dbaNames.length > 0 && (
        <p>Also known as: {company.dbaNames.join(', ')}</p>
      )}
      <p>{company.hqLocation}</p>

      <h2>Products</h2>
      {/* .map() loops over every product and returns a block of JSX for each one.
          "key" is required by React so it can track each item in the list efficiently. */}
      {company.products.map((product) => (
        <div key={product.id} style={{ marginBottom: '1.5rem' }}>
          <h3>{product.name}</h3>
          <p>{product.category}</p>

          {/* Nested loop: each product can have its own certification(s) */}
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

      {company.regulatoryActions.length > 0 && (
        <>
          <h2>Regulatory Actions</h2>
          {/* Important: every regulatory action MUST show productDescription prominently.
              Recalls match at the legal-entity level, which can pull in a parent company's
              other, unrelated brands (e.g. a sibling brand's recall showing up here even
              though it has nothing to do with this specific company's product). Never
              render these as a bare count or date list — that would misleadingly imply
              the action affected this company's own product line specifically. */}
          {company.regulatoryActions.map((action) => (
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

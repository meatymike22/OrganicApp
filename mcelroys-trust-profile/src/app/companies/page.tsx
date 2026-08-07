// Link is Next.js's component for internal navigation — using it instead of a
// plain <a> tag lets Next.js handle page transitions faster (no full page reload)
import Link from 'next/link'
// "prisma" is the shared database client set up in src/lib/prisma.ts
import { prisma } from '@/lib/prisma'

// This file lives at src/app/companies/page.tsx (no [id] folder), so Next.js
// serves it at exactly the URL /companies — always the same content for everyone,
// unlike the [id] page which changes based on what's in the URL.
//
// "async function" because querying the database takes time, and this component
// needs to wait for that data before it can render anything.
export default async function CompaniesListPage() {
  // Ask Prisma for every row in the Company table.
  // "include" tells it to also fetch related rows from other tables in the same
  // query, instead of us having to run separate queries for each company's products.
  const companies = await prisma.company.findMany({
    include: {
      products: {
        include: {
          certifications: true, // go one level deeper: each product's certification(s) too
        },
      },
    },
    // Sort results alphabetically by legal name, so the list order is predictable
    // and doesn't just show whatever order they happen to sit in the database
    orderBy: {
      legalName: 'asc',
    },
  })

  // Everything from here down is JSX (HTML-like syntax that becomes real webpage elements).
  // Curly braces { } let you drop actual JavaScript values/logic into the middle of it.
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Companies</h1>

      {/* This line only renders if companies.length === 0 is true.
          The && trick: React shows the right-hand side only when the left side is truthy,
          and shows nothing at all when it's false. */}
      {companies.length === 0 && <p>No companies in the database yet.</p>}

      {/* .map() runs once per company in the array, and returns a block of JSX
          for each one — this is how you turn a list of data into a list of
          on-screen elements without writing a manual loop */}
      {companies.map((company) => {
        // .flatMap() here does two things at once:
        // 1. For each product, grab its certifications
        // 2. Instead of ending up with a list-of-lists (one list per product),
        //    flatten it into one single combined list
        // Net result: every certification status across every product this company has
        const statuses = company.products.flatMap((product) =>
          product.certifications.map((cert) => cert.certificationStatus)
        )

        return (
          // "key" is required by React whenever you render a list — it's how React
          // tracks which item is which if the list changes later. Must be unique
          // per item, so the database id is the natural choice here.
          <div
            key={company.id}
            style={{
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '1rem',
              marginBottom: '1rem',
            }}
          >
            {/* href builds the URL dynamically using this company's real id —
                clicking this text navigates to /companies/<that-uuid>,
                which is handled by your existing [id]/page.tsx */}
            <Link href={`/companies/${company.id}`} style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
              {company.legalName}
            </Link>

            {/* Only show this paragraph at all if there's at least one DBA name.
                .join(', ') turns an array like ["A", "B"] into the string "A, B" */}
            {company.dbaNames.length > 0 && (
              <p style={{ margin: '0.25rem 0', color: '#555' }}>
                Also known as: {company.dbaNames.join(', ')}
              </p>
            )}

            <p style={{ margin: '0.25rem 0', color: '#555' }}>{company.hqLocation}</p>

            <p style={{ margin: '0.25rem 0' }}>
              {/* Template literal-style logic: show "1 product" (singular) or
                  "2 products" (plural) depending on the actual count */}
              {company.products.length} product{company.products.length !== 1 ? 's' : ''}
              {/* Only add this part of the sentence if there's at least one status to show */}
              {statuses.length > 0 && ` — Organic status: ${statuses.join(', ')}`}
            </p>
          </div>
        )
      })}
    </div>
  )
}

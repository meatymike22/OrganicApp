import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { colors, font, layout } from '@/lib/design'
import { VETTED_COMPANIES } from '@/lib/vetting'
import { AisleBar, SiteFooter, TopNav } from '@/components/SiteChrome'
import { StatusChip } from '@/components/StatusChip'
import { Callout, Monogram } from '@/components/PageParts'

// THE COMPANY LIST, at /companies.
//
// Only verified companies are listed. Bulk ingestion creates thousands of
// unverified brand-name companies; browsing is for the verified database,
// while an unverified company's page stays reachable from its products and
// carries a "not yet verified" notice.
//
// Built from the same pieces as the other screens (nav, aisle bar,
// breadcrumb, the company page's brand cards, the search page's pager). With
// tens of thousands of companies, a name filter (?q=) does the real work;
// the alphabetical pages are for browsing.

export const metadata = { title: 'Companies' }

// How many companies per page.
const PAGE_SIZE = 48

export default async function CompaniesListPage({
  searchParams,
}: {
  // ?q=name filter, ?page=N. A Promise in Next.js 15+.
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const sp = await searchParams
  const q = sp.q?.trim() || undefined
  const page = Math.max(1, Number(sp.page) || 1)

  // Name contains the filter (served by the trigram index on legalName), or
  // the filter is exactly one of its brand names.
  const where: Prisma.CompanyWhereInput = q
    ? {
        ...VETTED_COMPANIES,
        OR: [{ legalName: { contains: q, mode: 'insensitive' } }, { dbaNames: { has: q } }],
      }
    : VETTED_COMPANIES

  const [total, companies] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      select: {
        id: true,
        legalName: true,
        dbaNames: true,
        businessRole: true,
        parentCompany: { select: { id: true, legalName: true } },
        _count: { select: { products: true, subsidiaries: true } },
      },
      // Alphabetical, with id as a tie-break so pages never overlap.
      orderBy: [{ legalName: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ])
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <TopNav />
      <AisleBar />
      {/* Breadcrumb removed 2026-10-08 with the other eight; see BackLink in
          SiteChrome.tsx for why. This page is a top-level index reached from
          the nav, so there is no parent to name and nothing to go back to —
          the same situation as /ingredients, and it loses nothing.

          The one case with an argument for a link was a search within this
          page (q set), where the trail offered "Companies" to clear it. The
          search box on the page already does that.

          NOTE: this file is CRLF while the rest of src/ is LF. Pre-existing,
          left alone deliberately — converting it would show the whole file as
          changed in the diff for no reason. */}

      {/* PAGE HEADER */}
      <div
        style={{
          boxSizing: 'border-box',
          padding: `22px ${layout.gutter}px 0`,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: font.display,
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: '-0.015em',
            }}
          >
            {q ? `Companies matching “${q}”` : 'Companies'}
          </h1>
          <div style={{ marginTop: 8, fontSize: 13, color: colors.ink2 }}>
            <span style={{ fontFamily: font.mono, color: colors.ink }}>{total.toLocaleString()}</span>{' '}
            {q ? (total === 1 ? 'company' : 'companies') : 'verified companies, A–Z'}
          </div>
        </div>

        {/* A plain GET form: the filter is a URL that can be bookmarked or
            shared, and the back button works. */}
        <form action="/companies" style={{ display: 'flex', width: 420, maxWidth: '100%' }}>
          <label htmlFor="company-q" className="sr-only">
            Filter companies by name
          </label>
          <input
            id="company-q"
            name="q"
            type="search"
            defaultValue={q ?? ''}
            placeholder="Filter by company or brand name"
            style={{
              flexGrow: 1,
              minWidth: 0,
              height: 40,
              boxSizing: 'border-box',
              padding: '0 14px',
              fontFamily: 'inherit',
              fontSize: 14,
              color: colors.ink,
              background: colors.card,
              border: `1px solid ${colors.lineStrong}`,
              borderRight: 0,
              borderRadius: '6px 0 0 6px',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            style={{
              height: 40,
              padding: '0 18px',
              fontSize: 14,
              fontWeight: 600,
              color: '#FFFFFF',
              background: colors.link,
              border: `1px solid ${colors.link}`,
              borderRadius: '0 6px 6px 0',
              cursor: 'pointer',
            }}
          >
            Filter
          </button>
        </form>
      </div>

      {/* LIST */}
      <div
        style={{
          flexGrow: 1,
          boxSizing: 'border-box',
          padding: `20px ${layout.gutter}px 0`,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {companies.length === 0 ? (
          <Callout state="nothingOnFile">
            {q ? (
              <>
                No verified company in our records matches <strong>{q}</strong>. That means it is
                missing from our database, not that the company does not exist.
              </>
            ) : (
              <>No verified companies in our database yet.</>
            )}
          </Callout>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 10,
            }}
          >
            {companies.map((c) => (
              <CompanyCard key={c.id} company={c} />
            ))}
          </div>
        )}

        <Pagination page={page} lastPage={lastPage} q={q} />
      </div>

      <SiteFooter />
    </>
  )
}

function CompanyCard({
  company,
}: {
  company: {
    id: string
    legalName: string
    dbaNames: string[]
    businessRole: string | null
    parentCompany: { id: string; legalName: string } | null
    _count: { products: number; subsidiaries: number }
  }
}) {
  const role =
    company.businessRole === 'retailer' ? 'Retailer' : company.businessRole === 'supply_chain' ? 'Supply chain' : null
  return (
    <Link
      href={`/companies/${company.id}`}
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        boxSizing: 'border-box',
        padding: '13px 15px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderRadius: layout.radius,
        textDecoration: 'none',
        color: 'inherit',
        minWidth: 0,
      }}
    >
      <Monogram name={company.legalName} size={40} />
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        {role && (
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: colors.ink3,
              marginBottom: 3,
            }}
          >
            {role}
          </div>
        )}
        <div
          style={{
            fontFamily: font.display,
            fontSize: 16,
            fontWeight: 600,
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {company.legalName}
        </div>
        {company.dbaNames.length > 0 && (
          <div
            style={{
              fontSize: 12,
              color: colors.ink3,
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            Also sold as {company.dbaNames.join(', ')}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
          <span style={{ fontSize: 12, color: colors.ink2 }}>
            <span style={{ fontFamily: font.mono, fontWeight: 500, color: colors.ink }}>
              {company._count.products.toLocaleString()}
            </span>{' '}
            {company._count.products === 1 ? 'product' : 'products'}
          </span>
          {company._count.subsidiaries > 0 && (
            <StatusChip state="ownership" bold={false}>
              Owns {company._count.subsidiaries} {company._count.subsidiaries === 1 ? 'brand' : 'brands'}
            </StatusChip>
          )}
          {company.parentCompany && (
            <StatusChip state="ownership" bold={false} title={`Owned by ${company.parentCompany.legalName}`}>
              Owned by {company.parentCompany.legalName}
            </StatusChip>
          )}
        </div>
      </div>
    </Link>
  )
}

function Pagination({ page, lastPage, q }: { page: number; lastPage: number; q?: string }) {
  if (lastPage <= 1) return null
  const url = (p: number) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (p > 1) params.set('page', String(p))
    const s = params.toString()
    return s ? `/companies?${s}` : '/companies'
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        marginTop: 6,
        fontSize: 13.5,
      }}
    >
      {page > 1 ? <Link href={url(page - 1)}>&larr; Previous</Link> : <span />}
      <span style={{ color: colors.ink3, fontFamily: font.mono, fontSize: 12.5 }}>
        {page} / {lastPage.toLocaleString()}
      </span>
      {page < lastPage ? <Link href={url(page + 1)}>Next &rarr;</Link> : <span />}
    </div>
  )
}

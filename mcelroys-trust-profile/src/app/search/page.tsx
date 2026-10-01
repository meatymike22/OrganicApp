import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { colors, font, layout, status } from '@/lib/design'
import { describeCategory } from '@/lib/categoryDisplay'
import { mostToReadAbout, productSignals, type ProductForSignals } from '@/lib/productSignals'
import { getRecallsListingProducts } from '@/lib/recalls'
import { normalizeUpc } from '@/lib/upc'
import { CategoryGlyph } from '@/components/CategoryGlyph'
import { AisleBar, Breadcrumb, SiteFooter, TopNav } from '@/components/SiteChrome'
import { SignalHeader, SignalStrip, StatusLegend } from '@/components/StatusChip'

export const metadata = { title: 'Search' }

// How many rows one page of results holds.
const PAGE_SIZE = 25

// Everything a result row needs, in one query. Kept as a named constant so
// the type in productSignals.ts and the query here can't drift apart.
const ROW_FIELDS = {
  id: true,
  name: true,
  upc: true,
  category: true,
  categorySource: true,
  productType: true,
  ingredientDisclosureStatus: true,
  ingredientCheckedAt: true,
  productIngredients: { select: { ingredient: { select: { flaggedForResearch: true } } } },
  certifications: { select: { certificationStatus: true, lastVerifiedDate: true } },
  productCertifications: { select: { scheme: true, status: true, lastVerifiedDate: true } },
  company: {
    select: {
      id: true,
      legalName: true,
      vettingStatus: true,
      parentCompany: { select: { id: true, legalName: true } },
    },
  },
} as const

// Builds the Prisma `where` from the URL. Three independent filters, all
// optional, all reflected in the URL so a filtered view can be shared.
async function buildWhere(q: string | undefined, aisle: string | undefined): Promise<Prisma.ProductWhereInput> {
  const and: Prisma.ProductWhereInput[] = [
    // A product whose company a reviewer has rejected (junk brand text, a
    // duplicate) is kept in the database only so bulk ingestion does not
    // recreate it. It must never appear in results.
    { company: { vettingStatus: { not: 'rejected' } } },
  ]

  if (aisle) {
    and.push({ category: { contains: aisle, mode: 'insensitive' } })
  }

  if (q) {
    // A barcode is an exact identifier, so if the query looks like one, that
    // is what the shopper means — searching product names for "038000315152"
    // would return nothing and look broken.
    const upc = normalizeUpc(q)
    if (upc.ok) {
      and.push({ upc: upc.upc })
    } else {
      // PERFORMANCE: done in two steps rather than one OR across both tables.
      // "name matches OR the company's name matches" written as one query
      // makes Postgres read every product (~2 s). Finding the matching
      // companies first (fast, trigram index on Company) and then asking for
      // "name matches OR companyId is one of these" lets it use the product
      // name index and the companyId index together. Same results either way.
      const companies = await prisma.company.findMany({
        where: {
          OR: [{ legalName: { contains: q, mode: 'insensitive' } }, { dbaNames: { has: q } }],
        },
        select: { id: true },
      })
      const companyIds = companies.map((c) => c.id)
      and.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          ...(companyIds.length > 0 ? [{ companyId: { in: companyIds } }] : []),
        ],
      })
    }
  }

  return { AND: and }
}

export default async function SearchPage({
  searchParams,
}: {
  // In Next.js 15+ the query string arrives as a Promise and has to be
  // awaited before it can be read — same as `params` on the company page.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const q = first(sp.q)?.trim() || undefined
  const aisle = first(sp.aisle)?.trim() || undefined
  const page = Math.max(1, Number(first(sp.page) ?? 1) || 1)

  const where = await buildWhere(q, aisle)

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: ROW_FIELDS,
      // A stable secondary sort on id matters: without it, two products with
      // the same name can swap places between page 1 and page 2 and a shopper
      // sees one twice and another not at all.
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ])

  // Which of these products a government notice actually lists by barcode.
  // One query for the whole page rather than one per row.
  const listedRecalls = await getRecallsListingProducts(rows.map((r) => r.id))

  // Work out the five signals per row, then order the page by how much there
  // is to read. The sort happens here rather than in SQL because the states
  // are derived from several tables at once — see productSignals.ts.
  const results = rows
    .map((r) => ({
      product: r,
      signals: productSignals(r as unknown as ProductForSignals, listedRecalls.get(r.id)),
    }))
    .sort((a, b) => mostToReadAbout(a.signals, b.signals))

  // The counts above the list. Derived from the rows on screen, so the
  // wording says "on this page" and cannot overstate what it covers.
  const tally = {
    recall: results.filter((r) => r.signals.some((s) => s.state === 'recall')).length,
    flagged: results.filter((r) => r.signals.some((s) => s.state === 'openResearch')).length,
    clean: results.filter(
      (r) => r.signals.filter((s) => s.column !== 'owner').every((s) => s.state === 'confirmed' || s.state === 'notApplicable')
    ).length,
    unchecked: results.filter((r) => r.signals.some((s) => s.state === 'unchecked')).length,
  }

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <TopNav query={q} />
      <AisleBar active={aisle} />
      <Breadcrumb
        trail={[
          { label: 'Rootify', href: '/' },
          { label: q ? `Search: ${q}` : aisle ? `Aisle: ${aisle}` : 'All products' },
        ]}
      />

      {/* PAGE HEADER */}
      <div style={{ boxSizing: 'border-box', padding: `22px ${layout.gutter}px 0` }}>
        <h1
          style={{
            margin: 0,
            fontFamily: font.display,
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: '-0.015em',
          }}
        >
          {q ? `“${q}”` : aisle ? `${aisle} aisle` : 'Everything we have read'}
        </h1>
        <div style={{ marginTop: 12 }}>
          <StatusLegend />
        </div>
      </div>

      {/* BODY: filter rail on the left, results on the right */}
      <div
        style={{
          flexGrow: 1,
          boxSizing: 'border-box',
          padding: `18px ${layout.gutter}px 0`,
          display: 'flex',
          gap: 26,
          alignItems: 'flex-start',
        }}
      >
        <FilterRail q={q} aisle={aisle} />

        <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* The count strip. Each number is a link-free statement of fact
              about the rows below it. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '6px 14px',
              fontSize: 12.5,
              color: colors.ink2,
            }}
          >
            <span>
              Showing{' '}
              <strong style={{ color: colors.ink, fontWeight: 600 }}>{results.length}</strong> of{' '}
              <span style={{ fontFamily: font.mono }}>{total}</span>
            </span>
            {tally.recall > 0 && <Tally color={status.recall.fg} text={`${tally.recall} with a recall`} />}
            {tally.flagged > 0 && <Tally color={status.openResearch.fg} text={`${tally.flagged} with flagged ingredients`} />}
            {tally.clean > 0 && <Tally color={status.confirmed.fg} text={`${tally.clean} confirmed with nothing flagged`} />}
            {tally.unchecked > 0 && <Tally color={status.unchecked.fg} text={`${tally.unchecked} we couldn't check`} />}
          </div>

          {results.length === 0 ? (
            <EmptyState q={q} aisle={aisle} />
          ) : (
            <>
              <SignalHeader />
              {results.map(({ product, signals }) => (
                <ResultRow key={product.id} product={product} signals={signals} />
              ))}
              <Pagination page={page} lastPage={lastPage} q={q} aisle={aisle} />
            </>
          )}
        </div>
      </div>

      <SiteFooter />
    </>
  )
}

function Tally({ color, text }: { color: string; text: string }) {
  return (
    <>
      <span style={{ color: '#C9C2B2' }} aria-hidden>
        |
      </span>
      <span style={{ color, fontWeight: 600 }}>{text}</span>
    </>
  )
}

// One result. The whole row is a link, and the left border carries the colour
// of its most-pressing status so the shape of the page is readable before any
// word is.
function ResultRow({
  product,
  signals,
}: {
  product: { id: string; name: string; upc: string | null; category: string | null; categorySource: string | null; productType: string; company: { legalName: string } }
  signals: ReturnType<typeof productSignals>
}) {
  // The border colour comes from the first signal that is not just "fine" —
  // the same order the page is sorted in.
  const lead =
    signals.find((s) => s.state === 'recall') ??
    signals.find((s) => s.state === 'openResearch') ??
    signals.find((s) => s.state === 'unchecked') ??
    signals.find((s) => s.state === 'confirmed')

  const borderColor = status[lead?.state ?? 'confirmed'].fg

  const cat = describeCategory(product.category, product.categorySource)

  return (
    <Link
      href={`/products/${product.id}`}
      style={{
        display: 'flex',
        gap: 15,
        alignItems: 'center',
        boxSizing: 'border-box',
        padding: '13px 16px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: layout.radius,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <CategoryGlyph
        category={product.category}
        productType={product.productType}
        size={66}
        label={product.name}
      />

      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
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
              style={{ padding: '2px 6px', background: '#EFEADD', borderRadius: 3, color: colors.ink2 }}
            >
              {cat.label}
            </span>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {product.company.legalName}
          </span>
        </div>

        <div
          style={{
            fontFamily: font.display,
            fontSize: 18,
            fontWeight: 600,
            lineHeight: 1.25,
            marginTop: 3,
          }}
        >
          {product.name}
        </div>

        <div style={{ marginTop: 7 }}>
          <SignalStrip signals={signals} />
        </div>
      </div>

      <span style={{ fontSize: 22, color: colors.link, flexShrink: 0 }} aria-hidden>
        &rsaquo;
      </span>
    </Link>
  )
}

// The filter rail. Plain links, not checkboxes, because every filter is in
// the URL — which means the back button works and a filtered search can be
// pasted to somebody else.
function FilterRail({ q, aisle }: { q?: string; aisle?: string }) {
  const base = q ? `?q=${encodeURIComponent(q)}` : '?'
  return (
    <aside style={{ width: 224, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          boxSizing: 'border-box',
          padding: '14px 15px',
          background: colors.card,
          border: `1px solid ${colors.line}`,
          borderRadius: layout.radius,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: colors.ink2,
          }}
        >
          Aisle
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10, fontSize: 13.5 }}>
          {aisle ? (
            <Link href={base === '?' ? '/search' : `/search${base}`}>Clear aisle filter</Link>
          ) : (
            <span style={{ color: colors.ink3 }}>Pick one from the bar above.</span>
          )}
        </div>
      </div>

      <div
        style={{
          boxSizing: 'border-box',
          padding: '14px 15px',
          background: colors.panel,
          border: `1px solid ${colors.line}`,
          borderRadius: layout.radius,
          fontSize: 12.5,
          lineHeight: 1.55,
          color: colors.ink2,
        }}
      >
        <strong style={{ color: colors.ink }}>How this list is ordered</strong>
        <p style={{ margin: '6px 0 0' }}>
          Most to read about first: recalls, then ingredients with open research, then products we
          have not been able to check. It is not a ranking of which products are better.
        </p>
      </div>
    </aside>
  )
}

// What a shopper sees when nothing matched. An empty result is our gap, not
// a statement that the product does not exist — so the page says which, and
// offers the one useful next step.
function EmptyState({ q, aisle }: { q?: string; aisle?: string }) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        padding: '26px 24px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderRadius: layout.radius,
      }}
    >
      <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 600 }}>
        We haven&apos;t read this one yet
      </div>
      <p style={{ margin: '9px 0 0', fontSize: 14, lineHeight: 1.6, color: colors.ink2, maxWidth: 560 }}>
        {q ? (
          <>
            Nothing in our records matches <strong>{q}</strong>.
          </>
        ) : aisle ? (
          <>We have not read anything in the {aisle} aisle yet.</>
        ) : (
          <>There is nothing in our records yet.</>
        )}{' '}
        That means it is missing from our database, not that there is nothing on the public record
        about it.
      </p>
    </div>
  )
}

function Pagination({ page, lastPage, q, aisle }: { page: number; lastPage: number; q?: string; aisle?: string }) {
  if (lastPage <= 1) return null
  const url = (p: number) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (aisle) params.set('aisle', aisle)
    if (p > 1) params.set('page', String(p))
    const s = params.toString()
    return s ? `/search?${s}` : '/search'
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
        {page} / {lastPage}
      </span>
      {page < lastPage ? <Link href={url(page + 1)}>Next &rarr;</Link> : <span />}
    </div>
  )
}

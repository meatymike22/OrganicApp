import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { colors, font, layout, status, thumbTint } from '@/lib/design'
import { describeCategory } from '@/lib/categoryDisplay'
import { mostToReadAbout, productSignals, type ProductForSignals } from '@/lib/productSignals'
import { getRecallsListingProducts } from '@/lib/recalls'
import { productDisplayName } from '@/lib/productName'
import { normalizeUpc } from '@/lib/upc'
import { ProductThumb } from '@/components/ProductThumb'
import { AISLES, AisleBar, Breadcrumb, SiteFooter, TopNav } from '@/components/SiteChrome'
import { SignalHeader, SignalStrip, StatusKeyPanel } from '@/components/StatusChip'

export const metadata = { title: 'Search' }

// The page content sits inside this, centred, rather than running the whole
// width of the window. Same value the landing page uses, so a result row and
// a landing-page section line up at the same edges.
const SHELL: CSSProperties = {
  maxWidth: '1320px',
  marginLeft: 'auto',
  marginRight: 'auto',
  width: '100%',
}

// How many rows one page of results holds.
const PAGE_SIZE = 25

// The thumbnail size on a result row.
//
// Fluid rather than fixed, for the reason Michael gave: at a flat 66px a
// package was too small to recognise on a monitor, and anything big enough to
// read on a monitor is overbearing on a phone, where it would crowd out the
// name and the chips. clamp() lets the same row serve both — 76px on a phone,
// growing to 104px once there is room for it.
//
// It has to be a CSS string, not a number, which is why ProductThumb and
// CategoryGlyph both size themselves in em: there is no pixel value here to
// multiply for the icon or the corner radius.
const THUMB = 'clamp(76px, 7.5vw, 104px)'

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
  ingredientSource: true,
  imageUrl: true,
  imageSource: true,
  imageSourceUrl: true,
  productIngredients: {
    select: {
      listPosition: true,
      ingredient: { select: { name: true, flaggedForResearch: true } },
    },
  },
  certifications: { select: { certificationStatus: true, lastVerifiedDate: true } },
  productCertifications: { select: { scheme: true, status: true, lastVerifiedDate: true } },
  company: {
    select: {
      id: true,
      legalName: true,
      dbaNames: true,
      vettingStatus: true,
      parentCompany: { select: { id: true, legalName: true } },
    },
  },
} as const

// Builds the Prisma `where` from the URL. Three independent filters, all
// optional, all reflected in the URL so a filtered view can be shared.
// How many rejected companies it is still worth naming individually. A
// reviewer rejects brands by hand, so the real number is dozens; this only
// guards against a runaway automated rejection producing a giant IN list.
const MAX_REJECTED_IDS = 2000

async function buildWhere(q: string | undefined, aisle: string | undefined): Promise<Prisma.ProductWhereInput> {
  const and: Prisma.ProductWhereInput[] = []

  // A product whose company a reviewer has rejected (junk brand text, a
  // duplicate) is kept in the database only so bulk ingestion does not
  // recreate it. It must never appear in results.
  //
  // PERFORMANCE: written as "not one of these companies" rather than
  // "company.vettingStatus is not rejected", for the same reason the product
  // search below is done in two steps. The relation form makes Postgres read
  // every product and hash-join every company — 1.03 s just to count the
  // results. Finding the rejected companies first is an index scan on
  // Company_vettingStatus_idx (0.1 ms, and usually no rows at all), and when
  // there are none the clause disappears entirely, which lets the count run
  // as an index-only scan: 104 ms instead of 1030 ms.
  //
  // The exclusion itself is NOT taken from Product.sourceRank, even though
  // the rank knows about vetting. A rank is denormalised and can go stale,
  // and "this company was rejected" is a visibility rule — getting it wrong
  // means publishing a record a reviewer threw out. Order of rows can be
  // stale; what appears at all cannot.
  const rejected = await prisma.company.findMany({
    where: { vettingStatus: 'rejected' },
    select: { id: true },
    take: MAX_REJECTED_IDS + 1,
  })
  if (rejected.length > MAX_REJECTED_IDS) {
    // Too many to name. Fall back to the slow-but-correct form.
    and.push({ company: { vettingStatus: { not: 'rejected' } } })
  } else if (rejected.length > 0) {
    and.push({ companyId: { notIn: rejected.map((c) => c.id) } })
  }

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

  // NOTHING ASKED FOR YET.
  //
  // With no search term and no aisle, the old page answered a question nobody
  // had asked: here are 416,382 products, alphabetically. That is not a
  // starting point, it is a data dump — and because it sorts by name, the
  // first thing anyone saw was the untidiest end of the catalogue.
  //
  // So this returns before touching the database. The start screen below is
  // the whole page, and the default /search is now instant instead of being
  // the most expensive query on the site.
  //
  // Deliberately NOT the same thing as the empty state further down: "you
  // have not asked yet" and "we looked and found nothing" are different
  // facts, and this site does not blur those.
  if (!q && !aisle) {
    return (
      <>
        <TopNav />
        <AisleBar />
        <Breadcrumb trail={[{ label: 'Rootify', href: '/' }, { label: 'Products' }]} />
        <StartHere />
        <SiteFooter />
      </>
    )
  }

  const where = await buildWhere(q, aisle)

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: ROW_FIELDS,
      // Best-sourced products first, then alphabetical, then id.
      //
      // sourceRank is a small integer on Product itself (10 = a person
      // confirmed the company, 20 = USDA barcode records, 40 = automated
      // review only, 90 = not confirmed). Sorting on it instead of on the
      // company's vetting columns is the whole point of the column: all three
      // keys live together in Product_sourceRank_name_id_idx, so this is an
      // index scan. Ordering across the join was a full sort of 411k rows and
      // took 2.17 s for page 1; this takes 8 ms.
      //
      // The stable id at the end matters on its own: without it, two products
      // with the same name and rank can swap places between page 1 and page 2,
      // and a shopper sees one twice and another not at all.
      orderBy: [{ sourceRank: 'asc' }, { name: 'asc' }, { id: 'asc' }],
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
          { label: q ? `Search: ${q}` : `Aisle: ${aisle}` },
        ]}
      />

      {/* PAGE HEADER */}
      <div style={{ ...SHELL, boxSizing: 'border-box', padding: `22px clamp(18px, 4vw, ${layout.gutter}px) 0` }}>
        <h1
          style={{
            margin: 0,
            fontFamily: font.display,
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: '-0.015em',
          }}
        >
          {q ? `“${q}”` : `${aisle} aisle`}
        </h1>
      </div>

      {/* BODY: filter rail on the left, results on the right */}
      <div
        style={{
          flexGrow: 1,
          boxSizing: 'border-box',
          ...SHELL,
          padding: `18px clamp(18px, 4vw, ${layout.gutter}px) 0`,
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
              <SignalHeader thumbWidth={THUMB} />
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

// THE START SCREEN — what /search shows before anybody has asked anything.
//
// Michael: "Initially there shouldn't be anything showing. The page should be
// blank with some flair... This is a case ONLY if no filter has been applied."
//
// Then, on the examples: "make sure to include an image alongside this",
// "include a barcode picture here as well", and "figure out a way to include
// this with the brand itself so it looks like a package... put this
// vertically over or under the brand."
//
// So each example is a card with a drawn package above its label. The
// drawings are inline SVG rather than photographs on purpose: a photograph
// here would need a licence and a credit, could rot when somebody else's URL
// moves, and would promise a specific product when the point is the KIND of
// thing you can type. A jar, a flour sack and a barcode say that with no
// strings attached — and they speak the same visual language as the aisle
// glyphs in CategoryGlyph.
//
// Each href is a live query that returns results today, and between the three
// they show the three different things the search bar accepts: a kind of
// food, a brand, and a barcode.
const EXAMPLES: { label: string; href: string; note: string; art: React.ReactNode }[] = [
  {
    label: 'peanut butter',
    href: '/search?q=peanut+butter',
    note: 'a kind of food',
    // A jar: straight sides, a shoulder, a lid.
    art: (
      <>
        <path d="M17 19h30v26a4 4 0 0 1-4 4H21a4 4 0 0 1-4-4V19z" />
        <path d="M20 15h24v4H20z" />
        <path d="M26 11h12v4H26z" />
        <path d="M22 28h20" />
        <path d="M22 35h13" />
      </>
    ),
  },
  {
    label: 'King Arthur',
    href: '/search?q=King+Arthur',
    note: 'a brand',
    // A flour sack: pinched and folded at the top, wider at the base.
    art: (
      <>
        <path d="M21 17c0-2 3-4 11-4s11 2 11 4l3 28a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4l3-28z" />
        <path d="M21 17c3 2 19 2 22 0" />
        <path d="M25 29h14" />
        <path d="M25 36h9" />
      </>
    ),
  },
  {
    label: '0071012075379',
    href: '/search?q=0071012075379',
    note: 'a barcode',
    // An actual barcode: varied bar widths, with the quiet margins a real
    // symbol has.
    art: (
      <>
        <path d="M16 16v26M20 16v26M23 16v22M27 16v26M31 16v22M34 16v26M38 16v26M42 16v22M46 16v26" />
        <path d="M13 46h38" strokeWidth={1.2} />
      </>
    ),
  },
]

function StartHere() {
  return (
    <div
      style={{
        ...SHELL,
        flexGrow: 1,
        boxSizing: 'border-box',
        padding: `clamp(28px, 6vw, 64px) clamp(18px, 4vw, ${layout.gutter}px) 48px`,
      }}
    >
      {/* THE ASK. Deliberately a question, not a label: the page's job here is
          to hand the shopper back the initiative. */}
      <h1
        style={{
          margin: 0,
          fontFamily: font.display,
          fontSize: 'clamp(32px, 5.5vw, 54px)',
          fontWeight: 600,
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
          maxWidth: '16ch',
        }}
      >
        What are you
        <br />
        buying?
        <span style={{ color: colors.link }}>.</span>
      </h1>

      <p
        style={{
          margin: '18px 0 0',
          fontSize: 'clamp(15px, 1.6vw, 17.5px)',
          lineHeight: 1.6,
          color: colors.ink2,
          maxWidth: '54ch',
        }}
      >
        Type a product, a brand, or a barcode in the bar above. You will get what the public record
        says — and, just as plainly, what it does not.
      </p>

      {/* Examples. Real links, real results, and a drawn package each. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 190px))',
          gap: 12,
          marginTop: 26,
        }}
      >
        {EXAMPLES.map((e) => (
          <Link
            key={e.href}
            href={e.href}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              boxSizing: 'border-box',
              padding: '16px 14px 14px',
              background: colors.card,
              border: `1px solid ${colors.line}`,
              borderRadius: layout.radius,
              textDecoration: 'none',
              color: colors.ink,
              textAlign: 'center',
            }}
          >
            {/* The package sits on the same warm tint the thumbnails use, so
                a card here and a product row later read as one system. */}
            <span
              aria-hidden
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 76,
                height: 76,
                background: thumbTint.ambient,
                border: `1px solid ${colors.line}`,
                borderRadius: 8,
                marginBottom: 10,
              }}
            >
              <svg
                width="44"
                height="44"
                viewBox="0 0 64 64"
                fill="none"
                stroke="#9C9382"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {e.art}
              </svg>
            </span>
            <span
              style={{
                fontFamily: /^\d+$/.test(e.label) ? font.mono : undefined,
                fontSize: /^\d+$/.test(e.label) ? 12.5 : 14.5,
                fontWeight: 600,
                lineHeight: 1.3,
                wordBreak: /^\d+$/.test(e.label) ? 'break-all' : undefined,
              }}
            >
              {e.label}
            </span>
            <span style={{ fontSize: 11.5, color: colors.ink4 }}>{e.note}</span>
          </Link>
        ))}
      </div>

      <hr
        style={{
          border: 0,
          borderTop: `1px solid ${colors.line}`,
          margin: 'clamp(30px, 5vw, 52px) 0 0',
        }}
      />

      {/* THE AISLES, laid out the way a store is walked — the same list and the
          same order as the bar at the top of the page, from SiteChrome. */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: colors.ink3,
          margin: '26px 0 0',
        }}
      >
        Or walk the aisles
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(146px, 1fr))',
          gap: 10,
          marginTop: 14,
        }}
      >
        {AISLES.map((a) => (
          <Link
            key={a.q}
            href={`/search?aisle=${a.q}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              boxSizing: 'border-box',
              padding: '14px 15px',
              background: colors.card,
              border: `1px solid ${colors.line}`,
              borderRadius: layout.radius,
              textDecoration: 'none',
              color: colors.ink,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9C9382"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
              aria-hidden
            >
              {a.path}
            </svg>
            {a.label}
          </Link>
        ))}
      </div>

      {/* One quiet line of method. No counts: a number here would be a boast,
          and the thing worth saying about Rootify is how a line gets onto a
          page, not how many there are. */}
      <p
        style={{
          margin: 'clamp(26px, 4vw, 40px) 0 0',
          fontSize: 13,
          lineHeight: 1.6,
          color: colors.ink3,
          maxWidth: '62ch',
        }}
      >
        Every line on a product page is a public record, shown with the date we read it. Where there
        is no record, it says so. Where we have not been able to look, it says that instead —{' '}
        <Link href="/faq">those are different things</Link>.
      </p>
    </div>
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
  product: {
    id: string
    name: string
    upc: string | null
    category: string | null
    categorySource: string | null
    productType: string
    ingredientDisclosureStatus: string
    ingredientSource: string | null
    productIngredients: { listPosition: number | null; ingredient: { name: string; flaggedForResearch: boolean } }[]
    imageUrl: string | null
    imageSource: string | null
    imageSourceUrl: string | null
    company: { legalName: string; dbaNames: string[] }
  }
  signals: ReturnType<typeof productSignals>
}) {
  // The company name is printed on the line above, so the brand is stripped
  // off the front of the product name here rather than said twice.
  const title = productDisplayName(product.name, product.company.legalName, product.company.dbaNames)
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
        // 7px, not the 4px hairline it started as: this bar is the only
        // thing on the row that is readable before any word is, so it has to
        // register from across the page.
        borderLeft: `7px solid ${borderColor}`,
        borderRadius: layout.radius,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <ProductThumb
        product={product}
        category={product.category}
        productType={product.productType}
        size={THUMB}
        label={title}
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
          {title}
        </div>

        <IngredientPreview product={product} />

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


// WHAT A PRODUCT ACTUALLY IS, in one line, without clicking through.
//
// Michael asked for "a short description, like Amazon's search results, so
// they don't have to open the product to decide". Rootify has no description
// column and should not grow one: a description is marketing copy, and
// nothing on a product page is allowed to be something we wrote rather than
// something we read.
//
// What we do hold is the ingredient list in label order, which is better than
// a description anyway — label order is roughly descending by weight, so the
// first few ingredients tell you what the product mostly IS. Flagged ones are
// coloured so the amber chip has something to point at.
function IngredientPreview({
  product,
}: {
  product: {
    ingredientDisclosureStatus: string
    ingredientSource: string | null
    productIngredients: { listPosition: number | null; ingredient: { name: string; flaggedForResearch: boolean } }[]
  }
}) {
  const line: CSSProperties = {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: colors.ink3,
    marginTop: 5,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }

  // The two honest non-answers. Worded the way the schema asks: "unchecked"
  // must say nothing about disclosure, and "not_disclosed" means not found in
  // the sources we check, not that no list exists anywhere.
  if (product.ingredientDisclosureStatus === 'unchecked') {
    return <div style={{ ...line, fontStyle: 'italic' }}>We haven&apos;t looked up what&apos;s in this one yet.</div>
  }
  if (product.ingredientDisclosureStatus === 'not_disclosed') {
    return <div style={{ ...line, fontStyle: 'italic' }}>No ingredient list published in any source we check.</div>
  }

  const ordered = [...product.productIngredients].sort(
    (a, b) => (a.listPosition ?? Number.MAX_SAFE_INTEGER) - (b.listPosition ?? Number.MAX_SAFE_INTEGER)
  )
  if (ordered.length === 0) return null

  const shown = ordered.slice(0, 5)
  const rest = ordered.length - shown.length

  return (
    <div style={line} title={ordered.map((pi) => pi.ingredient.name).join(', ')}>
      {shown.map((pi, i) => (
        <span key={pi.ingredient.name}>
          {i > 0 && ', '}
          <span
            style={
              pi.ingredient.flaggedForResearch
                ? { color: status.openResearch.fg, fontWeight: 600 }
                : undefined
            }
          >
            {pi.ingredient.name}
          </span>
        </span>
      ))}
      {rest > 0 && <span style={{ color: colors.ink4 }}>{` + ${rest} more`}</span>}
    </div>
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

      <StatusKeyPanel />

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

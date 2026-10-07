import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { colors, font, layout, status, thumbTint } from '@/lib/design'
import { describeCategory } from '@/lib/categoryDisplay'
import { mostToReadAbout, productSignals, type ProductForSignals, type Signal } from '@/lib/productSignals'
import { getRecallsListingProducts } from '@/lib/recalls'
import { productDisplayName, shortProductName } from '@/lib/productName'
import { normalizeUpc } from '@/lib/upc'
// Only a confirmed company gets a page worth linking an example card to.
import { VETTED_COMPANIES } from '@/lib/vetting'
import {
  EMPTY_FILTERS,
  hasAnyFilter,
  INGREDIENT_FILTERS,
  ingredientFilterParams,
  ingredientFilterWhere,
  needsExactCount,
  parseIngredientFilters,
  removeTerm,
  toggleFilterKey,
  type IngredientFilterState,
} from '@/lib/ingredientFilters'
import { ProductThumb } from '@/components/ProductThumb'
import { IngredientExcludeBox } from '@/components/IngredientExcludeBox'
import { AISLES, AisleBar, aisleCategories, aisleLabel, Breadcrumb, SiteFooter, TopNav } from '@/components/SiteChrome'
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
// HOW MANY ROWS PER PAGE. Michael asked for 50 and 100 as options.
// Anything not in this list falls back to the default rather than being
// honoured — ?per=100000 would otherwise be a way for a crawler to ask
// for the whole catalogue in one query.
const PAGE_SIZES = [25, 50, 100] as const
const DEFAULT_PAGE_SIZE = 25

function resolvePageSize(raw: string | undefined): number {
  const n = Number(raw)
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE
}

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

async function buildWhere(
  q: string | undefined,
  aisle: string | undefined,
  filters: IngredientFilterState
): Promise<Prisma.ProductWhereInput> {
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

  // AISLE. Resolved through the explicit aisle -> category map in
  // SiteChrome.tsx, not by substring. The old form was
  //     category: { contains: aisle }
  // which meant ?aisle=drink looked for a category containing "drink".
  // Ours are called "Beverage", "Juice" and "Coffee & Tea", so the Drinks
  // tab returned nothing while the database held 40,840 drinks. Pantry was
  // the same, with ~114,000 products behind a dead tab.
  //
  // An UNKNOWN aisle slug returns no products rather than all of them.
  // `aisleCategories` gives null for a slug it does not recognise, and a
  // null must not quietly mean "no filter" — a bad link in the wild would
  // then render the whole catalogue under someone else's heading.
  // Ingredient exclusions. One NOT EXISTS each — see ingredientFilters.ts
  // for the measured cost and for why a free-text term matches ingredient
  // names by substring rather than exactly.
  and.push(...ingredientFilterWhere(filters))

  if (aisle) {
    const categories = aisleCategories(aisle)
    and.push(categories ? { category: { in: categories } } : { id: { in: [] } })
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

// LOADING A PAGE OF RESULTS.
//
// Extracted from the page component so the default /search can simply not
// call it. That is the whole mechanism behind "the landing page does not
// touch the database": not a flag, not a short-circuit inside the query, just
// an await that never happens.
async function loadResults(
  q: string | undefined,
  aisle: string | undefined,
  filters: IngredientFilterState,
  page: number,
  per: number
) {
  const where = await buildWhere(q, aisle, filters)

  // THE COUNT IS SKIPPED WHEN AN INGREDIENT FILTER IS ON.
  //
  // A page of filtered results is cheap because the anti-join stops once it
  // has enough rows (111 ms with two filters, 852 ms with all six). An exact
  // COUNT cannot stop: it has to decide all 416,382 products, which measured
  // at 5.3 s. So a filtered list fetches one row more than it shows and uses
  // that to know whether there is a next page, and says nothing about a
  // total. Saying nothing is the only honest cheap option — an estimate
  // printed as a count would be the first false number on the site. See
  // needsExactCount in ingredientFilters.ts.
  const exact = needsExactCount(filters)

  const [total, rows] = await Promise.all([
    exact ? prisma.product.count({ where }) : Promise.resolve(null),
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
      skip: (page - 1) * per,
      // One extra row, only when there is no exact count: its existence is
      // what tells us a next page exists. Dropped before rendering.
      take: exact ? per : per + 1,
    }),
  ])

  // The extra probe row is not shown; it only told us a next page exists.
  const hasMore = exact ? false : rows.length > per
  const pageRows = hasMore ? rows.slice(0, per) : rows

  // Which of these products a government notice actually lists by barcode.
  // One query for the whole page rather than one per row.
  const listedRecalls = await getRecallsListingProducts(pageRows.map((r) => r.id))

  // Work out the signals per row, then order the page by how much there is to
  // read. The sort happens here rather than in SQL because the states are
  // derived from several tables at once — see productSignals.ts.
  const results = pageRows
    .map((r) => ({
      product: r,
      signals: productSignals(r as unknown as ProductForSignals, listedRecalls.get(r.id)),
    }))
    .sort((a, b) => mostToReadAbout(a.signals, b.signals))

  return { total, hasMore, results }
}

type Loaded = Awaited<ReturnType<typeof loadResults>>

// Count rows on this page whose signals match. Zero when nothing was loaded,
// which keeps the tally code free of null checks at every call site.
function countWhere(loaded: Loaded | null, pred: (signals: Signal[]) => boolean): number {
  if (!loaded) return 0
  return loaded.results.filter((r) => pred(r.signals)).length
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
  const per = resolvePageSize(first(sp.per))
  const filters = parseIngredientFilters(first(sp.free), first(sp.without))

  // HAS ANYTHING BEEN ASKED YET?
  //
  // A search term, an aisle, or an ingredient filter all count. "Show me
  // anything without seed oils" is a question even with no words typed.
  const asking = Boolean(q || aisle || hasAnyFilter(filters))

  // THE DEFAULT PAGE IS THIS PAGE, not a separate one.
  //
  // Michael, 2026-10-07: "we want this page to instead be the product search
  // page but with no product objects viewable... the search landing page
  // should look similar to the search page when a filter has been applied."
  //
  // It used to be a wholly separate full-bleed layout (`StartHere`) with its
  // own header and no rail, so arriving at /search and then searching changed
  // the furniture under you — different heading, filters appearing from
  // nowhere, colour key appearing from nowhere. Now there is one layout: same
  // chrome, same rail, same filters, and the prompt sits exactly where the
  // product rows will be.
  //
  // It still does NOT touch the database when nothing has been asked, which
  // is the thing worth protecting here: the default /search was once the most
  // expensive query on the site, and `loadResults` is simply not called.
  const loaded = asking ? await loadResults(q, aisle, filters, page, per) : null

  // Derived from the rows on screen, so the wording cannot overstate what it
  // covers. Empty when nothing has been asked.
  const tally = {
    recall: countWhere(loaded, (s) => s.some((x) => x.state === 'recall')),
    flagged: countWhere(loaded, (s) => s.some((x) => x.state === 'openResearch')),
    clean: countWhere(loaded, (s) =>
      s.filter((x) => x.column !== 'owner').every((x) => x.state === 'confirmed' || x.state === 'notApplicable')
    ),
    unchecked: countWhere(loaded, (s) => s.some((x) => x.state === 'unchecked')),
  }

  // Null when there is no exact count; the pager then goes by hasMore.
  const lastPage =
    loaded === null || loaded.total === null ? null : Math.max(1, Math.ceil(loaded.total / per))

  // The two example photographs, looked up only on the page that shows them.
  const [photos, companies] =
    loaded === null
      ? await Promise.all([exampleProducts(), exampleCompanies()])
      : [null, null]

  return (
    <>
      <TopNav query={q} />
      <AisleBar active={aisle} />
      <Breadcrumb
        trail={[
          { label: 'Rootify', href: '/' },
          { label: q ? `Search: ${q}` : aisle ? `Aisle: ${aisleLabel(aisle)}` : 'Products' },
        ]}
      />

      {/* PAGE HEADER. Same furniture whether or not anything has been asked,
          so searching does not rearrange the page under the reader. */}
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
          {q ? `“${q}”` : aisle ? aisleLabel(aisle) : 'Products'}
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
        <FilterRail q={q} aisle={aisle} per={per} filters={filters} />

        <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loaded === null ? (
            // Nothing asked yet. Sits exactly where the rows go, so the page
            // does not change shape when the first search happens.
            <NothingAskedYet photos={photos!} companies={companies!} />
          ) : (
            <>
              {/* The count strip. Each number is a link-free statement of
                  fact about the rows below it. */}
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
                {/* "of 416,382" only when we actually counted. With an
                    ingredient filter on there is no total, and the line says
                    what it knows instead of estimating. */}
                <span>
                  Showing{' '}
                  <strong style={{ color: colors.ink, fontWeight: 600 }}>{loaded.results.length}</strong>
                  {loaded.total !== null && (
                    <>
                      {' '}
                      of <span style={{ fontFamily: font.mono }}>{loaded.total.toLocaleString()}</span>
                    </>
                  )}
                </span>
                {tally.recall > 0 && <Tally color={status.recall.fg} text={`${tally.recall} with a recall`} />}
                {tally.flagged > 0 && (
                  <Tally color={status.openResearch.fg} text={`${tally.flagged} with flagged ingredients`} />
                )}
                {tally.clean > 0 && (
                  <Tally color={status.confirmed.fg} text={`${tally.clean} confirmed with nothing flagged`} />
                )}
                {tally.unchecked > 0 && (
                  <Tally color={status.unchecked.fg} text={`${tally.unchecked} we couldn't check`} />
                )}
              </div>

              {loaded.results.length === 0 ? (
                <EmptyState q={q} aisle={aisle} filtered={hasAnyFilter(filters)} />
              ) : (
                <>
                  <SignalHeader thumbWidth={THUMB} />
                  {loaded.results.map(({ product, signals }) => (
                    <ResultRow key={product.id} product={product} signals={signals} />
                  ))}
                  <Pagination
                    page={page}
                    lastPage={lastPage}
                    hasMore={loaded.hasMore}
                    q={q}
                    aisle={aisle}
                    per={per}
                    total={loaded.total}
                    filters={filters}
                  />
                </>
              )}
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
// THE THREE EXAMPLE SEARCHES on the start screen.
//
// Michael: "these examples should have actual pictures of the product and
// brand as an example. pick a different one. Barcode can stay as is."
//
// So two of the three are now real products with their real photographs, and
// the examples changed to products we actually hold photos for — which is why
// King Arthur is no longer one of them. The barcode keeps its drawing,
// because there is nothing to photograph: the point of that card is that the
// search bar accepts a number off a packet.
//
// The photos are NOT hardcoded URLs. Each card names a barcode and the page
// looks the product up, so the image is whatever the database holds today and
// the CC-BY-SA credit travels with it through ProductThumb — which refuses
// to render a photo whose source it cannot name. A pasted CDN URL would have
// skipped that and gone stale the next time OFF bumped a revision.
//
// If an example barcode ever stops resolving, the card falls back to the
// aisle glyph rather than breaking: see ProductThumb's empty state.
const EXAMPLES: {
  label: string
  sub?: string
  href: string
  note: string
  // A product to photograph, by barcode. Omit for a card that is drawn.
  upc?: string
  // A company to link to, by legal name. Resolved to an id at render time;
  // when it resolves, the card goes to that company's page instead of `href`.
  company?: string
  art?: React.ReactNode
}[] = [
  {
    label: 'Peanut butter',
    sub: 'Skippy',
    href: '/search?q=peanut+butter',
    note: 'a kind of food',
    upc: '0037600106689',
  },
  {
    label: 'Chobani',
    sub: 'a whole brand',
    // Michael, 2026-10-07: "this should take you to the chobani page, should
    // it not?" Yes. A card labelled with a brand and subtitled "a whole
    // brand" should land on the brand, not on a search for its name — the
    // search was a list of its products with no company record attached,
    // which is the thing the card is advertising.
    //
    // `company` is resolved to an id at render time rather than hardcoded,
    // the same way `upc` is resolved to a photo: a pasted id rots silently
    // when the row is re-ingested, and if the lookup finds nothing the card
    // falls back to `href` and still works.
    company: 'Chobani',
    href: '/search?q=Chobani',
    note: 'a brand',
    upc: '0818290442970',
  },
  {
    label: '0071012075379',
    href: '/search?q=0071012075379',
    note: 'a barcode',
    // An actual barcode: varied bar widths, with the quiet margins a real
    // symbol has. Drawn rather than photographed — there is no package here,
    // the number itself is the subject.
    art: (
      <>
        <path d="M16 16v26M20 16v26M23 16v22M27 16v26M31 16v22M34 16v26M38 16v26M42 16v22M46 16v26" />
        <path d="M13 46h38" strokeWidth={1.2} />
      </>
    ),
  },
]

// The photographs for the example cards, fetched by the barcodes above.
// Returns a map so a missing product is simply absent rather than throwing —
// an example whose barcode has been removed from the database must not take
// the whole start screen down with it.
// The company ids behind any example that names one, by legal name. Separate
// from the photo lookup because it answers a different question and a miss is
// handled differently: no photo means a glyph, no company means the card
// falls back to its search URL.
async function exampleCompanies(): Promise<Map<string, string>> {
  const names = EXAMPLES.map((e) => e.company).filter((n): n is string => Boolean(n))
  if (names.length === 0) return new Map<string, string>()
  const rows = await prisma.company.findMany({
    where: { legalName: { in: names }, ...VETTED_COMPANIES },
    select: { id: true, legalName: true },
  })
  return new Map(rows.map((r) => [r.legalName, r.id]))
}

async function exampleProducts(): Promise<Map<string, ExampleProduct>> {
  const upcs = EXAMPLES.map((e) => e.upc).filter((u): u is string => Boolean(u))
  if (upcs.length === 0) return new Map<string, ExampleProduct>()
  const rows = await prisma.product.findMany({
    where: { upc: { in: upcs } },
    select: {
      upc: true,
      name: true,
      category: true,
      productType: true,
      imageUrl: true,
      imageSource: true,
      imageSourceUrl: true,
    },
  })
  return new Map(rows.map((r) => [r.upc!, r]))
}

type ExampleProduct = {
  upc: string | null
  name: string
  category: string | null
  productType: string
  imageUrl: string | null
  imageSource: string | null
  imageSourceUrl: string | null
}

// NOTHING ASKED YET — what sits where the product rows go, before anybody
// has searched.
//
// This was a separate full-bleed page (`StartHere`) with its own oversized
// heading and no filter rail. Michael, 2026-10-07: "we want this page to
// instead be the product search page but with no product objects
// viewable... the search landing page should look similar to the search page
// when a filter has been applied."
//
// So it is now a block inside the results column. The page furniture — nav,
// aisle bar, breadcrumb, heading, colour key, filters — is identical before
// and after the first search, and only this block is replaced by rows. The
// heading dropped from 54px to a column-sized 30px for the same reason: it is
// no longer the page, it is the top of one column.
//
// The database is still untouched when this renders: the caller does not call
// `loadResults` at all.
function NothingAskedYet({
  photos,
  companies,
}: {
  photos: Map<string, ExampleProduct>
  companies: Map<string, string>
}) {
  return (
    <div style={{ paddingBottom: 40 }}>
      {/* THE ASK. Deliberately a question, not a label: the job here is to
          hand the shopper back the initiative. */}
      <h2
        style={{
          margin: 0,
          fontFamily: font.display,
          fontSize: 'clamp(24px, 3.2vw, 30px)',
          fontWeight: 600,
          lineHeight: 1.12,
          letterSpacing: '-0.015em',
        }}
      >
        What are you buying?<span style={{ color: colors.link }}>.</span>
      </h2>

      <p style={{ margin: '12px 0 0', fontSize: 15, lineHeight: 1.6, color: colors.ink2, maxWidth: '54ch' }}>
        Type a product, a brand, or a barcode in the bar above — or narrow the whole catalogue with
        the filters on the left.
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
        {EXAMPLES.map((e) => {
          const photo = e.upc ? photos.get(e.upc) : undefined
          // A resolved company wins over the search URL; an unresolved one
          // leaves the card exactly as it was.
          const companyId = e.company ? companies.get(e.company) : undefined
          const href = companyId ? `/companies/${companyId}` : e.href
          const isBarcode = /^\d+$/.test(e.label)
          return (
            <Link
              key={e.href}
              href={href}
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
              <span style={{ marginBottom: 10, display: 'flex' }}>
                {photo ? (
                  // The real photograph. ProductThumb carries the licence
                  // contract and falls back to the aisle glyph if the row has
                  // no image, so this card cannot end up blank.
                  <ProductThumb
                    product={photo}
                    category={photo.category}
                    productType={photo.productType}
                    size={76}
                    intrinsic={160}
                    label={e.label}
                  />
                ) : (
                  // Drawn, on the same warm tint the thumbnails use, so a
                  // card here and a product row later read as one system.
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
                )}
              </span>

              <span
                style={{
                  fontFamily: isBarcode ? font.mono : undefined,
                  fontSize: isBarcode ? 12.5 : 14.5,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  wordBreak: isBarcode ? 'break-all' : undefined,
                }}
              >
                {e.label}
              </span>
              {e.sub && <span style={{ fontSize: 12, color: colors.ink3 }}>{e.sub}</span>}
              <span style={{ fontSize: 11.5, color: colors.ink4 }}>{e.note}</span>
            </Link>
          )
        })}
      </div>

      {/* THE AISLE GRID IS GONE. Michael, 2026-10-07: "no need for this
          section, they already have tabs above."
          It was ten cards built from the same AISLES array, in the same
          order, as the AisleBar sitting a few hundred pixels above them — my
          own comment here used to say so approvingly. A second copy of a
          control is not a shortcut to it; it is one more thing to read
          before you find out it does nothing new. */}

      {/* The method paragraph that used to sit here is gone. Michael:
          "remove this text, this is something that should go into the about
          section or a related page, not here". He is right that a start
          screen is not where someone reads about how we source — but the
          text itself is the most important thing on the site, so it belongs
          on /faq and /sourcing rather than deleted. /sourcing is still a 404
          (features-to-add item 3), which is where this paragraph should land
          when it is built. */}
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
          {/* Condensed the same way the product page heading is, and for
              the same reason: a 90-character label name turns a scannable
              list into a wall. The full name is on the product page, under
              "On the label". See shortProductName in productName.ts. */}
          {shortProductName(title)}
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
function FilterRail({
  q,
  aisle,
  per,
  filters,
}: {
  q?: string
  aisle?: string
  per: number
  filters: IngredientFilterState
}) {
  const base = q ? `?q=${encodeURIComponent(q)}` : '?'

  // Every filter link is built from the CURRENT state with one thing changed,
  // so the rail composes: turning on "no seed oils" keeps the search term,
  // the aisle, the page size and any typed exclusions. Page is deliberately
  // dropped — a new filter means a new result set, and page 7 of the old one
  // is meaningless.
  const linkTo = (next: IngredientFilterState) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (aisle) params.set('aisle', aisle)
    for (const [k, v] of Object.entries(ingredientFilterParams(next))) params.set(k, v)
    if (per !== DEFAULT_PAGE_SIZE) params.set('per', String(per))
    const s = params.toString()
    return s ? `/search?${s}` : '/search'
  }

  // What the exclude form has to carry so submitting it keeps everything
  // else. `without` is the form's own field, so it is not a hidden input.
  const carry: Record<string, string> = {}
  if (q) carry.q = q
  if (aisle) carry.aisle = aisle
  if (filters.keys.length > 0) carry.free = filters.keys.join(',')
  if (per !== DEFAULT_PAGE_SIZE) carry.per = String(per)

  return (
    <aside style={{ width: 224, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* THE COLOUR KEY COMES FIRST.
          Michael, 2026-10-07: "make sure the colors are at the very top,
          vertically above the products." It was third in the rail, below the
          filters and the aisle box, which put it level with the fourth or
          fifth result — so the one thing a first-time reader needs in order
          to read anything else was the last thing they reached.
          Its descriptions were also cut to phrases; see STATUS_MEANINGS. */}
      <StatusKeyPanel />

      {/* WHAT'S NOT IN IT.
          Michael asked to filter by ingredient, broad categories and typed-in
          names both. These are the broad ones, and every one is an EXCLUSION:
          an ingredient list we hold is evidence something IS in a product, so
          "no seed oils" means no seed oil appears in the list we have. A
          product with no ingredient list on file therefore passes — it has
          to, because excluding it would claim we know what is in it.

          Organic and non-GMO are missing on purpose. We hold 40 organic and
          18 non-GMO records across 416,382 products, so those filters would
          report our coverage as a fact about food. See ingredientFilters.ts. */}
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
          {/* Michael, 2026-10-07: "Just say Ingredient Filter. Lets keep it
              simple." The old heading was trying to explain the semantics in
              the title — that these are exclusions — which is the job of the
              per-filter explainers below, not of four words in small caps. */}
          Ingredient filter
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 9 }}>
          {INGREDIENT_FILTERS.map((f) => {
            const on = filters.keys.includes(f.key)
            return (
              <Link
                key={f.key}
                href={linkTo(toggleFilterKey(filters, f.key))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 0',
                  fontSize: 13,
                  textDecoration: 'none',
                  color: on ? colors.ink : colors.ink2,
                  fontWeight: on ? 600 : 400,
                }}
              >
                {/* A drawn box rather than a real checkbox: these are links,
                    so they work with JavaScript off and each one is a URL
                    somebody can paste. A checkbox would need a form and a
                    submit to do the same job less well. */}
                <span
                  aria-hidden
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 14,
                    height: 14,
                    flexShrink: 0,
                    borderRadius: 3,
                    border: `1.5px solid ${on ? status.confirmed.fg : '#C9C2B2'}`,
                    background: on ? status.confirmed.fg : colors.paper,
                    color: colors.paper,
                    fontSize: 10,
                    lineHeight: 1,
                  }}
                >
                  {on ? '✓' : ''}
                </span>
                <span style={{ flexGrow: 1, minWidth: 0 }}>{f.label}</span>

                {/* Michael, 2026-10-07: "there needs to be a little hover over
                    explainer to explain what each of these broad categories.
                    a little 'i' symbol would be perfect."
                    `f.what` names real ingredients from our own data rather
                    than describing the category in the abstract — "no seed
                    oils" is only meaningful once you know it catches soybean
                    and canola. Native title again: keyboard-reachable, no
                    state, nothing to hydrate. */}
                <span
                  title={f.what}
                  aria-label={f.what}
                  role="img"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 14,
                    height: 14,
                    flexShrink: 0,
                    borderRadius: '50%',
                    border: `1px solid ${colors.ink4}`,
                    fontSize: 9.5,
                    fontWeight: 700,
                    fontStyle: 'italic',
                    lineHeight: 1,
                    color: colors.ink3,
                    cursor: 'help',
                  }}
                >
                  i
                </span>
              </Link>
            )
          })}
        </div>

        {/* THE RULE THAT APPLIES TO ALL SIX, stated once rather than in six
            tooltips. It is the one thing a reader could otherwise get wrong:
            a product we hold no ingredient list for is NOT excluded, because
            excluding it would claim we know what is in it. */}
        <p style={{ margin: '9px 0 0', fontSize: 11, lineHeight: 1.45, color: colors.ink4 }}>
          Products with no ingredient list on file still pass — we cannot
          exclude what we have not read.
        </p>

        <div
          style={{
            marginTop: 13,
            paddingTop: 12,
            borderTop: `1px solid ${colors.line}`,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: colors.ink2,
          }}
        >
          Without a specific ingredient
        </div>

        {/* Typed exclusions, each removable on its own. The form below edits
            the whole comma-separated list; these chips are how you drop one
            without retyping the others. */}
        {filters.terms.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 9 }}>
            {filters.terms.map((t) => (
              <Link
                key={t}
                href={linkTo(removeTerm(filters, t))}
                title={`Stop excluding ${t}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 7px',
                  background: status.openResearch.bg,
                  border: `1px solid ${status.openResearch.border}`,
                  borderRadius: 4,
                  fontSize: 11.5,
                  color: colors.ink2,
                  textDecoration: 'none',
                }}
              >
                {t}
                <span aria-hidden style={{ color: colors.ink4 }}>
                  &times;
                </span>
              </Link>
            ))}
          </div>
        )}

        <IngredientExcludeBox terms={filters.terms} hidden={carry} />

        {hasAnyFilter(filters) && (
          <div style={{ marginTop: 10, fontSize: 12.5 }}>
            <Link href={linkTo(EMPTY_FILTERS)}>Clear ingredient filters</Link>
          </div>
        )}
      </div>

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
// NOTHING MATCHED. Three different reasons, and they must not be blurred:
// we have no such product, the aisle is empty, or the filters excluded
// everything we do have. The third is not a gap in our data at all, and
// telling someone "we haven't read this one yet" when they filtered out six
// ingredient categories would be plainly false.
function EmptyState({
  q,
  aisle,
  filtered,
}: {
  q?: string
  aisle?: string
  filtered: boolean
}) {
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
        {filtered ? 'Nothing left after those filters' : "We haven't read this one yet"}
      </div>
      {filtered ? (
        <p style={{ margin: '9px 0 0', fontSize: 14, lineHeight: 1.6, color: colors.ink2, maxWidth: 560 }}>
          Every product we hold{q ? <> matching <strong>{q}</strong></> : null}
          {aisle ? <> in the {aisleLabel(aisle)} aisle</> : null} lists at least one of the
          ingredients you excluded. Clearing one filter in the panel will widen it.
        </p>
      ) : (
        <p style={{ margin: '9px 0 0', fontSize: 14, lineHeight: 1.6, color: colors.ink2, maxWidth: 560 }}>
          {q ? (
            <>
              Nothing in our records matches <strong>{q}</strong>.
            </>
          ) : aisle ? (
            <>We have not read anything in the {aisleLabel(aisle)} aisle yet.</>
          ) : (
            <>There is nothing in our records yet.</>
          )}{' '}
          That means it is missing from our database, not that there is nothing on the public record
          about it.
        </p>
      )}
    </div>
  )
}

function Pagination({
  page,
  lastPage,
  hasMore,
  q,
  aisle,
  per,
  total,
  filters,
}: {
  page: number
  // Null when no exact count was taken, in which case `hasMore` is the only
  // thing we know about what comes next.
  lastPage: number | null
  hasMore: boolean
  q?: string
  aisle?: string
  per: number
  total: number | null
  filters: IngredientFilterState
}) {
  const url = (p: number, size: number = per) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (aisle) params.set('aisle', aisle)
    for (const [k, v] of Object.entries(ingredientFilterParams(filters))) params.set(k, v)
    if (p > 1) params.set('page', String(p))
    if (size !== DEFAULT_PAGE_SIZE) params.set('per', String(size))
    const s = params.toString()
    return s ? `/search?${s}` : '/search'
  }

  const forward = lastPage === null ? hasMore : page < lastPage
  // The per-page control stays even on a single page of results: on 30 rows
  // at 25 a page, "show 50" is exactly what someone wants, and hiding the
  // control then would hide it precisely when it is useful.
  if (!forward && page === 1 && (total ?? 0) <= PAGE_SIZES[0]) return null

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

      <span
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: colors.ink3, fontFamily: font.mono, fontSize: 12.5 }}>
          {lastPage === null ? `page ${page}` : `${page} / ${lastPage}`}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, fontSize: 12.5, color: colors.ink3 }}>
          <span>Show</span>
          {PAGE_SIZES.map((size) => (
            <span key={size}>
              {size === per ? (
                <span style={{ fontFamily: font.mono, fontWeight: 700, color: colors.ink }}>{size}</span>
              ) : (
                // Changing the page size goes back to page 1. Staying on page
                // 4 while tripling the page size would land the reader
                // somewhere they never scrolled to, and on a short result
                // set, past the end entirely.
                <Link href={url(1, size)} style={{ fontFamily: font.mono }}>
                  {size}
                </Link>
              )}
            </span>
          ))}
        </span>
      </span>

      {forward ? <Link href={url(page + 1)}>Next &rarr;</Link> : <span />}
    </div>
  )
}

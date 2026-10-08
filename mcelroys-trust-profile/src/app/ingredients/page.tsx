import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { colors, font, layout, status } from '@/lib/design'
import { AisleBar, Breadcrumb, SiteFooter, TopNav } from '@/components/SiteChrome'
// isNonLatinName keeps the 515 Ukrainian, Bulgarian, Chinese and Korean
// ingredient names out of the English browse list without deleting them.
// See the header of that file for why they are kept.
import { isNonLatinName } from '@/lib/ingredientNames'

// THE INGREDIENTS INDEX.
//
// WHY THIS PAGE NOW EXISTS. The breadcrumb on an ingredient page already said
// "Rootify / Search / Ingredients / <name>", but the "Ingredients" crumb had
// no link, so it rendered as the greyed-out current-page style and went
// nowhere. Michael: "I can't go back to the ingredients page, this shouldn't
// be grayed out after i click on a more specific ingredient." The crumb was
// promising a page that did not exist, so here it is.
//
// WHAT IT DELIBERATELY IS NOT: a list of all 127,268 ingredient rows. That is
// the same mistake the Search page was making — answering a question nobody
// asked with everything we have. An ingredient is something you arrive at
// from a product label, so this page leads with the small set we actually
// hold research on, and is honest about what the rest of the flag means.
//
// IT IS SEARCHABLE AS OF 2026-10-08. Michael: "people should also be able to
// search ingredients and find much information on it, kind of like the
// product search but with less filters."
//
// With ?q= the page stops being a curated index and becomes a search over all
// 127,268 names, ranked by how many products list each one — which is the
// closest thing to relevance this table has, and a real ordering rather than
// alphabetical. Every row says what we hold on that ingredient, so the
// difference between "we have research" and "we have classified it and
// nothing else" is visible before you click.
//
// The browse list (no ?q=) leaves out names with no Latin letters. The SEARCH
// does not: someone who types "цукор" should find it. See ingredientNames.ts.

export const metadata = { title: 'Ingredients' }

const PAGE_SIZE = 120

export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const page = Math.max(1, Number(first(sp.page) ?? 1) || 1)
  // Two characters is the floor: "a" would match most of the table and the
  // query would be a sequential scan returning nothing anyone asked for.
  const q = (first(sp.q) ?? '').trim().slice(0, 60)
  const searching = q.length >= 2

  // SEARCH MODE. Ranked by productCount — the denormalised column added this
  // round — so the ingredient on 30,000 labels comes before the one on two.
  // Ordering by name would put "almond butter" above "almond", which is not
  // what anyone typing "almond" is looking for.
  const found = searching
    ? await prisma.ingredient.findMany({
        where: { name: { contains: q, mode: 'insensitive' } },
        select: {
          id: true,
          name: true,
          category: true,
          productCount: true,
          _count: { select: { studies: true, authorityAssessments: true, regulatoryStatuses: true } },
        },
        orderBy: [{ productCount: 'desc' }, { name: 'asc' }],
        take: PAGE_SIZE,
      })
    : []

  const [studied, flaggedCount, totalCount, flagged] = await Promise.all([
    // The ingredients where a study is actually on file. Sixteen of them
    // today, and they are the only ingredients on this site where Rootify
    // holds a research record rather than a classification.
    prisma.ingredient.findMany({
      where: { studies: { some: {} } },
      select: { id: true, name: true, _count: { select: { studies: true, products: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.ingredient.count({ where: { flaggedForResearch: true } }),
    prisma.ingredient.count(),
    // Skipped entirely in search mode: the browse list is not on screen, and
    // this is the page's most expensive query.
    searching
      ? Promise.resolve([])
      : prisma.ingredient.findMany({
          where: { flaggedForResearch: true },
          select: { id: true, name: true, _count: { select: { products: true } } },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
  ])

  // THE BROWSE LIST LEAVES OUT NAMES WITH NO LATIN LETTERS.
  //
  // 515 ingredient names are Ukrainian, Bulgarian, Chinese or Korean —
  // "цукор" (sugar), "вода" (water), "鸡蛋" (egg). They are real
  // ingredients off real labels and are kept in the database; see
  // ingredientNames.ts. They are simply not browsable on an English page, and
  // they were a visible part of what Michael meant by "a lot of these
  // ingredients have characters in them that shouldnt be there at all".
  //
  // Filtered here rather than in SQL: Postgres has no cheap "contains a Latin
  // letter" predicate, and this is 120 rows. It means a page can show fewer
  // than 120 — an honest consequence of not having a column for it, and the
  // alternative is a regex filter the index cannot serve.
  //
  // SEARCH IS NOT FILTERED: someone who types "цукор" should find it.
  const browsable = flagged.filter((i) => !isNonLatinName(i.name))

  const lastPage = Math.max(1, Math.ceil(flaggedCount / PAGE_SIZE))

  return (
    <>
      <TopNav />
      <AisleBar />
      <Breadcrumb trail={[{ label: 'Rootify', href: '/' }, { label: 'Ingredients' }]} />

      <div
        style={{
          flexGrow: 1,
          maxWidth: 1000,
          marginLeft: 'auto',
          marginRight: 'auto',
          width: '100%',
          boxSizing: 'border-box',
          padding: `26px clamp(18px, 4vw, ${layout.gutter}px) 0`,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: font.display,
            fontSize: 'clamp(26px, 3.4vw, 34px)',
            fontWeight: 600,
            letterSpacing: '-0.015em',
          }}
        >
          Ingredients
        </h1>
        <p style={{ margin: '12px 0 0', fontSize: 15, lineHeight: 1.6, color: colors.ink2, maxWidth: '64ch' }}>
          You usually reach an ingredient from a product label. This is the way in from the other
          side: search all {totalCount.toLocaleString()} ingredient names we hold, or start from the
          ones we hold research on.
        </p>

        {/* A plain GET form, so a search is a URL someone can bookmark or
            share, and so it works with JavaScript off. Same shape as the
            search box in the site header. */}
        <form action="/ingredients" style={{ display: 'flex', marginTop: 18, maxWidth: 520 }}>
          <label htmlFor="q" className="sr-only">
            Search ingredient names
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search an ingredient — soy lecithin, red 40, carrageenan"
            style={{
              flexGrow: 1,
              height: 42,
              boxSizing: 'border-box',
              padding: '0 14px',
              fontFamily: 'inherit',
              fontSize: 15,
              color: colors.ink,
              background: '#FFFFFF',
              border: `1px solid ${colors.line}`,
              borderRight: 0,
              borderRadius: '6px 0 0 6px',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            style={{
              height: 42,
              padding: '0 20px',
              fontSize: 15,
              fontWeight: 600,
              color: '#FFFFFF',
              background: colors.link,
              border: `1px solid ${colors.link}`,
              borderRadius: '0 6px 6px 0',
              cursor: 'pointer',
            }}
          >
            Search
          </button>
        </form>

        {searching && (
          <section style={{ marginTop: 26 }}>
            <Head
              title={`Matching \u201c${q}\u201d`}
              count={found.length >= PAGE_SIZE ? undefined : found.length}
            />
            {found.length === 0 ? (
              <p style={{ margin: '14px 0 0', fontSize: 14, lineHeight: 1.6, color: colors.ink2 }}>
                No ingredient name contains “{q}”. Ingredient names here are transcribed from
                labels, so they follow the label’s wording rather than a standard vocabulary — try
                a shorter word, or the name as it would be printed on a pack.
              </p>
            ) : (
              <>
                {found.length >= PAGE_SIZE && (
                  <p style={{ margin: '12px 0 0', fontSize: 12.5, color: colors.ink3 }}>
                    The {PAGE_SIZE} most-used matches, most-used first. Narrow the word to see fewer.
                  </p>
                )}
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column' }}>
                  {found.map((i) => {
                    // WHAT WE HOLD, said on the row. A reader deciding whether
                    // to click should not have to click to find out that the
                    // page is empty — that was the round-9 complaint about
                    // flagged ingredients and it applies here too.
                    const holds = [
                      i._count.studies > 0
                        ? `${i._count.studies} research ${i._count.studies === 1 ? 'record' : 'records'}`
                        : null,
                      i._count.authorityAssessments > 0
                        ? `${i._count.authorityAssessments} official ${i._count.authorityAssessments === 1 ? 'ruling' : 'rulings'}`
                        : null,
                      i._count.regulatoryStatuses > 0
                        ? `${i._count.regulatoryStatuses} country ${i._count.regulatoryStatuses === 1 ? 'rule' : 'rules'}`
                        : null,
                    ].filter(Boolean)
                    const anything = holds.length > 0
                    return (
                      <Link
                        key={i.id}
                        href={`/ingredients/${i.id}`}
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 10,
                          boxSizing: 'border-box',
                          padding: '10px 12px 10px 11px',
                          borderLeft: `3px solid ${anything ? status.openResearch.fg : 'transparent'}`,
                          borderBottom: `1px solid ${colors.line}`,
                          background: anything ? status.openResearch.bg : 'transparent',
                          textDecoration: 'none',
                          color: 'inherit',
                        }}
                      >
                        <span style={{ flexGrow: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 14.5, fontWeight: anything ? 600 : 400 }}>
                            {capitalize(i.name)}
                          </span>
                          <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: colors.ink3 }}>
                            {[i.category, anything ? holds.join(' \u00b7 ') : 'nothing on file yet']
                              .filter(Boolean)
                              .join(' \u00b7 ')}
                          </span>
                        </span>
                        <span style={{ fontFamily: font.mono, fontSize: 12, color: colors.ink3, flexShrink: 0 }}>
                          {i.productCount.toLocaleString()}
                        </span>
                      </Link>
                    )
                  })}
                </div>
                <p style={{ margin: '12px 0 0', fontSize: 11.5, color: colors.ink4 }}>
                  The number on the right is how many products list that ingredient.
                </p>
              </>
            )}
          </section>
        )}

        {/* --- Research actually on file. Hidden while searching: the
            search results answer the question that was asked. --- */}
        {!searching && (
        <section style={{ marginTop: 30 }}>
          <Head title="Research on file" count={studied.length} />
          {studied.length === 0 ? (
            <p style={{ margin: '12px 0 0', fontSize: 13.5, color: colors.ink3 }}>
              No ingredient has a study on file yet.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 14 }}>
              {studied.map((i) => (
                <Link key={i.id} href={`/ingredients/${i.id}`} style={card}>
                  <span style={{ fontSize: 14.5, fontWeight: 600 }}>{capitalize(i.name)}</span>
                  <span style={{ fontSize: 12, color: colors.ink3, marginTop: 4 }}>
                    <span style={{ fontFamily: font.mono }}>{i._count.studies}</span>{' '}
                    {i._count.studies === 1 ? 'study' : 'studies'} ·{' '}
                    <span style={{ fontFamily: font.mono }}>{i._count.products.toLocaleString()}</span>{' '}
                    {i._count.products === 1 ? 'product' : 'products'}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        )}

        {/* --- The flag, explained before the list --- */}
        {!searching && (
        <>
        <section style={{ marginTop: 34 }}>
          <Head title="Flagged for a closer look" count={flaggedCount} />

          {/* This paragraph is the whole reason the section is not called
              "ingredients with open research". The flag is set by a
              classification rule in ingredientClassification.ts, not by a
              study — 6,250 ingredients carry it and 16 have research on file.
              Printing the list without saying that would turn a to-do list
              into an accusation. */}
          <div style={{ marginTop: 13 }}>
            <div
              style={{
                boxSizing: 'border-box',
                padding: '12px 15px',
                background: status.openResearch.bg,
                border: `1px solid ${status.openResearch.border}`,
                borderRadius: 7,
                fontSize: 13,
                lineHeight: 1.6,
                color: colors.ink2,
                maxWidth: '78ch',
              }}
            >
              <strong style={{ color: colors.ink }}>This flag is a to-do list, not a finding.</strong>{' '}
              It is set by a classification rule — an additive or a processing ingredient rather than
              a whole food — to mark what is worth reading up on. It is not a claim that anything is
              wrong with the ingredient, and most of these have no study on file at all.
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>
            {browsable.map((i) => (
              <Link
                key={i.id}
                href={`/ingredients/${i.id}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  boxSizing: 'border-box',
                  padding: '6px 11px',
                  background: colors.card,
                  border: `1px solid ${colors.line}`,
                  borderRadius: 6,
                  fontSize: 13,
                  color: colors.ink,
                  textDecoration: 'none',
                }}
              >
                {capitalize(i.name)}
                <span style={{ fontFamily: font.mono, fontSize: 11, color: colors.ink4 }}>
                  {i._count.products.toLocaleString()}
                </span>
              </Link>
            ))}
          </div>

          {lastPage > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
                marginTop: 18,
                fontSize: 13.5,
              }}
            >
              {page > 1 ? (
                <Link href={page === 2 ? '/ingredients' : `/ingredients?page=${page - 1}`}>&larr; Previous</Link>
              ) : (
                <span />
              )}
              <span style={{ color: colors.ink3, fontFamily: font.mono, fontSize: 12.5 }}>
                {page} / {lastPage}
              </span>
              {page < lastPage ? <Link href={`/ingredients?page=${page + 1}`}>Next &rarr;</Link> : <span />}
            </div>
          )}
        </section>

        <p style={{ margin: '34px 0 0', fontSize: 12.5, lineHeight: 1.6, color: colors.ink3, maxWidth: '68ch' }}>
          Every other ingredient we hold —{' '}
          <span style={{ fontFamily: font.mono }}>{totalCount.toLocaleString()}</span> in all, most
          of them ordinary foods — is reachable from the search box above, or from the label of any
          product that lists it.
        </p>
        </>
        )}
      </div>

      <SiteFooter />
    </>
  )
}

const card: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  padding: '13px 15px',
  background: colors.card,
  border: `1px solid ${colors.line}`,
  borderRadius: layout.radius,
  textDecoration: 'none',
  color: 'inherit',
}

function Head({ title, count }: { title: string; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: `2px solid ${colors.ink}`, paddingBottom: 8 }}>
      <h2 style={{ margin: 0, fontFamily: font.display, fontSize: 21, fontWeight: 600 }}>{title}</h2>
      {count !== undefined && (
        <span style={{ fontFamily: font.mono, fontSize: 13, color: colors.ink3 }}>
          {count.toLocaleString()}
        </span>
      )}
    </div>
  )
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

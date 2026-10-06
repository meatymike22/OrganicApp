import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { colors, font, layout, status } from '@/lib/design'
import { AisleBar, Breadcrumb, SiteFooter, TopNav } from '@/components/SiteChrome'

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
    prisma.ingredient.findMany({
      where: { flaggedForResearch: true },
      select: { id: true, name: true, _count: { select: { products: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ])

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
          side: the ingredients we hold research on, and the ones our classification has flagged for
          a closer look.
        </p>

        {/* --- Research actually on file --- */}
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

        {/* --- The flag, explained before the list --- */}
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
            {flagged.map((i) => (
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
          of them ordinary foods — is reachable from the label of any product that lists it.
        </p>
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

function Head({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: `2px solid ${colors.ink}`, paddingBottom: 8 }}>
      <h2 style={{ margin: 0, fontFamily: font.display, fontSize: 21, fontWeight: 600 }}>{title}</h2>
      <span style={{ fontFamily: font.mono, fontSize: 13, color: colors.ink3 }}>{count.toLocaleString()}</span>
    </div>
  )
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

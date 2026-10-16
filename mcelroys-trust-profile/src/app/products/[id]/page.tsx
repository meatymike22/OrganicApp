import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
// The filter catalogue, so a category chip on this page links to the search
// filter that means the same thing by the same word.
import { INGREDIENT_FILTERS } from '@/lib/ingredientFilters'
import { additive, colors, font, isoDate, layout, status } from '@/lib/design'
import { AdditiveMark } from '@/components/AdditiveMark'
import { baseDyeOf, categoryHelp, familiesPresent, familyFor, familyHelp } from '@/lib/ingredientDisplay'
import { describeCategory } from '@/lib/categoryDisplay'
import { flaggedSignal, ingredientCount, nonGmoSignal, organicSignal, ownerSignal, recallSignal, type ProductForSignals, type Signal } from '@/lib/productSignals'
import {
  companyDisplayName,
  headingWithBrand,
  isShortened,
  productBrand,
  productDisplayName,
  shortProductName,
} from '@/lib/productName'
import { assessmentWeight, classificationMeaning } from '@/lib/authorities'
import { plainReason } from '@/lib/plainRecall'
import { getRelatedProducts, type RelatedProduct, type RelatedSet } from '@/lib/relatedProducts'
import { evidenceNote, getProductRecalls, getRecallsListingProducts, groupRecalls, noticeNamesBrand, type RecallGroup } from '@/lib/recalls'
import { ProductThumb } from '@/components/ProductThumb'
import { Collapsible, InfoDot } from '@/components/Collapsible'
import { CopyBarcode } from '@/components/CopyBarcode'
import { AisleBar, SiteFooter, TopNav } from '@/components/SiteChrome'
import { Suspense } from 'react'
import { BackToResultsFromUrl } from '@/components/BackFromUrl'
import { VisitTrail } from '@/components/VisitTrail'
import { SignalTable, SignalTableNote, StatusChip } from '@/components/StatusChip'

// WHAT A "GOVERNMENT NOTICE" IS, written once.
//
// Michael, 2026-10-13: "What is a government notice? How is the user
// supposed to know what this is? Put an 'i' next to the title explaining
// it."
//
// Fair: the phrase is ours rather than any agency's. It covers two different
// things that the recalls section deliberately does not merge \u2014 a recall,
// where a product is pulled from sale, and the wider set of enforcement
// records an agency publishes without one. Calling the section "recalls"
// alone would overstate the quieter notices.
//
// It is a constant because it is now shown in two places on this page: the
// "i" on the signal table's Recalls row, and the "i" on the section itself.
// Two copies of a definition is how this codebase has drifted before.
const GOVERNMENT_NOTICE =
  'A record published by a food safety agency \u2014 the FDA, FSIS, CPSC or CBP. ' +
  'Most are recalls, where a company pulls a product from sale, voluntarily ' +
  'or at an agency\u2019s request. The rest are other enforcement records those ' +
  'agencies publish. We show the agency, the date, what the notice said and ' +
  'which products it covered, and every reference number is on this ' +
  'product\u2019s sources page.'

// Everything on this page in one query. The product page is the place a
// shopper goes to check our work, so it pulls the actual source rows — the
// certificate numbers, the agencies, the dates — not just the summaries.
const PRODUCT_FIELDS = {
  id: true,
  name: true,
  upc: true,
  category: true,
  categorySource: true,
  productType: true,
  ingredientDisclosureStatus: true,
  ingredientCheckedAt: true,
  ingredientSource: true,
  ingredientSourceUrl: true,
  importSource: true,
  productIngredients: {
    select: {
      isOrganicSourced: true,
      listPosition: true,
      isTrace: true,
      concentrationNote: true,
      ingredient: {
        select: {
          id: true,
          name: true,
          category: true,
          flaggedForResearch: true,
          _count: { select: { studies: true } },
          // The codes, not a count: "IARC Group 2B" is information and "2
          // rulings" is not. A handful of rows per ingredient at most.
          authorityAssessments: { select: { classificationCode: true } },
        },
      },
    },
  },
  certifications: {
    select: {
      id: true,
      certifyingAgency: true,
      certificateNumber: true,
      certificationStatus: true,
      certifiedScopes: true,
      lastVerifiedDate: true,
      sourceUrl: true,
      reviewDate: true,
    },
  },
  productCertifications: {
    select: {
      id: true,
      scheme: true,
      certifyingBody: true,
      certificateNumber: true,
      status: true,
      scopeNote: true,
      lastVerifiedDate: true,
      sourceUrl: true,
      reviewDate: true,
    },
  },
  imageUrl: true,
  imageSource: true,
  imageSourceUrl: true,
  company: {
    select: {
      id: true,
      legalName: true,
      dbaNames: true,
      vettingStatus: true,
      businessRole: true,
      parentCompany: { select: { id: true, legalName: true } },
    },
  },
} as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await prisma.product.findUnique({
    where: { id },
    select: { name: true, company: { select: { legalName: true, dbaNames: true } } },
  })
  if (!product) return { title: 'Product not found' }
  const title = productDisplayName(product.name, product.company.legalName, product.company.dbaNames)
  return { title: `${title} — ${companyDisplayName(product.company.legalName)}` }
}

// CACHED, which is the whole point of the back-link change below.
//
// Until 2026-10-16 this page read `searchParams`, which opts a route out of
// caching unconditionally -- so all 416,365 product pages rendered from
// scratch on every request. That is what exhausted the Vercel Fluid Active
// CPU allowance and paused the project. The only thing read from the query
// string was a back link, which now reads the URL on the client instead; see
// BackFromUrl.tsx and claude/runbook-serving-and-caching.md.
//
// An hour is chosen because this data changes on import, not continuously.
export const revalidate = 3600

// WHY AN EMPTY ARRAY RATHER THAN NO FUNCTION AT ALL.
//
// Without this, the route is DYNAMICALLY RENDERED and the `revalidate` above
// does nothing. `revalidate` is not sufficient on its own for a dynamic
// segment. From the Next.js docs on generateStaticParams: "You must always
// return an array from generateStaticParams, even if it's empty. Otherwise,
// the route will be dynamically rendered." And: "You must return an empty
// array from generateStaticParams [...] in order to revalidate (ISR) paths at
// runtime."
//
// Returning [] prerenders NOTHING at build time -- there are 416,365 products
// and they do not belong in a build -- and instead caches each path the first
// time it is visited, which is exactly what this page wants.
//
// NOT `dynamic = 'force-static'`, which the docs offer as the alternative:
// that forces useSearchParams() to return empty values, which would
// permanently break the client-side back link in BackFromUrl.tsx.
//
// MEASURED 2026-10-16, before this was added: six loads of one product page
// produced EIGHT renders and 24 database round trips for the related-products
// seeds alone, counted in pg_stat_statements. The pages were not being cached
// at all, and `prerender-manifest.json` listed no dynamic route as
// revalidatable. See claude/runbook-serving-and-caching.md.
export async function generateStaticParams() {
  return []
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  // In Next.js 15+ the dynamic part of the URL arrives as a Promise.
  //
  // `searchParams` is deliberately NOT read. Its own comment here used to say
  // "Nothing on this page varies by query string", which was true and is now
  // load-bearing: reading it at all would un-cache the page.
  const { id } = await params

  const product = await prisma.product.findUnique({ where: { id }, select: PRODUCT_FIELDS })

  // A product whose company a reviewer rejected is kept only so bulk
  // ingestion will not recreate it. Treated the same as not existing.
  if (!product || product.company.vettingStatus === 'rejected') notFound()

  // The company name is printed as its own line and in the breadcrumb, so
  // the brand comes off the front of the product name. Computed once here so
  // the breadcrumb, the glyph label and the h1 cannot disagree.
  const title = productDisplayName(product.name, product.company.legalName, product.company.dbaNames)

  const forSignals = product as unknown as ProductForSignals

  // Related products cost about 250 ms (measured; see relatedProducts.ts), so
  // they go in the same Promise.all as the recall queries rather than in
  // series after them. A separate floating promise would also have worked and
  // would have been worse: a rejection on a promise nobody awaits in the same
  // tick is an unhandled rejection.
  const [listed, recalls, related] = await Promise.all([
    getRecallsListingProducts([product.id]),
    getProductRecalls(product.id),
    getRelatedProducts({
      id: product.id,
      category: product.category,
      companyId: product.company.id,
    }),
  ])

  const flagged = flaggedSignal(forSignals)

  // HOW MANY NOTICES THE SECTION BELOW WILL LIST THAT ARE NOT ABOUT THIS
  // PRODUCT. Grouped the same way the section groups them, so the chip's
  // sentence and the section's count are one number arrived at once
  // (Michael, 2026-10-12: "this says no recalls but below it says there are
  // 3 recalls or notices"). Cheap: these rows are already in memory.
  const otherNotices = recalls
    ? groupRecalls(recalls.brand.items).length + groupRecalls(recalls.process.items).length
    : 0
  const recall = recallSignal(forSignals, listed.get(product.id), otherNotices)

  // WHERE A CLICK ON AN INGREDIENT CAME FROM, so the ingredient page can
  // offer a way back. Michael, 2026-10-12: "when i click this ingredient
  // after being on the product page, i can't go back: this tab/page history
  // is gone. What happened?"
  //
  // Nothing happened to it — the ingredient page has never had a back link.
  // The product page got one in round 15 (BackLink, built from the search
  // row's own querystring) and the chain stopped there, so product to
  // ingredient was a one-way door.
  //
  // Same mechanism as BackLink, one step further along: the origin travels
  // in the URL, because a server component cannot see where the reader has
  // been. `from` names this product; `pfrom` carries THIS page's own origin
  // unchanged, so "back to Snickers" lands on a Snickers page that still
  // knows the way back to "peanut butter". Both are re-parsed and filtered
  // where they are read and neither is ever printed to the page.
  //
  // `pfrom` IS NO LONGER SET HERE. It carried this page's own origin one hop
  // further so that "back to Snickers" landed on a Snickers page that still
  // knew the way back to "peanut butter" -- but a cached page cannot know its
  // own query string, so the server cannot put it on these links any more.
  // What covers the gap: VisitTrail, which records the pages actually opened
  // in this tab and shows the real route whenever it has two or more stops.
  // That is strictly better than the URL chain for anyone who really walked
  // search -> product -> ingredient, and the URL chain only ever rendered as
  // VisitTrail's fallback. See BackToProductFromUrl in BackFromUrl.tsx.
  const ingredientOrigin = `?from=p:${product.id}`
  const organic = organicSignal(forSignals)
  const nonGmo = nonGmoSignal(forSignals)
  const owner = ownerSignal(forSignals)
  const count = ingredientCount(forSignals)

  // Ingredients in the order they appear on the label. Label order is itself
  // information — it is roughly descending by weight — so a product whose
  // positions were never recorded says so rather than showing a list in
  // whatever order the database returned.
  const hasOrder = product.productIngredients.every((pi) => pi.listPosition !== null)

  // A LAKE BORROWS ITS DYE'S RECORD. Michael, 2026-10-13: "why are the lake
  // variants not highligheted?"
  //
  // One extra indexed query, and only when the label actually carries a lake.
  // See the long note on LAKE_BASE in ingredientDisplay.ts for why the set of
  // lakes is an explicit list rather than a "strip trailing lake" rule.
  const lakeBases = [
    ...new Set(
      product.productIngredients
        .map((pi) => baseDyeOf(pi.ingredient.name))
        .filter((n): n is string => n !== null)
    ),
  ]
  const baseDyeRows = lakeBases.length
    ? await prisma.ingredient.findMany({
        where: { name: { in: lakeBases } },
        select: {
          id: true,
          name: true,
          _count: { select: { studies: true } },
          authorityAssessments: { select: { classificationCode: true } },
        },
      })
    : []
  const baseByName = new Map(baseDyeRows.map((r) => [r.name, r]))

  // WHAT WE HOLD ON EACH ROW, decided once for the whole page.
  //
  // Computed here rather than inside the row component so the ingredient
  // list and the flagged-ingredients section below it cannot disagree about
  // which ingredients have research. Two components asking the same question
  // separately is how this codebase has drifted three times before.
  const researchByIngredient = new Map<string, Research>()
  for (const pi of product.productIngredients) {
    const own: Research = {
      studies: pi.ingredient._count.studies,
      authorities: pi.ingredient.authorityAssessments.length,
    }
    if (own.studies > 0 || own.authorities > 0) {
      researchByIngredient.set(pi.ingredient.id, own)
      continue
    }
    const baseName = baseDyeOf(pi.ingredient.name)
    const base = baseName ? baseByName.get(baseName) : undefined
    const borrowed = base
      ? { studies: base._count.studies, authorities: base.authorityAssessments.length }
      : { studies: 0, authorities: 0 }
    researchByIngredient.set(
      pi.ingredient.id,
      base && (borrowed.studies > 0 || borrowed.authorities > 0)
        // `via` is what makes this honest: the row says the record belongs to
        // the base dye, so nobody reads it as a study of the lake itself.
        ? { ...borrowed, viaName: base.name, viaId: base.id }
        : own
    )
  }

  // THE INGREDIENT ROW OF THE TABLE, as a Signal like the others.
  //
  // `ingredientCount` returns a number or null, which is not enough for a
  // table whose whole job is to distinguish three states. Null means two
  // different things here and they must not share a row: the disclosure
  // status says whether we looked.
  const ingredientSignal: Signal =
    count !== null
      ? {
          column: 'flagged',
          state: 'confirmed',
          label: `${count} ingredient${count === 1 ? '' : 's'}`,
          detail: hasOrder ? 'Listed in label order' : 'Label order was not recorded',
        }
      : product.ingredientDisclosureStatus === 'not_disclosed'
        ? {
            column: 'flagged',
            state: 'nothingOnFile',
            label: 'Not published',
            detail: 'No ingredient list was found in any source we check.',
          }
        : {
            column: 'flagged',
            state: 'unchecked',
            label: 'Not checked',
            detail: 'We have not looked up an ingredient list for this product yet.',
          }

  const cat = describeCategory(product.category, product.categorySource)
  const isUnvetted = product.company.vettingStatus !== 'vetted'

  const ingredients = [...product.productIngredients].sort(
    (a, b) => (a.listPosition ?? 0) - (b.listPosition ?? 0)
  )

  return (
    <>
      <TopNav />
      <AisleBar />
      {/* THE COMPANY IS NOT IN THIS TRAIL ANY MORE.
          Michael, 2026-10-08: "why am i getting the campbells company in the
          tab history bar here? i never clicked on the campbells page. this
          needs to be fixed."

          The trail was correct — that product's company IS The Campbell's
          Company, and a breadcrumb shows where a page sits rather than where
          you have been. But he has now read it as browsing history twice (the
          same comment arrived in round 12), and a component that has to be
          explained is not doing its job.

          It also cost nothing to remove: the company name is a link in the
          product header about 40 pixels below this bar, which is the natural
          place to go up to the company from. One route up, not two, and no
          row that looks like a history entry nobody created. */}
      {/* THE TRAIL, WITH THE ONE-STEP BACK LINK AS ITS FALLBACK.
          Michael, 2026-10-13: "why isnt the tab history here? i should be
          able to know exactly what tabs i have clicked through this section."

          He was on this page having arrived from a related-products card,
          which carries no `?from=`, so BackLink rendered nothing at all.

          VisitTrail shows the pages he has actually opened in this tab, and
          falls back to BackLink when there is only one stop, so there is one
          bar and never two. See the long note in VisitTrail.tsx for why this
          is not the breadcrumb returning. */}
      <VisitTrail label={title}>
        {/* THE SUSPENSE BOUNDARY IS LOAD-BEARING. A static page that calls
            useSearchParams from a client component MUST wrap it, or `next build`
            fails with "Missing Suspense boundary with useSearchParams" -- and
            because dev renders every route on demand, `next dev` works fine
            without it. It also bounds the damage: useSearchParams makes the client
            tree up to the nearest boundary client-rendered, so without one the
            de-opt would climb past VisitTrail and take the prerender with it.

            fallback={null} because that is what this bar has always rendered when
            there is no origin to show. */}
        <Suspense fallback={null}>
          <BackToResultsFromUrl />
        </Suspense>
      </VisitTrail>

      {/* HEADER */}
      <div
        style={{
          boxSizing: 'border-box',
          padding: `26px ${layout.gutter}px 0`,
          display: 'flex',
          gap: 24,
          alignItems: 'flex-start',
        }}
      >
        {/* No `credit` here. The CC-BY-SA attribution moved to this
            product's sources page (decided 2026-10-06) — a credit under
            every photo was, in Michael's words, making the layman's eyes
            sore. The licence is still satisfied: the credit is one click
            from the image, named and linked, on a page reachable from here.
            Worth confirming at legal review. */}
        <ProductThumb
          product={product}
          category={product.category}
          productType={product.productType}
          // The one place a product's photograph is shown large, so it gets
          // the most room — and fluid, so it does not take over a phone.
          // Same em-based sizing as the search row; see ProductThumb.
          size="clamp(112px, 13vw, 184px)"
          intrinsic={320}
          label={title}
          // Portrait frame, so a package photograph fills it instead of
          // shrinking to fit a square. See the note on `tall` in
          // ProductThumb.tsx.
          tall
        />
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
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
                style={{ padding: '2px 7px', background: '#EFEADD', borderRadius: 3, color: colors.ink2 }}
              >
                {cat.label}
              </span>
            )}
            <Link href={`/companies/${product.company.id}`} style={{ color: colors.ink3 }}>
              {companyDisplayName(product.company.legalName)}
            </Link>
          </div>

          {/* BRAND, THEN A CONCISE NAME. Michael, 2026-10-08, on CROPP
              Cooperative's "1% Lowfat Milk": "this should say 'Organic Valley
              1% Lowfat Milk'. it should be 'brand, then, concise product
              name'. then the full product name can go below this title."

              Both halves of that are now true:
              - headingWithBrand adds the shelf brand when it differs from the
                legal company name, and adds nothing when the company name IS
                the brand (the common case, and it is already printed above).
              - shortProductName strips a leading stack of label claims before
                any tail cut, so "A2/A2 100% Grass-fed Regenerative Organic
                Probiotic Kefir" reads "Probiotic Kefir" rather than losing the
                word "Kefir" off the end — which is what it did before.
              The stored name in full is on the line below. */}
          <h1
            style={{
              margin: '7px 0 0',
              fontFamily: font.display,
              fontSize: 34,
              lineHeight: 1.1,
              fontWeight: 600,
              letterSpacing: '-0.015em',
            }}
          >
            {headingWithBrand(
              shortProductName(title),
              productBrand(product.company.legalName, product.company.dbaNames)
            )}
          </h1>

          {/* The stored name in full, whenever the heading is showing less
              than all of it. This line is what makes shortening safe —
              nothing is hidden, it is just no longer the first thing you
              have to read. See shortProductName in productName.ts. */}
          {isShortened(title) && (
            <div style={{ fontSize: 13, lineHeight: 1.5, color: colors.ink3, marginTop: 7, maxWidth: '68ch' }}>
              On the label: {title}
            </div>
          )}

          {product.upc && (
            <div style={{ marginTop: 9 }}>
              <CopyBarcode value={product.upc} />
            </div>
          )}

          {/* WHAT THE RECORD SAYS — one labelled row per question.

              Michael, 2026-10-07: "how are they supposed to know what isn't
              on file here? Nothing is labeled. There should be an aesthetic
              table for the layman so they can understand what all of this
              is." He was looking at a row of bare chips — "Not on file",
              "Maker certified", "3 flagged" — with nothing saying which
              question each one answered. The information was all there and
              none of it was readable.

              This replaces BOTH the chip strip and the separate tile row
              that used to sit under the hero. Those two showed the same
              five signals twice, once unlabelled and once labelled, and the
              unlabelled one came first. One table, each row naming its own
              question and linking to the section that answers it. */}
          <div style={{ marginTop: 16 }}>
            <SignalTable
              rows={[
                {
                  question: 'What is in it',
                  signal: ingredientSignal,
                  href: '#ingredients',
                },
                { question: 'Open research', signal: flagged, href: '#flagged' },
                {
                  question: 'Recalls',
                  signal: recall,
                  href: '#recalls',
                  // Same wording as the section below, from one place, so the
                  // row and the section cannot define the term differently.
                  help: GOVERNMENT_NOTICE,
                },
                // These two used to point at #certificates, which no longer
                // exists — Michael, 2026-10-07: "I am not sure how much
                // immediate value this section provides. At the very top we
                // already provide it. Remove this for now." The certificate
                // record and its date live on the sources page, so that is
                // where the rows now go. A row that links to a deleted anchor
                // silently does nothing, which is worse than not linking.
                {
                  question: 'Certified organic',
                  signal: organic,
                  href: `/products/${product.id}/sources`,
                },
                {
                  question: 'Non-GMO verified',
                  signal: nonGmo,
                  href: `/products/${product.id}/sources`,
                },
                { question: 'Who owns the brand', signal: owner, href: owner.href },
              ]}
            />
            <SignalTableNote />
          </div>

          {/* WHERE THE SOURCES WENT.
              Every claim on this page still has a dated primary source and
              every one is still reachable — they are all on this product's
              sources page, which is linked from here and from each section.
              Decided 2026-10-06: a fact checker needs one click, a shopper
              needs none. What must never happen is a claim about a named
              company with no route to its record at all. */}
          <div style={{ fontSize: 13, marginTop: 12 }}>
            <Link href={`/products/${product.id}/sources`}>Every source and date for this page &rarr;</Link>
          </div>
        </div>
      </div>

      {/* The brand has not been confirmed as a company, so every
          name-matched source (recalls, organic, verification registers) was
          never run against it. Said once, plainly, at the top — not repeated
          beside each empty section. */}
      {isUnvetted && (
        <div style={{ boxSizing: 'border-box', padding: `18px ${layout.gutter}px 0` }}>
          <Callout state="unchecked">
            <strong>This brand has not been confirmed yet.</strong> It came from an open product
            database as a line of brand text. Until a person or a barcode confirms which company it
            is, we cannot safely attach government notices, organic records or certifications to
            it — so those sections are empty because nobody has looked, not because there is
            nothing there.
          </Callout>
        </div>
      )}

      {/* SIGNAL ROW */}
      {/* The tile row that used to sit here is gone. It was the same five
          signals as the table in the hero above — labelled, but a second
          copy, and a reader who had just read the table had to read it again
          to find out it said nothing new. The table kept the one thing the
          tiles did that the old chip strip did not: every row links to its
          section, so it is still the table of contents. */}

      {/* BODY */}
      <div
        style={{
          flexGrow: 1,
          boxSizing: 'border-box',
          padding: `30px ${layout.gutter}px 0`,
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
        }}
      >
        {/* INGREDIENTS FIRST. Michael: "The ingredients should be shown
            first before research, recalls, open research, etc." It is also
            the one section that is about the product itself rather than
            about its maker's record, and the one a shopper standing in an
            aisle actually came for. */}
        <Ingredients
          ingredients={ingredients}
          product={product}
          hasOrder={hasOrder}
          signal={flagged}
          origin={ingredientOrigin}
          research={researchByIngredient}
        />
        <Flagged
          ingredients={ingredients}
          signal={flagged}
          productId={product.id}
          origin={ingredientOrigin}
          research={researchByIngredient}
        />
        <Recalls recalls={recalls} product={product} />
        {/* WHERE THE CERTIFICATES SECTION WAS. Michael, 2026-10-07:
            "Honestly I am not sure how much immediate value this section
            provides. At the very top we already provide it. Remove this for
            now. Instead, in this space maybe include a section for 'related
            products'."
            He is right that it was a second copy of the signal table: the
            same organic and non-GMO answers, three screens further down. The
            certificate records and their dates are still every bit as
            reachable — they are on this product's sources page, which is
            where the two table rows now link. */}
        <Related set={related} />
      </div>

      <SiteFooter />
    </>
  )
}

// ------------------------------------------------------------------ pieces

// SectionHead is gone from this page. Every section is a Collapsible now, and
// Collapsible draws its own heading — keeping a second heading component
// around meant two places decided what a section looked like. It still exists
// in PageParts for the pages that have not been converted.

// A tinted box used for the statements that aren't a record — the unvetted
// notice, the "nobody looked" explanations.
function Callout({ state, children }: { state: keyof typeof status; children: React.ReactNode }) {
  const s = status[state]
  return (
    <div
      style={{
        boxSizing: 'border-box',
        padding: '12px 15px',
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 7,
        fontSize: 13,
        lineHeight: 1.6,
        color: colors.ink2,
      }}
    >
      {children}
    </div>
  )
}

// Every fact on this page still carries a dated primary source — it is just
// not printed beside the fact any more. This is the pointer that replaces the
// old per-line citation: one quiet link per section to the product's sources
// page, where the URL, the reference number and the date all live.
//
// Michael, 2026-10-06: "All of our sources should be somewhere else, where
// any fact checkers can go look but the layman simply doesn't care."
//
// THE LINE THAT CANNOT BE CROSSED: a section may stop PRINTING its sources.
// It may not stop HAVING them, and it may not be reachable from nowhere. If
// you add a section to this page, give it one of these.
function SourceNote({ productId, what }: { productId: string; what: string }) {
  return (
    <div style={{ fontSize: 11.5, color: colors.ink4, marginTop: 10 }}>
      <Link href={`/products/${productId}/sources`}>{what} &mdash; sources and dates</Link>
    </div>
  )
}

type IngredientRows = {
  isOrganicSourced: boolean
  listPosition: number | null
  isTrace: boolean
  concentrationNote: string | null
  ingredient: {
    id: string
    name: string
    category: string | null
    flaggedForResearch: boolean
    _count: { studies: number }
    authorityAssessments: { classificationCode: string }[]
  }
}[]

// INGREDIENTS WORTH READING ABOUT — split by whether we actually hold
// research, because we mostly do not.
//
// Michael, 2026-10-07, on a flagged ingredient with an empty page: "why is
// this flagged but then there are no studies?" And: "are you really telling
// me there are no studies against enriched pasta?"
//
// The numbers, re-counted 2026-10-12: 9,090 ingredients carry
// `flaggedForResearch`, 15 have a study on file and NONE has an authority
// ruling — there are 20 IngredientStudy rows and 0 authority rows in the
// whole database. The flag is set by a classification rule in
// ingredientClassification.ts — an additive or processing ingredient rather
// than a whole food — and has never meant "research exists".
//
// This section used to open with "These ingredients have studies that
// disagree with each other, or research that is still open", which was false
// for 6,234 of them, and then showed a chip reading "0 studies" in the amber
// open-research colour. Amber plus a zero is the worst of both: it looks like
// a warning and contains no information.
//
// So the list is now three lists, in descending order of what we hold:
//
//   1. Studies on file. Says how many.
//   2. No study, but a named authority has published a classification. This
//      is the third research category Michael asked for on 2026-10-07 — the
//      authority's own category, shown as the authority's own words, with the
//      source a click away. A classification is NOT a study: it is a
//      committee's reading of evidence we may not hold ourselves, so it is
//      labelled as one and never counted among the studies.
//   3. Flagged by our classifier and nothing on file yet. Neutral grey,
//      under a heading that says exactly that.
//
// Nothing is hidden and nothing is implied.
function Flagged({
  ingredients,
  signal,
  productId,
  origin,
  research,
}: {
  ingredients: IngredientRows
  signal: Signal
  productId: string
  // The querystring that tells the ingredient page how to get back here.
  origin: string
  // The same map the ingredient list above uses. These three lists answer
  // the same question that list's amber dot answers, so they must come from
  // one place, or a colour lake reads as researched in one section and not
  // the other on the same page.
  research: Map<string, Research>
}) {
  const held = (pi: IngredientRows[number]): Research =>
    research.get(pi.ingredient.id) ?? { studies: 0, authorities: 0 }

  const flagged = ingredients.filter((pi) => pi.ingredient.flaggedForResearch)
  const withStudies = flagged.filter((pi) => held(pi).studies > 0)
  const withAuthority = flagged.filter((pi) => held(pi).studies === 0 && held(pi).authorities > 0)
  const classifiedOnly = flagged.filter((pi) => held(pi).studies === 0 && held(pi).authorities === 0)

  return (
    <Collapsible
      id="flagged"
      // Michael, 2026-10-07: "this should just say Flagged Ingredients".
      // The count still leads, so this renders "3 flagged ingredients".
      title="flagged ingredients"
      count={flagged.length}
      countState={flagged.length > 0 ? 'openResearch' : undefined}
      note={
        flagged.length === 0
          ? 'Nothing flagged'
          : [
              withStudies.length > 0 ? `${withStudies.length} with studies` : null,
              withAuthority.length > 0 ? `${withAuthority.length} with an official ruling` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Nothing on file yet'
      }
      // THE THREE EXPLANATIONS, IN ONE TOOLTIP.
      //
      // Michael, 2026-10-08: "this info should be in the 'i' next to the
      // title. We do not need to show this information it is simply causing
      // text clutter and will turn off the layman."
      //
      // This section had three paragraphs of prose above three lists — about
      // 600 characters before a reader reached the first ingredient name. The
      // paragraphs were each true and each worth having; none of them was
      // worth being the first thing on the section.
      //
      // WHAT STAYED IN THE BODY, and the distinction is the three-state rule:
      // each group keeps its own one-line heading, because the heading is the
      // claim — "we hold research on these" and "classified as worth
      // checking, not yet researched" are different statements and a reader
      // must not have to hover to tell which list they are looking at. What
      // moved is the explanation of what the heading means.
      info={
        'Flagged means our classifier marked an ingredient as an additive or a processing ' +
        'ingredient rather than a whole food. It is not a finding that anything is harmful. ' +
        'The lists below are in order of what we actually hold: studies we can show you, ' +
        'then rulings published by a named agency in that agency\u2019s own words, then ' +
        'ingredients we have classified but not yet researched \u2014 which is a gap in our ' +
        'records rather than a verdict either way.'
      }
      open={flagged.length > 0}
    >
      <div style={{ marginTop: 4 }}>
        {flagged.length === 0 ? (
          <Callout state={signal.state}>{signal.detail}</Callout>
        ) : (
          <>
            {withStudies.length > 0 && (
              <>
                <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 600, color: colors.ink }}>
                  We hold research on these
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {withStudies.map((pi) => (
                    <FlaggedRow key={pi.ingredient.id} pi={pi} origin={origin} research={held(pi)} />
                  ))}
                </div>
              </>
            )}

            {withAuthority.length > 0 && (
              <div style={{ marginTop: withStudies.length > 0 ? 20 : 0 }}>
                <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 600, color: colors.ink }}>
                  An official ruling, but no study we hold{' '}
                  <Link href="/sourcing" style={{ color: colors.link, fontWeight: 400, fontSize: 12.5 }}>
                    what the agencies are
                  </Link>
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {withAuthority.map((pi) => (
                    <AuthorityRow key={pi.ingredient.id} pi={pi} origin={origin} />
                  ))}
                </div>
              </div>
            )}

            {classifiedOnly.length > 0 && (
              <div style={{ marginTop: withStudies.length > 0 || withAuthority.length > 0 ? 20 : 0 }}>
                {/* THE HEADING STAYS, THE PANEL AND THE CAVEAT GO.
                    Michael, 2026-10-08, pointing at this box: "remove this.
                    all disclaimers go to the disclaimer page, not included in
                    the browsing experience."

                    The sentence he is objecting to was "A gap in our records,
                    not a finding either way" — a caveat about what the list
                    does not mean, which is exactly the kind of line he has
                    now twice asked to collect in one place. It is on
                    /disclaimer.

                    "Classified as worth checking, not yet researched" is not
                    a caveat, it is the heading, and round 14 settled that the
                    heading is the claim: a reader must be able to tell which
                    of the three lists they are looking at without hovering.
                    So it stays — and now it is a plain bold line like the two
                    headings above it instead of a boxed grey panel, which is
                    how it should have looked from the start. */}
                {/* JUST THE WORD. Michael, 2026-10-13: "just say
                    Researching. No need for this giant sentence."

                    It read "Classified as worth checking, not yet
                    researched". Round 14 argued for that length on the
                    grounds that a heading is the claim and a reader must be
                    able to tell the three lists apart without hovering.
                    That held when the heading was all a reader had. It does
                    not hold now: the section's tooltip carries the full
                    explanation of what the flag means, and the two headings
                    above this one state what they hold, so this list is the
                    remainder by elimination. */}
                <p style={{ margin: '0 0 9px', fontSize: 13, fontWeight: 600, color: colors.ink }}>
                  Researching
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {classifiedOnly.map((pi) => (
                    <Link
                      key={pi.ingredient.id}
                      href={`/ingredients/${pi.ingredient.id}${origin}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        boxSizing: 'border-box',
                        padding: '5px 10px',
                        background: colors.card,
                        border: `1px solid ${colors.line}`,
                        borderRadius: 6,
                        fontSize: 13,
                        color: colors.ink,
                        textDecoration: 'none',
                      }}
                    >
                      {pi.ingredient.name}
                      {pi.ingredient.category && (
                        <span style={{ fontSize: 11, color: colors.ink4 }}>{pi.ingredient.category}</span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {(withStudies.length > 0 || withAuthority.length > 0) && (
          <SourceNote
            productId={productId}
            what={
              withStudies.length > 0 && withAuthority.length > 0
                ? 'Every study and classification above'
                : withStudies.length > 0
                  ? 'Every study above'
                  : 'Every classification above'
            }
          />
        )}
      </div>
    </Collapsible>
  )
}

// One flagged ingredient we actually hold research on.
function FlaggedRow({
  pi,
  origin,
  research,
}: {
  pi: IngredientRows[number]
  origin: string
  research: Research
}) {
  return (
    <Link
      href={`/ingredients/${pi.ingredient.id}${origin}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxSizing: 'border-box',
        padding: '13px 16px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderLeft: `4px solid ${status.openResearch.fg}`,
        borderRadius: layout.radius,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div style={{ fontFamily: font.display, fontSize: 17, fontWeight: 600 }}>
          {pi.ingredient.name}
        </div>
        <div style={{ fontSize: 12.5, color: colors.ink3, marginTop: 3 }}>
          {[
            pi.ingredient.category,
            pi.listPosition !== null ? `#${pi.listPosition} on the label` : null,
            pi.isTrace ? 'listed as a trace amount' : null,
            pi.concentrationNote,
            // Named here for the same reason the ingredient row names it:
            // the record belongs to the base dye, not to this lake.
            research.viaName ? `studied as ${sentenceCase(research.viaName)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      <StatusChip state="openResearch">
        {research.studies === 1 ? '1 study' : `${research.studies} studies`}
      </StatusChip>
      <span style={{ fontSize: 20, color: colors.link }} aria-hidden>
        &rsaquo;
      </span>
    </Link>
  )
}

// One flagged ingredient we hold no study on, but which a named authority has
// classified. The chip carries the STRONGEST classification on file, in the
// authority's own category name — not a count, and not a word of ours. A code
// we hold but have not written a plain-English reading for still gets a row;
// it just gets a neutral chip saying a classification exists, because the
// alternative is hiding a record we have.
function AuthorityRow({ pi, origin }: { pi: IngredientRows[number]; origin: string }) {
  const codes = [...pi.ingredient.authorityAssessments].sort(
    (a, b) => assessmentWeight(a.classificationCode) - assessmentWeight(b.classificationCode),
  )
  const strongest = classificationMeaning(codes[0].classificationCode)
  const extra = codes.length - 1

  return (
    <Link
      href={`/ingredients/${pi.ingredient.id}${origin}#authorities`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxSizing: 'border-box',
        padding: '13px 16px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderLeft: `4px solid ${strongest ? status[strongest.state].fg : colors.ink4}`,
        borderRadius: layout.radius,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div style={{ fontFamily: font.display, fontSize: 17, fontWeight: 600 }}>
          {pi.ingredient.name}
        </div>
        <div style={{ fontSize: 12.5, color: colors.ink3, marginTop: 3 }}>
          {[
            pi.ingredient.category,
            pi.listPosition !== null ? `#${pi.listPosition} on the label` : null,
            pi.isTrace ? 'listed as a trace amount' : null,
            pi.concentrationNote,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      {strongest ? (
        <StatusChip state={strongest.state} title={strongest.plain}>
          {strongest.label}
          {extra > 0 ? ` + ${extra} more` : ''}
        </StatusChip>
      ) : (
        <StatusChip state="nothingOnFile">
          {codes.length === 1 ? '1 classification' : `${codes.length} classifications`}
        </StatusChip>
      )}
      <span style={{ fontSize: 20, color: colors.link }} aria-hidden>
        &rsaquo;
      </span>
    </Link>
  )
}

// The three kinds of recall, kept apart on purpose. See the comments on
// getProductRecalls() in src/lib/recalls.ts: only a notice that lists this
// product's barcode is a recall OF this product. The other two are shown
// because a shopper should know about them, worded as what they are.
function Recalls({
  recalls,
  product,
}: {
  recalls: Awaited<ReturnType<typeof getProductRecalls>>
  product: { id: string; name: string; company: { legalName: string } }
}) {
  if (!recalls) return null
  const { thisProduct, brand, process } = recalls

  // THE MIDDLE BUCKET IS NOW BRAND-SCOPED. Michael, 2026-10-13: "one of the
  // recalls is for not M&Ms. The recalls should ONLY be for M&Ms in this
  // recall section, and others should be in 'other recalls by this
  // company'."
  //
  // `noticeNamesBrand` returns null when no brand could be derived from the
  // product name, and null means do not split — every company notice stays
  // here, which is the old behaviour. So a product whose name starts with a
  // generic word loses nothing. See the long note in recalls.ts.
  const sameBrand = brand.items.filter((it) => noticeNamesBrand(product.name, it) !== false)
  const otherBrands = brand.items.filter((it) => noticeNamesBrand(product.name, it) === false)

  // Grouped before counting, so the number in the collapsed header is the
  // number of recall EVENTS a reader would recognise, not the number of
  // enforcement records the agency happened to file.
  const listed = groupRecalls(thisProduct.items)
  const named = groupRecalls(sameBrand)
  // Re-sorted after the merge: the two source lists were each newest-first,
  // and concatenating two sorted lists does not give a sorted list.
  const processed = groupRecalls(
    [...otherBrands, ...process.items].sort(
      (a, b) => (b.actionDate?.getTime() ?? 0) - (a.actionDate?.getTime() ?? 0)
    )
  )
  const total = listed.length + named.length + processed.length

  return (
    // Collapsible, and closed by default: Michael asked for it, and on most
    // products this section is three lines of "nothing on file" that pushes
    // the ingredients off the screen. The count in the header is what makes
    // a closed section honest — you can see there is something here without
    // opening it.
    <Collapsible
      id="recalls"
      title="recalls and government notices"
      count={total}
      countState="recall"
      note={total === 0 ? 'Nothing on file' : 'FDA, FSIS, CPSC and CBP records'}
      info={GOVERNMENT_NOTICE}
      open={listed.length > 0}
    >
      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Group
          heading="Notices that list this product"
          empty="No government notice we hold lists this product."
          groups={listed}
          state="recall"
        />
        <Group
          heading={`Notices naming ${companyDisplayName(
            product.company.legalName
          )}, without naming this product`}
          empty={`No notice names ${companyDisplayName(
            product.company.legalName
          )} without naming a product.`}
          groups={named}
          state="nothingOnFile"
        />
        {processed.length > 0 && (
          <Group
            heading="Other recalls by this company"
            empty=""
            groups={processed}
            state="unchecked"
            // THIS SENTENCE WAS FALSE. It said "These name no product",
            // and the notice that prompted Michael's comment names three:
            // "specific varieties of SKITTLES Gummies, STARBURST Gummies, and
            // LIFE SAVERS Gummies". The bucket's condition is "has no link to
            // any product of ours", which is NOT the same as "names no
            // product" — it also catches notices that name products we failed
            // to match. So the wording now says what is true of both cases.
            /* TIGHTENED, NOT REMOVED. 42 words to 10. The fact it carries
                cannot go: every notice in this bucket names the company, not
                this product, and a list of recalls under a product heading
                reads as "this product was recalled" without saying so. That
                would be a false statement about a named company, which is the
                exact exposure the sourcing rules exist to prevent. This is
                not a caveat about our opinion; it is which fact is on screen.

                THE HEADING ABOVE CHANGED, 2026-10-12. Michael: "again, a
                skittles recall is not a notice regarding snickers. This
                section could instead say 'related recalls this company has
                had' not 'Notices about how food was made or handled' but the
                title of this section is misleading."

                It was. The bucket's rule is "a process-related food recall
                issued by this company or a parent, matched to no product of
                ours" — which describes how we FOUND the notice, not what a
                reader is looking at. The Skittles notice sitting under it
                names three product lines, none of them this one, and a
                heading about how food was handled told the reader nothing
                about that.
                The heading is now his wording, shortened. The limit it does
                not state — that this list is the process-related ones, not
                every notice the company has — is why the second sentence
                below points at the company page, which holds all of them. */
            // REWORDED 2026-10-13 with the brand split above. It used to
            // say these name the company "not this product", which was true
            // of the process notices but is now also home to notices that
            // DO name a product — another of the company's brands. The
            // sentence has to cover both, and still has to point at the
            // company page, because this list is the process-related
            // notices plus the other brands, not every notice the firm has.
            preamble={`Notices against ${companyDisplayName(
              product.company.legalName
            )} or a parent company that do not name this product. Its full record is on the company page.`}
          />
        )}
      </div>
      <SourceNote productId={product.id} what="Every notice above" />
    </Collapsible>
  )
}

function Group({
  heading,
  empty,
  groups,
  state,
  preamble,
}: {
  heading: string
  empty: string
  groups: RecallGroup[]
  state: keyof typeof status
  preamble?: string
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: colors.ink2,
        }}
      >
        <span>{heading}</span>
        <span style={{ fontFamily: font.mono, fontWeight: 500, color: colors.ink4 }}>{groups.length}</span>
        <span style={{ flexGrow: 1, height: 1, background: colors.line }} />
      </div>

      {preamble && (
        <p style={{ margin: '9px 0 0', fontSize: 12.5, lineHeight: 1.6, color: colors.ink3, maxWidth: 760 }}>
          {preamble}
        </p>
      )}

      {groups.length === 0 ? (
        <p style={{ margin: '9px 0 0', fontSize: 13, color: colors.ink3 }}>{empty}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          {groups.map((g) => (
            <RecallItemCard key={g.lead.id} g={g} state={state} />
          ))}
        </div>
      )}
    </div>
  )
}

// ONE RECALL NOTICE, COLLAPSED.
//
// Michael, 2026-10-07: "each of these individual recalls should be
// collapseable as well." Same reasoning as the sections two rounds ago, and
// it bites harder here: a company with seventeen notices produced seventeen
// full cards, each with its own "What it covered" box, so the page was
// several screens of recall before anything else on it could be reached.
//
// WHAT STAYS IN THE SUMMARY is the part that decides whether to open: the
// agency, the date, and the reason. The reason is the headline of a recall —
// collapsing that behind a chevron would make seventeen notices look
// identical and force you to open all of them.
//
// Native <details> again: no JavaScript, no hydration, and the nested
// .rt-collapse rules are all direct-child selectors so this sits inside the
// section's own <details> without the two fighting.
// WHICH PRODUCTS A NOTICE COVERED, SHORT ENOUGH FOR THE COLLAPSED ROW.
//
// Two comments from Michael, 2026-10-12, and one line answers both:
//   "again, a skittles recall is not a notice regarding snickers."
//   "2 recalls that contain the same exact information are here. This is too
//    redundant. Either don't omit too much information so there is a
//    meaningful difference, or take out one to avoid too much redundancy"
//
// He was on a Snickers page whose two brand notices summarised to the SAME
// sentence — "Contains peanuts that the label does not mention" — because
// both are peanut misbranding recalls: Combos in 2016, M&M's in 2014. The
// one fact that tells them apart was behind the chevron, in "What it
// covered". Dropping either card was the other option he offered and it is
// the wrong one: both are real notices against the named company, and
// choosing which government record a reader may see to cut repetition is
// not a thing this site does.
//
// So the distinguishing fact moves up. It is a VERBATIM EXCERPT of the
// agency's own productDescription, clipped at a word boundary — NOT a
// product name parsed out of it. The strings are inconsistent enough
// ("COMBOS  SNACK BUFFALO BLUE CHEESE PRETZEL - Net Wt. 1.80 (51 g)  oz",
// 'SKITTLES" Gummies  " Original  " Wild Berry') that any parser would
// eventually print the wrong product name on a recall, which is the one
// mistake here that actually matters. Only runs of whitespace are collapsed;
// the full text is two lines below, unchanged.
const COVERED_CHARS = 56

function coveredExcerpt(desc: string | null | undefined): string | null {
  if (!desc) return null
  const flat = desc.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  if (flat.length <= COVERED_CHARS) return flat
  const cut = flat.slice(0, COVERED_CHARS)
  const space = cut.lastIndexOf(' ')
  // A 56-character run with no space in it has no boundary to cut on, and a
  // hard cut beats printing the whole string.
  return `${(space > 24 ? cut.slice(0, space) : cut).trim()}\u2026`
}

function RecallItemCard({ g, state }: { g: RecallGroup; state: keyof typeof status }) {
  const item = g.lead
  const note = evidenceNote(item)
  const covered = coveredExcerpt(item.productDescription)
  // PLAIN WORDS IN THE SUMMARY, THE AGENCY'S IN THE BODY. Michael,
  // 2026-10-07: "these recalls and notices need to be heavily condensed and
  // explained to a 5 year old (not in baby talk but in concise simple
  // terms)". Returns null for a reason we cannot summarise safely, and then
  // the agency's own sentence is the headline as before — see plainRecall.ts.
  const plain = plainReason(item.reason)
  // How many agency records make up this one event. The FDA files one per
  // affected product line, so a single recall arrives as sixteen
  // near-identical records (see groupRecalls in recalls.ts). They are all
  // kept and all citable; they are just not read out one by one.
  const extra = g.items.length - 1
  // Is there anything behind the chevron? A notice with no description, no
  // evidence note and no sibling records has an empty body, and a control
  // that opens onto nothing is worse than no control. When we summarised the
  // reason, the agency's wording is itself body content.
  const hasBody = Boolean(plain) || Boolean(item.productDescription) || Boolean(note) || extra > 0

  const head = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {hasBody && (
          <svg
            className="rt-chev"
            aria-hidden
            width="9"
            height="9"
            viewBox="0 0 12 12"
            fill="none"
            stroke={colors.ink3}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 2l5 4-5 4" />
          </svg>
        )}
        <StatusChip state={state}>
          {item.sourceAgency}
          {item.classification ? ` · ${item.classification}` : ''}
        </StatusChip>
        {item.actionDate && (
          <span style={{ fontFamily: font.mono, fontSize: 12, color: colors.ink4 }}>
            {isoDate(item.actionDate)}
          </span>
        )}
        {item.status && <span style={{ fontSize: 12, color: colors.ink3 }}>{item.status}</span>}
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, color: colors.ink }}>
        {plain ? plain.text : item.reason}
      </p>
      {covered && (
        <p style={{ margin: '7px 0 0', fontSize: 12, lineHeight: 1.5, color: colors.ink3 }}>
          <strong style={{ fontWeight: 600, color: colors.ink2 }}>Covered: </strong>
          {covered}
        </p>
      )}
    </>
  )

  const body = (
    <>
      {/* THE AGENCY'S OWN SENTENCE, whenever the summary above is ours. This
          is what makes the paraphrase defensible: a reader can always check
          it against the original without leaving the page. */}
      {plain && (
        <p style={{ margin: '11px 0 0', fontSize: 12.5, lineHeight: 1.6, color: colors.ink3 }}>
          <strong style={{ color: colors.ink2 }}>The notice says: </strong>
          {item.reason}
        </p>
      )}

      {/* What the notice actually covered, in its own words. This is the box
          that stops a 2018 notice about one product line reading as a recall
          of everything the company makes. */}
      {item.productDescription && (
        <div
          style={{
            marginTop: 11,
            boxSizing: 'border-box',
            padding: '10px 12px',
            background: colors.panel,
            borderRadius: 6,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: colors.ink2,
          }}
        >
          <strong style={{ color: colors.ink }}>What it covered: </strong>
          {item.productDescription}
        </div>
      )}

      {note && (
        <p style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.6, color: colors.ink3 }}>
          {note}
        </p>
      )}

      {/* The one line that replaces fifteen repeated cards. */}
      {extra > 0 && (
        <p style={{ margin: '9px 0 0', fontSize: 12.5, color: colors.ink3 }}>
          The agency filed {g.items.length} records under this notice, one per affected product
          line.
        </p>
      )}

      {/* THE RECORD ITSELF, as a page a person can read. Michael,
          2026-10-07: "i dont think people will get any value out of a JSON
          file. Is there a more intelligent way to link this?" See
          /recalls/[id] — the agency URL for 94% of our notices is an
          api.fda.gov JSON endpoint, and FDA publishes no human page keyed by
          recall number, so the readable record has to be ours. */}
      <div style={{ fontSize: 11.5, marginTop: 10 }}>
        <Link href={`/recalls/${item.id}`} style={{ color: colors.link }}>
          Read the full notice
        </Link>
      </div>
    </>
  )

  const shell: React.CSSProperties = {
    boxSizing: 'border-box',
    padding: '14px 16px',
    background: colors.card,
    border: `1px solid ${colors.line}`,
    borderLeft: `4px solid ${status[state].fg}`,
    borderRadius: layout.radius,
  }

  if (!hasBody) {
    return (
      <div style={shell}>
        {head}
        <div style={{ fontSize: 11.5, marginTop: 10 }}>
          <Link href={`/recalls/${item.id}`} style={{ color: colors.link }}>
            Read the full notice
          </Link>
        </div>
      </div>
    )
  }

  return (
    <details className="rt-collapse" style={shell}>
      <summary style={{ cursor: 'pointer' }}>{head}</summary>
      {body}
    </details>
  )
}

// RELATED PRODUCTS — the shelf, not a recommendation.
//
// Replaces the certificates section. Michael, 2026-10-07: "At the very top we
// already provide it. Remove this for now. Instead, in this space maybe
// include a section for 'related products', where the user can find similar
// products (same type of product, similar ingredients (but not too similar,
// etc)."
//
// THE ORDERING IS SIMILARITY AND NOTHING ELSE. I put this to him before
// building it: a related shelf sorted by "fewer flagged ingredients" would be
// a trust score reintroduced sideways, and this site does not score products.
// So the number on each card is how much the two ingredient lists coincide,
// the heading says that, and nothing here implies the neighbour is better or
// worse than what you are looking at. See relatedProducts.ts for the measure
// and why it is Jaccard rather than share-of-their-list.
function Related({ set }: { set: RelatedSet }) {
  const total = set.similar.length + set.shorter.length
  return (
    <Collapsible
      id="related"
      title="similar products"
      count={total}
      note={total === 0 ? 'None found' : 'By shared ingredients'}
      open={total > 0}
    >
      <div style={{ marginTop: 4 }}>
        {total === 0 ? (
          <Callout state="nothingOnFile">
            We did not find another product with a similar ingredient list. That usually means we
            hold no ingredient list for this product, or none of the products we checked in this
            category shared enough of it.
          </Callout>
        ) : (
          <>
            {/* THE PARAGRAPH THAT WAS HERE IS GONE. Michael, 2026-10-08:
                "we dont need to disclaim on the actual website. we will have
                a separate page for disclaimers. please take all disclaimers
                out everywhere that isnt the specific disclaimer page."

                It explained that the percentage measures similarity rather
                than quality and that the order implies no ranking. That
                commitment has NOT been dropped — it is the no-scoring rule
                this whole site is built on, and it is now stated once on
                /disclaimer and once on /sourcing instead of restated on
                every product page.
                What replaces it is the cards doing their own work: each one
                reads "28% overlap · 7 of 25 ingredients shared", which is a
                figure a reader can check against the two labels. A statistic
                that explains itself needs no paragraph defending it. */}
            <Shelf products={set.similar} />

            {/* THE SECOND SHELF. Michael, 2026-10-07: "maybe any products
                that try to mock M&Ms but use better ingredients should also
                apply. add that to the algorithm."
                Ordered by how many ingredients are on the label, which is a
                count off the packet rather than a judgement — see the long
                note in relatedProducts.ts for why it is not "fewer
                additives" yet. */}
            {set.shorter.length > 0 && (
              <div style={{ marginTop: set.similar.length > 0 ? 20 : 0 }}>
                {/* Michael, 2026-10-08: "this description is too wordy.
                    exclude the number of the list."
                    Three sentences became one line. The count he objected to
                    ("this product lists 21") is gone from the prose; each
                    card still carries "12 ingredients vs 21 here", which is
                    where a comparison belongs — next to the thing being
                    compared, not in a preamble above all of them. */}
                <p
                  style={{
                    margin: '0 0 11px',
                    fontSize: 13.5,
                    color: colors.ink,
                    fontWeight: 600,
                  }}
                >
                  Same kind of product, shorter ingredient list
                </p>
                <Shelf products={set.shorter} myTotal={set.myTotal} />
              </div>
            )}
          </>
        )}
      </div>
    </Collapsible>
  )
}

function Shelf({ products, myTotal }: { products: RelatedProduct[]; myTotal?: number }) {
  return (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 10,
              }}
            >
              {products.map((p) => (
                <Link
                  key={p.id}
                  href={`/products/${p.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    boxSizing: 'border-box',
                    padding: '12px 14px',
                    background: colors.card,
                    border: `1px solid ${colors.line}`,
                    borderRadius: layout.radius,
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <ProductThumb
                    product={p}
                    category={p.category}
                    productType={p.productType}
                    size={48}
                    intrinsic={120}
                    label={relatedTitle(p)}
                  />
                  <span style={{ flexGrow: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 13.5,
                        fontWeight: 600,
                        lineHeight: 1.35,
                        color: colors.ink,
                      }}
                    >
                      {relatedTitle(p)}
                    </span>
                    <span style={{ display: 'block', fontSize: 11.5, color: colors.ink3, marginTop: 3 }}>
                      {companyDisplayName(p.company.legalName)}
                    </span>
                    {/* The raw counts as well as the percentage. "12 of 43"
                        can be checked against the two ingredient lists;
                        "28%" on its own cannot. */}
                    <span style={{ display: 'block', fontSize: 11, color: colors.ink4, marginTop: 3 }}>
                      {myTotal === undefined
                        ? `${p.percent}% overlap · ${p.shared} of ${p.distinct} ingredients shared`
                        : `${p.theirTotal} ingredients vs ${myTotal} here · ${p.shared} shared`}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
  )
}

// WHAT WE HOLD ON ONE INGREDIENT, after the lake-to-dye step.
//
// `viaName` is set only when the record belongs to a DIFFERENT ingredient
// than the row — a colour lake showing its base dye's research. When it is
// set, the row must print it. The whole defence of borrowing the record is
// that the reader can see whose record it is.
type Research = {
  studies: number
  authorities: number
  viaName?: string
  viaId?: string
}

function Ingredients({
  ingredients,
  product,
  hasOrder,
  signal,
  origin,
  research,
}: {
  ingredients: IngredientRows
  product: { id: string; ingredientSource: string | null; ingredientDisclosureStatus: string }
  hasOrder: boolean
  signal: Signal
  // The querystring that tells the ingredient page how to get back here.
  origin: string
  // Decided once in the page component, so this list and the flagged
  // section below it cannot disagree. Keyed by ingredient id.
  research: Map<string, Research>
}) {
  // COLLAPSIBLE, like every other section.
  //
  // I argued last round that this one should stay open because it is the
  // reason the page exists. Michael, twice: "Every single section should be
  // collapseable on every single page." He is right that consistency beats
  // my per-section judgement — a page where some headings fold and others do
  // not is a page where the reader has to find out which is which.
  //
  // It opens by default, which keeps the round-7 reordering intact: the
  // ingredient list is still the first thing you read.
  return (
    <Collapsible
      id="ingredients"
      // Michael, 2026-10-07: "this should just say Ingredients".
      title="ingredients"
      count={product.ingredientDisclosureStatus === 'disclosed' ? ingredients.length : null}
      note={hasOrder ? 'In label order' : 'Label order not recorded'}
      open
    >
      <div style={{ marginTop: 4 }}>
        {product.ingredientDisclosureStatus !== 'disclosed' ? (
          <Callout state={signal.state}>{signal.detail}</Callout>
        ) : (
          <>
            <IngredientSummary ingredients={ingredients} />
            <AdditiveLegend ingredients={ingredients} />
            <div className="rt-inglist" style={{ marginTop: 11 }}>
              {ingredients.map((pi) => (
                <IngredientRow
                  key={pi.ingredient.id}
                  pi={pi}
                  origin={origin}
                  research={research.get(pi.ingredient.id) ?? { studies: 0, authorities: 0 }}
                />
              ))}
            </div>
            <SourceNote productId={product.id} what="This ingredient list" />
          </>
        )}
      </div>
    </Collapsible>
  )
}

// THE FAST READ, ABOVE THE LIST.
//
// Three numbers a shopper can take in without reading anything: how many
// ingredients the label has, how many of them the label calls organic, and
// how many we are researching. The last of those is the only one with a
// colour, and only when it is not zero.
//
// These are counts of rows we hold, not claims about the food. "18 listed as
// organic" says the label said so for 18 of them — the wording has to carry
// that, because an organic CERTIFICATE is a different record on this page and
// a reader should not come away thinking the two are the same thing.
// ONE TITLE SCHEMA, INCLUDING HERE. Michael, 2026-10-13, with the comment
// pinned to a card on this shelf: "These products need to have professional
// looking title names. Capitalize first letters where appropriate (excluding
// non important prepositions ...) so we can have a standard title schema".
//
// Every other surface already routed its product names through
// productDisplayName — search rows, the product h1, company cards, the
// sources page — and this shelf printed `p.name` raw, so it was the one
// place a lower-case Open Food Facts name reached the screen untouched.
// titleCaseName now lives inside productDisplayName, so sending this shelf
// through the same function fixes the casing and strips the repeated brand
// in one step, and no surface can drift from the schema again.
function relatedTitle(p: RelatedProduct): string {
  return productDisplayName(p.name, p.company.legalName)
}

function IngredientSummary({ ingredients }: { ingredients: IngredientRows }) {
  const organic = ingredients.filter((pi) => pi.isOrganicSourced).length
  const flagged = ingredients.filter((pi) => pi.ingredient.flaggedForResearch).length

  // Which kinds of additive are on this label, with how many of each. Read
  // off Ingredient.category, so it says the same thing the search filters
  // mean by the same words.
  const kinds = new Map<string, number>()
  for (const pi of ingredients) {
    const c = pi.ingredient.category
    if (c) kinds.set(c, (kinds.get(c) ?? 0) + 1)
  }
  const byKind = [...kinds.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

  const facts: { text: string; color?: string }[] = [
    { text: `${ingredients.length} on the label` },
    ...(organic > 0 ? [{ text: `${organic} listed as organic`, color: status.confirmed.fg }] : []),
    ...(flagged > 0
      ? [{ text: `${flagged} we are researching`, color: status.openResearch.fg }]
      : []),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {facts.map((fact) => (
          <span
            key={fact.text}
            style={{ fontSize: 13, fontWeight: 600, color: fact.color ?? colors.ink2 }}
          >
            {fact.text}
          </span>
        ))}
      </div>
      {byKind.length > 0 && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {byKind.map(([kind, n]) => (
            // Each kind links to the search filtered to products WITHOUT it,
            // which is the thing someone reading this list wants next.
            <Link
              key={kind}
              href={filterHref(kind)}
              title={`Find products with no ${kind}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 9px',
                background: colors.panel,
                borderRadius: 99,
                fontSize: 12,
                color: colors.ink2,
                textDecoration: 'none',
              }}
            >
              <span style={{ fontFamily: font.mono, fontWeight: 700, color: colors.ink }}>{n}</span>
              {kind}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// A category chip links to the search filter that excludes it, when there is
// one. INGREDIENT_FILTERS is keyed by filter, each covering one or more
// category values, so the lookup runs the other way round.
function filterHref(category: string): string {
  const filter = INGREDIENT_FILTERS.find((f) => f.categories.includes(category))
  return filter ? `/search?free=${filter.key}` : `/search?without=${encodeURIComponent(category)}`
}

// ONE INGREDIENT, ONE ROW.
//
// What each row says, left to right: where it sits on the label, what it is
// called, and what we know about it. Nothing is ranked and nothing is
// scored — the amber on a flagged row is the same amber the rest of the site
// uses for "there is research to read", and a row with nothing on file is
// plain, not green.
// THE LEGEND, AND ONLY FOR THIS LABEL.
//
// Michael, 2026-10-13: "we should categorize ingredients based on color and
// have a VERY concise legend about them up here."
//
// So it prints only the families this product actually has. A label with two
// dyes and a preservative gets two entries, not the whole scheme — a legend
// listing colours that are not on screen is a thing you have to read twice.
//
// WHAT IS DELIBERATELY NOT HERE: an entry for the uncoloured rows. There is
// no honest one-word label for them. "Natural" is the obvious choice and it
// would be false: on the M&M'S label that prompted all of this,
// `hydrogenated palm kernel oil`, `cornstarch` and `dextrin` carry no
// category, and 355 of our 579 hydrogenated-oil names are unclassified
// (features item 34). An uncoloured row means "no category on file", which
// is a fact about OUR records, not about the food. The one line under the
// swatches says exactly that, and it is the only sentence in this block.
function AdditiveLegend({ ingredients }: { ingredients: IngredientRows }) {
  const families = familiesPresent(ingredients.map((pi) => pi.ingredient.category))
  if (families.length === 0) return null

  return (
    <div style={{ marginTop: 11, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '7px 14px' }}>
      {/* AN "i" ON EVERY ENTRY. Michael, 2026-10-13: "put a little 'i' next
          to each category so the user can understand what each means."
          This is also what made the preservative/emulsifier split workable
          in the same round: a legend entry that explains itself does not
          need its hue to do the explaining, so seven families stopped being
          more than the colours could carry.
          The text comes from familyHelp(), which the ingredient rows use
          too, so a family cannot be described two ways on one page. */}
      {families.map((key) => (
        <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <AdditiveMark family={key} size="legend" />
          <span style={{ fontSize: 11.5, color: colors.ink2 }}>{additive[key].label}</span>
          <InfoDot text={familyHelp(key)} />
        </span>
      ))}
      <span style={{ fontSize: 11.5, color: colors.ink4 }}>
        The code on a row is the first two letters of its family above
      </span>
      <span style={{ fontSize: 11.5, color: colors.ink4 }}>
        Unmarked rows have no category on file · not a finding that they are natural
      </span>
    </div>
  )
}

function IngredientRow({
  pi,
  origin,
  research,
}: {
  pi: IngredientRows[number]
  origin: string
  research: Research
}) {
  // WHAT THE ROW SHOWS, AFTER 2026-10-13.
  //
  // Four of Michael's comments on one M&M'S page were one redesign:
  //   "we should categorize ingredients based on color"
  //   "preservatives and emulsifiers should get their own text highlight
  //    color ... We need to distinctify them from natural ingredients"
  //   "why are the lake variants not highligheted?"
  //   "it feels like this section is way too large: the rows have too much
  //    space and we can fit all these ingredients into view so the user
  //    doesnt have to scroll down."
  //
  // They resolve together. The LEFT RULE now carries which class of additive
  // this is, read off Ingredient.category and explained by the legend above
  // the list. That frees the grey category line that used to sit under every
  // name, which is what was making the rows 44px tall. Without it a row is
  // about 26px, so a 32-ingredient label fits in one view at three columns.
  //
  // Dropping that line reverses a round-15 instruction — "leave the
  // 'undisclosed flavorin' subtext" — and he agreed to the trade when asked,
  // because the colour plus the legend now carry the same fact. The exact
  // category is still on the row, in its tooltip, so nothing is lost: the
  // legend says "Preservative or emulsifier" and the hover says which.
  //
  // AMBER MOVED OFF THE LEFT RULE and onto a small dot. It means "there is
  // research to read" everywhere on this site, and the rule cannot carry
  // both that and the additive class without one of them becoming noise.
  const family = familyFor(pi.ingredient.category)
  const hasResearch = research.studies > 0 || research.authorities > 0

  // What we hold, for the tooltip. Studies and authority classifications are
  // counted separately and never added together: a classification is a
  // committee reading evidence we may not hold, which is the distinction
  // /sourcing exists to explain.
  const holding =
    research.studies > 0
      ? `${research.studies} research ${research.studies === 1 ? 'record' : 'records'}`
      : research.authorities > 0
        ? `${research.authorities} authority ${research.authorities === 1 ? 'ruling' : 'rulings'}`
        : null

  // THE DEFINITION IS IN HERE TOO. Michael, 2026-10-13, asked for an "i" on
  // every ingredient so a reader can hover and learn what it is. The whole
  // row is already the hover target, and it now carries what the class
  // means, in the same words the legend uses.
  //
  // A SEPARATE "i" GLYPH ON ALL 32 ROWS WAS NOT ADDED, and this is a
  // judgement to overrule rather than a thing forgotten. Round 18 cut the
  // row from 44px to 26px at his request, to fit a long label in one view;
  // 32 more glyphs put weight straight back into the line the density came
  // out of. Raised in thread with an offer to add them anyway.
  const tip = [
    pi.ingredient.category ? `Classified as: ${pi.ingredient.category}` : 'No category on file',
    categoryHelp(pi.ingredient.category),
    holding
      ? research.viaName
        ? `${holding} on ${sentenceCase(research.viaName)}, the dye this lake is made from`
        : holding
      : null,
  ]
    .filter(Boolean)
    .join(' \u2014 ')

  return (
    <Link
      href={`/ingredients/${pi.ingredient.id}${origin}`}
      title={tip}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        boxSizing: 'border-box',
        padding: '4px 8px 4px 8px',
        borderLeft: `3px solid ${family ? additive[family].fg : 'transparent'}`,
        borderBottom: `1px solid ${colors.line}`,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      {/* The label position. Absent when the source record did not keep the
          order, and then the column is simply empty rather than guessed. */}
      <span
        style={{
          flexShrink: 0,
          minWidth: 16,
          fontFamily: font.mono,
          fontSize: 10.5,
          color: colors.ink4,
          textAlign: 'right',
        }}
      >
        {pi.listPosition ?? ''}
      </span>

      <span style={{ flexGrow: 1, minWidth: 0, fontSize: 13, lineHeight: 1.45 }}>
        {/* THE NAME IS INK AGAIN, AND THE FAMILY MOVED TO THE MARK.
            Michael, 2026-10-13: "its hard to see the colors when the text is
            highlighted". Tinting the ingredient name put the family on the
            one element a reader selects, and a selection replaces the text
            colour outright — so the family went invisible at exactly the
            moment someone was trying to copy the name and look it up.
            It was also the weakest possible place for it: hue is far harder
            to judge on thin 13px glyphs than on a solid block.
            The weight stays, because bold-vs-regular is a third channel that
            costs nothing and survives greyscale. */}
        {family && <AdditiveMark family={family} />}{family ? ' ' : null}
        <span style={{ color: colors.ink, fontWeight: family ? 500 : 400 }}>
          {sentenceCase(pi.ingredient.name)}
        </span>

        {/* RESEARCH, AS ITS OWN MARK. A filled amber dot, not a tint and not
            a bold weight: the row's colour and weight are already saying
            which additive class this is. */}
        {hasResearch && (
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 5,
              height: 5,
              marginLeft: 6,
              verticalAlign: 'middle',
              borderRadius: '50%',
              background: status.openResearch.fg,
            }}
          />
        )}

        {/* WHOSE RECORD IT IS. Printed, not hidden in the tooltip. Borrowing
            the base dye's research is only defensible if the reader can see
            that is what happened. */}
        {research.viaName && (
          <span style={{ marginLeft: 6, fontSize: 10.5, color: colors.ink3 }}>
            studied as {sentenceCase(research.viaName)}
          </span>
        )}

        {pi.isOrganicSourced && (
          <span
            title="Listed on the label as an organic ingredient"
            style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: status.confirmed.fg }}
          >
            ORG
          </span>
        )}
        {pi.isTrace && (
          <span title="Listed as a trace amount" style={{ marginLeft: 6, fontSize: 10, color: colors.ink4 }}>
            trace
          </span>
        )}
      </span>
    </Link>
  )
}

// Ingredient names are stored lower case, because that is how they are
// matched and counted. A label does not read "corn meal, whole grain rolled
// oats"; printing them as stored made the list look like a database dump.
// Only the first letter changes — anything else would be us deciding how a
// brand capitalises its own ingredients.
function sentenceCase(name: string): string {
  return name.length === 0 ? name : name[0]!.toUpperCase() + name.slice(1)
}


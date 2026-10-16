'use client'

import { useSearchParams } from 'next/navigation'
import { BackBar } from './BackBar'
import { aisleLabel } from '@/lib/aisles'

// WHY THESE READ THE URL ON THE CLIENT.
//
// The product page and the ingredient page are two of 543,633 generated
// pages. Reading `searchParams` in a server component opts a route out of
// caching UNCONDITIONALLY, so every one of those pages was rendering from
// scratch on every request -- full server render plus its database queries,
// for every crawler hit. On 2026-10-16 that exhausted the Vercel Fluid
// Active CPU allowance and the whole project was paused.
//
// The only thing those pages read from the query string was a back link.
// Navigation context, not content: the page body does not vary by it. So the
// back link moved here, to the client, where the query string is readable
// without making the page dynamic, and the pages themselves became
// cacheable. See claude/runbook-serving-and-caching.md.
//
// BOTH OF THESE MUST BE RENDERED INSIDE A <Suspense> BOUNDARY. On a static
// page, useSearchParams suspends: `next build` fails without one, and
// `next dev` does not, because dev renders every route on demand. The
// boundary also limits how far up the client tree gets de-opted to
// client-side rendering. Do not remove the wrappers in the two pages.
//
// THE ONE VISIBLE CONSEQUENCE: a cached page cannot know the query string at
// render time, so `useSearchParams` is empty during the prerender and the bar
// appears on hydration rather than in the first paint. It is 44px of shift,
// once, and only for readers who arrived with a `?from=` -- that is, readers
// mid-session who just clicked a result. A reader arriving cold has no `from`
// and sees no bar, which is the behaviour this component always had.

// THE BREADCRUMB IS GONE. Michael, across rounds 12, 14 and 15:
// "why is it that if i click on a product in search, the company page shows
// up as history when it was never clicked on?", "why am i getting the
// campbells company in the tab history bar here? i never clicked on the
// campbells page", "again i never clicked on the ingredients page. why is
// this present in the tab history?", and — on the same bar — "this doesnt go
// back to the dairy and eggs filter i applied, it just generally goes back to
// the generic search".
//
// Four complaints, one diagnosis. A breadcrumb shows where a page SITS in a
// hierarchy; he has read it as where he has BEEN every single time. Round 14
// trimmed one entry out of the product trail and the complaint came straight
// back on the next page that had one. The component was not mislabelled or
// mis-ordered — it was answering a question nobody asked, on nine pages.
//
// What he actually wants is the last line: take me back to the list I came
// from, with my filters still on. That is knowable, but not from the current
// URL — a server component cannot see where the reader has been. So the
// origin travels in the link: a search result row links to
// /products/<id>?from=<its own querystring>, and the product page renders
// BackLink from that. No `from`, no link, because arriving from a bookmark
// means there is genuinely nowhere to go back to.
//
// This is deliberately NOT a trail. One link, one destination, and it is the
// destination he asked for.
export function BackToResultsFromUrl({ fallbackLabel }: { fallbackLabel?: string }) {
  const sp = useSearchParams()
  const from = sp.get('from') ?? undefined
  if (!from) return null

  // `from` is a querystring we minted ourselves on the originating page, but
  // it arrives through the URL where anyone can retype it, so it is treated
  // as untrusted: parsed, filtered to the parameters Search actually reads,
  // and rebuilt. That makes an open-redirect or a javascript: href
  // impossible — the href is always /search plus known keys.
  let params: URLSearchParams
  try {
    params = new URLSearchParams(from.startsWith('?') ? from.slice(1) : from)
  } catch {
    return null
  }

  // Exactly the keys /search reads, and no others: q, aisle, free (category
  // filters), without (typed exclusions), no (allergens), per, page. Anything
  // else in `from` is dropped rather than forwarded.
  const ALLOWED = ['q', 'aisle', 'free', 'without', 'no', 'per', 'page'] as const
  const FILTER_KEYS = ['free', 'without', 'no'] as const
  const clean = new URLSearchParams()
  for (const key of ALLOWED) {
    const v = params.get(key)
    if (v) clean.set(key, v)
  }

  const qs = clean.toString()
  const href = qs ? `/search?${qs}` : '/search'

  // The label names the list rather than the action, so it reads as a place
  // instead of a browser button.
  const q = clean.get('q') ?? ''
  const aisleName = aisleLabel(clean.get('aisle') ?? undefined)
  const filters = FILTER_KEYS.reduce((n, k) => n + (clean.get(k) ? 1 : 0), 0)
  const label = q
    ? `Back to \u201c${q}\u201d`
    : aisleName
      ? `Back to ${aisleName}`
      : filters > 0
        ? 'Back to your filtered results'
        : (fallbackLabel ?? 'Back to results')

  return <BackBar href={href} label={label} />
}

// THE WAY BACK TO A PRODUCT, from an ingredient page.
//
// This replaces a server function that looked the product up in the database
// to print its name. That lookup ran on every ingredient page view, and it
// existed to serve a case that cannot actually reach it.
//
// WHY. The bar is rendered inside VisitTrail, which keeps the pages actually
// opened in this tab in sessionStorage and shows them whenever it holds two
// or more stops -- falling back to this component only when it holds fewer.
// So if the reader really did walk product -> ingredient, VisitTrail has both
// stops and renders the real trail, naming the product from its own record of
// having been there. This component only renders when sessionStorage is empty
// or holds one stop, which means the reader did NOT come from that product in
// this tab: they opened the URL cold, from a shared link or a bookmark. The
// database was being asked for the name of a page the reader had never been
// on, 127,268 pages' worth of query, to label a journey that did not happen.
//
// SO THE LABEL IS GENERIC AND THE HREF IS STILL SAFE. `from` is accepted only
// as `p:` plus a uuid and nothing from it is ever printed, which was the
// original rule and is unchanged -- the href is always /products/<uuid>, so
// there is no open redirect and no injected text. What is lost is the product
// NAME in that cold-open case: "Back to this product" instead of "Back to
// Snickers". What is also lost is the old behaviour of rendering no link at
// all for a uuid naming no product, since confirming that needed the query;
// a crafted uuid now yields a link to a 404 rather than nothing.
//
// THAT TRADE IS LOGGED as an open decision in features-to-add.md rather than
// treated as settled. Restoring the name costs a cached route handler and a
// client fetch, and it is worth doing if the cold-open path turns out to
// matter; it is not worth a database query on every page view to find out.
export function BackToProductFromUrl() {
  const sp = useSearchParams()
  const from = sp.get('from') ?? undefined
  if (!from || !from.startsWith('p:')) return null

  const id = from.slice(2)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null

  // `pfrom` carries the product page's own origin so the chain keeps walking
  // backwards. It is passed straight through and re-parsed by
  // BackToResultsFromUrl on arrival, exactly as before, so it is never
  // trusted as given. The product page no longer puts it on the ingredient
  // links it renders -- a cached page cannot know its own query string -- so
  // in practice it is present only on a hand-built or shared URL.
  const pFrom = sp.get('pfrom')
  const qs = pFrom ? `?from=${encodeURIComponent(pFrom)}` : ''

  return <BackBar href={`/products/${id}${qs}`} label="Back to this product" />
}

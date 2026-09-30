// A small banner component showing when each data source was last refreshed,
// and flagging clearly if any source has gone stale (past the 45-day threshold
// set in staleness.ts). Meant to be dropped into any page — e.g. the top of
// the /companies list — so staleness is visible to whoever's looking at the app,
// not just something you'd notice by manually checking IngestionLog.
import { getAllFreshnessStatuses } from '@/lib/staleness'

// Human-readable labels for each internal source name, so the banner doesn't
// show raw identifiers like "usda_oid" to whoever's reading it
const SOURCE_LABELS: Record<string, string> = {
  usda_oid: 'USDA Organic Certification',
  fda_recalls: 'FDA Recalls',
  cpsc_recalls: 'CPSC Recalls',
  cbp_forced_labor: 'CBP Forced Labor (WROs & Findings)',
  open_food_facts: 'Open Food Facts (nutrition & ingredients)',
  open_beauty_facts: 'Open Beauty/Products Facts (non-food ingredients)',
  sec_edgar: 'SEC EDGAR (investor filings)',
  fda_warning_letters: 'FDA Warning Letters',
  nongmo_project: 'Non-GMO Project Verified',
  nonupf_project: 'Non-UPF Verified',
  fsis_recalls: 'USDA FSIS Recalls (meat, poultry, egg)',
  usda_fooddata_central: 'USDA FoodData Central (label verification)',
}

// This is a Server Component (no "use client" needed) since it just reads
// data and renders — no interactivity required
export default async function DataFreshnessBanner() {
  const statuses = await getAllFreshnessStatuses()
  const anyStale = statuses.some((s) => s.isStale)

  // If everything is fresh, don't show anything at all — the banner should
  // only draw attention when there's actually something to flag
  if (!anyStale) return null

  return (
    <div
      style={{
        background: '#fff3cd',
        border: '1px solid #ffe69c',
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        marginBottom: '1.5rem',
        fontSize: '0.9rem',
      }}
    >
      <strong>Data freshness notice:</strong>
      <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
        {statuses
          .filter((s) => s.isStale)
          .map((s) => (
            <li key={s.source}>
              {SOURCE_LABELS[s.source] ?? s.source}:{' '}
              {s.lastRanAt
                ? `last refreshed ${s.daysSinceLastRun} day(s) ago (${s.lastRanAt.toLocaleDateString()})`
                : 'has never been run'}
              — a refresh is overdue.
            </li>
          ))}
      </ul>
    </div>
  )
}

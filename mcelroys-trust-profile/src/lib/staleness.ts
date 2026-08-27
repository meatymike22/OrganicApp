// Shared helper for checking whether ingested data is "stale" — i.e. it's been
// too long since a given ingestion source last successfully ran.
import { prisma } from '@/lib/prisma'

// How many days old a source's last run can be before we consider it stale.
// 45 days gives a monthly cadence some buffer (a few days late isn't a crisis),
// while still catching a genuinely missed refresh.
const STALE_THRESHOLD_DAYS = 45

export type FreshnessStatus = {
  source: string
  lastRanAt: Date | null
  daysSinceLastRun: number | null
  isStale: boolean
}

// Checks a single ingestion source (e.g. "usda_oid", "fda_recalls") and returns
// how fresh its data is, based on the most recent IngestionLog entry for that source.
export async function getFreshnessStatus(source: string): Promise<FreshnessStatus> {
  const lastRun = await prisma.ingestionLog.findFirst({
    where: { source },
    orderBy: { ranAt: 'desc' },
  })

  if (!lastRun) {
    // No run has ever been logged for this source at all — treat as stale,
    // since there's nothing to show a "last refreshed" date for
    return { source, lastRanAt: null, daysSinceLastRun: null, isStale: true }
  }

  const msSinceLastRun = Date.now() - lastRun.ranAt.getTime()
  const daysSinceLastRun = Math.floor(msSinceLastRun / (1000 * 60 * 60 * 24))

  return {
    source,
    lastRanAt: lastRun.ranAt,
    daysSinceLastRun,
    isStale: daysSinceLastRun > STALE_THRESHOLD_DAYS,
  }
}

// Convenience function to check every known ingestion source at once —
// add new source names here as you add more ingestion scripts. These strings
// must match the "source" value each script writes to IngestionLog.
export async function getAllFreshnessStatuses(): Promise<FreshnessStatus[]> {
  const sources = [
    'usda_oid',
    'fda_recalls',
    'cpsc_recalls',
    'cbp_forced_labor',
    'open_food_facts',
    'open_beauty_facts',
  ]
  return Promise.all(sources.map(getFreshnessStatus))
}
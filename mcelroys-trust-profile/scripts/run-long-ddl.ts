// RUN A LONG DDL STATEMENT THAT NOTHING WILL CUT OFF.
//
// WHY THIS SCRIPT EXISTS. Building
// ProductIngredient_ingredientId_productId_idx failed three times on
// 2026-10-15, each time for a DIFFERENT reason, and none of them was the
// index:
//
//   1. `prisma migrate dev` -> ERROR 57014 "canceling statement due to
//      statement timeout". The server imposes statement_timeout = 2min and
//      Prisma cannot raise it for a migration.
//
//   2. Supabase SQL Editor -> "Failed to fetch (api.supabase.com)". That is
//      the dashboard's HTTP GATEWAY timing out, not the database. When the
//      gateway drops the request the client disconnects, and Postgres then
//      CANCELS the statement. The build dies every time, however long you
//      wait, and the error message says nothing about a timeout.
//
//   3. Submitting it twice (because of 2) left TWO concurrent builds of the
//      same index, each waiting on the other’s buffer reads
//      (wait_event IPC/BufferIo). They roughly halved each other’s speed and
//      pegged the CPU. Confirmed in pg_stat_activity, not guessed.
//
// THE COMMON FACTOR is that every route to the database had a timeout shorter
// than the work. This script removes all three: a direct client connection
// (no HTTP gateway), statement_timeout disabled for the session, and the
// process lives as long as it needs to.
//
// IT ALSO REPORTS REAL PROGRESS, which the other routes cannot. Postgres
// exposes pg_stat_progress_create_index, so this prints the phase and the
// block/tuple counts every few seconds instead of leaving you watching a
// spinner and wondering whether to give up.
//
// IT IS NOT ONLY FOR DDL. Any statement that can outlive a gateway timeout
// belongs here -- VACUUM and ANALYZE have exactly the same problem, and
// Postgres reports their progress through a different view, so each job names
// the view that reports it.
//
// USAGE
//   npx tsx scripts/run-long-ddl.ts --list
//   npx tsx scripts/run-long-ddl.ts <job>
//   npx tsx scripts/run-long-ddl.ts <job> --live
//
// Dry run by default: it prints the SQL and checks whether the object already
// exists, and writes nothing without --live.
//
// AFTER IT SUCCEEDS, tell Prisma the migration is done WITHOUT re-running the
// SQL, or the next `migrate dev` will try to create the index again:
//
//   npx prisma migrate resolve --rolled-back 20261015181837_product_ingredient_covering_index
//   npx prisma migrate resolve --applied     20261015181837_product_ingredient_covering_index
//   npx prisma generate
//
// The index name and definition here are IDENTICAL to the ones in that
// migration’s migration.sql, which is what makes resolve --applied honest
// rather than a lie that shows up as drift later.

import 'dotenv/config'
import { Client } from 'pg'

// WHAT A JOB IS. Only `sql` and `note` are required; the rest describe how to
// tell whether the job is already done and how Postgres reports it running.
type Job = {
  sql: string
  note: string
  // IDEMPOTENCY CHECK, run before the statement and again after it. Zero rows
  // means the object does not exist yet. OMIT IT for a job that is always safe
  // to run again and creates nothing -- VACUUM, ANALYZE -- where there is no
  // "already done" state to detect and skipping would be wrong.
  verify?: string
  // True when a verify row reporting indisvalid = false means a previous
  // attempt died part-way and left a corpse that has to be dropped by hand.
  invalidMeansRetry?: boolean
  // WHICH pg_stat_progress_* VIEW REPORTS THIS STATEMENT. Postgres has one per
  // operation and they share no columns, so the view and the columns worth
  // printing are named per job. Omitted means no progress reporting exists and
  // only elapsed time is printed.
  progress?: { view: string; columns: string[] }
  // Follow-up commands the operator must not forget, printed on success.
  then?: string[]
}

// EVERY LONG STATEMENT WE HAVE NEEDED, BY NAME. Kept as a registry rather than
// taking arbitrary SQL on the command line: this script exists to run known,
// reviewed statements against a production database, and accepting free-form
// SQL from a shell argument is a different and much worse tool.
const JOBS: Record<string, Job> = {
  product_ingredient_covering_index: {
    // CONCURRENTLY, because the site is live and taking traffic. A plain
    // CREATE INDEX takes a lock that blocks writes for the whole build; this
    // one does not block them at all. It costs roughly two passes over the
    // table instead of one, which is a fair trade when the alternative is
    // blocking the app.
    //
    // IF THIS FAILS PART-WAY it leaves an INVALID index behind, which the
    // verify step below detects. Postgres will not use an invalid index, so
    // nothing breaks, but it must be dropped before retrying:
    //   DROP INDEX "ProductIngredient_ingredientId_productId_idx";
    sql: 'CREATE INDEX CONCURRENTLY "ProductIngredient_ingredientId_productId_idx" ON "ProductIngredient" ("ingredientId", "productId")',
    verify: `SELECT c.relname, i.indisvalid
             FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
             WHERE c.relname = 'ProductIngredient_ingredientId_productId_idx'`,
    invalidMeansRetry: true,
    progress: {
      view: 'pg_stat_progress_create_index',
      columns: ['phase', 'blocks_done', 'blocks_total', 'tuples_done', 'tuples_total'],
    },
    note: 'Covering index for the related-products seed lookup. See the comment on @@index([ingredientId, productId]) in schema.prisma for why.',
    then: [
      'Now record it in Prisma WITHOUT re-running the SQL:',
      '  npx prisma migrate resolve --rolled-back 20261015181837_product_ingredient_covering_index',
      '  npx prisma migrate resolve --applied     20261015181837_product_ingredient_covering_index',
      '  npx prisma generate',
    ],
  },

  // RAN 2026-10-16, after the covering index was built. The index worked --
  // 11.5 s down to 38.6 ms -- but its Index Only Scan still did 104 heap
  // fetches for 500 rows, which is not what "index only" is supposed to mean.
  //
  // THE CAUSE: an Index Only Scan can skip the heap only for pages the
  // visibility map marks all-visible, and the visibility map is maintained by
  // VACUUM. ProductIngredient had not been vacuumed since 2026-09-28, so most
  // pages were unmarked and Postgres had to check the heap anyway.
  //
  // ANALYZE is bundled in for a second reason: last_analyze was 2026-10-01,
  // which PRE-DATES the whole Phase 1 export backfill. The planner was
  // choosing plans for this table from statistics two weeks and sixteen
  // columns out of date.
  //
  // No `verify`: there is no "already vacuumed" state to detect, and a vacuum
  // is always safe to repeat.
  product_ingredient_vacuum: {
    sql: 'VACUUM (ANALYZE) "ProductIngredient"',
    progress: {
      view: 'pg_stat_progress_vacuum',
      columns: ['phase', 'heap_blks_scanned', 'heap_blks_total', 'index_vacuum_count'],
    },
    note: 'VACUUM (ANALYZE) on ProductIngredient. Sets the visibility map so index-only scans stop touching the heap, and refreshes statistics last taken before the Phase 1 backfill.',
    then: [
      'Re-check that the heap fetches have dropped:',
      '  EXPLAIN (ANALYZE, BUFFERS) SELECT "productId" FROM "ProductIngredient"',
      "    WHERE \"ingredientId\" = '8245abab-d57f-4d00-9c3b-aa63dfb818c3'",
      '    ORDER BY "productId" ASC LIMIT 500;',
      'Heap Fetches was 104 before this ran. It should now be at or near 0.',
    ],
  },
}

const args = process.argv.slice(2)
const LIVE = args.includes('--live')
const LIST = args.includes('--list')
const jobName = args.find((a) => !a.startsWith('--'))

function log(s: string) {
  console.log(`${new Date().toISOString().slice(11, 19)}  ${s}`)
}

async function main() {
  if (LIST || !jobName) {
    console.log('Jobs:')
    for (const [k, v] of Object.entries(JOBS)) {
      console.log(`  ${k}`)
      console.log(`      ${v.note}`)
    }
    if (!jobName) process.exit(LIST ? 0 : 1)
    return
  }
  const job = JOBS[jobName]
  if (!job) {
    console.error(`Unknown job: ${jobName}. Run with --list.`)
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. It is read from .env via dotenv/config.')
    process.exit(1)
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  log(`connected`)

  // Check first, when the job has a check. Re-running a succeeded build wastes
  // twenty minutes, and an INVALID index left by a previous failure must be
  // dropped, not built over.
  if (job.verify) {
    const pre = await client.query(job.verify)
    if (pre.rows.length > 0) {
      const valid = pre.rows[0].indisvalid
      if (valid || !job.invalidMeansRetry) {
        log(`ALREADY EXISTS and is valid. Nothing to do.`)
        if (job.then) {
          log(`If the follow-up was never done, it is:`)
          for (const line of job.then) log(`  ${line}`)
        }
        await client.end()
        return
      }
      log(`An INVALID index of this name exists, left by a failed build.`)
      log(`Postgres will not use it. Drop it before retrying:`)
      log(`  DROP INDEX "${pre.rows[0].relname}";`)
      await client.end()
      process.exit(1)
    }
  } else {
    log('This job has no idempotency check; it is safe to run more than once.')
  }

  log(`SQL: ${job.sql}`)
  if (!LIVE) {
    log('DRY RUN. Nothing was executed. Pass --live to run it.')
    await client.end()
    return
  }

  // THE THREE THINGS THAT KILLED THE EARLIER ATTEMPTS, all disabled here.
  // statement_timeout is the one that stopped Prisma; lock_timeout and
  // idle_in_transaction_session_timeout are set for the same reason, so that
  // nothing else can cut a statement that may legitimately run for half an
  // hour.
  await client.query('SET statement_timeout = 0')
  await client.query('SET lock_timeout = 0')
  await client.query('SET idle_in_transaction_session_timeout = 0')
  log('statement_timeout, lock_timeout and idle_in_transaction_session_timeout disabled for this session')

  // A SECOND CONNECTION, purely to watch. The working connection is blocked
  // inside the statement and cannot report on itself.
  const progress = job.progress
  const watcher = new Client({ connectionString: process.env.DATABASE_URL })
  await watcher.connect()
  const started = Date.now()
  const beat = setInterval(() => {
    void (async () => {
      const mins = ((Date.now() - started) / 60000).toFixed(1)
      if (!progress) {
        log(`${mins} min — running (this statement reports no progress)`)
        return
      }
      try {
        const r = await watcher.query(
          `SELECT ${progress.columns.join(', ')} FROM ${progress.view} LIMIT 1`
        )
        if (r.rows.length === 0) {
          log(`${mins} min — nothing reported yet (it may be waiting for a lock)`)
          return
        }
        const p = r.rows[0]
        const detail = progress.columns
          .filter((c) => c !== 'phase')
          .map((c) => `${c} ${p[c]}`)
          .join(', ')
        log(`${mins} min — ${p.phase ?? 'running'}${detail ? ` (${detail})` : ''}`)
      } catch {
        /* a watcher that cannot read progress must not kill the work */
      }
    })()
  }, 10_000)

  log('working. This can take many minutes on a loaded instance; leave it alone.')
  try {
    await client.query(job.sql)
    clearInterval(beat)
    const mins = ((Date.now() - started) / 60000).toFixed(1)

    // Only a job with a verify can confirm itself. One without is trusted to
    // have thrown if it failed, which is what pg does.
    let ok = true
    if (job.verify) {
      const post = await client.query(job.verify)
      ok = post.rows.length > 0 && (post.rows[0].indisvalid || !job.invalidMeansRetry)
    }

    if (ok) {
      log(job.verify ? `DONE in ${mins} min, and it reports valid.` : `DONE in ${mins} min.`)
      if (job.then) {
        log('')
        for (const line of job.then) log(line)
      }
    } else {
      log(`FINISHED in ${mins} min but it is NOT valid. Drop it and retry.`)
      process.exitCode = 1
    }
  } catch (err) {
    clearInterval(beat)
    const msg = (err as Error).message
    log(`FAILED: ${msg}`)
    log('If this says the relation already exists, a previous attempt won the')
    log('race; re-run this script without --live to check whether it is valid.')
    process.exitCode = 1
  } finally {
    clearInterval(beat)
    await watcher.end().catch(() => {})
    await client.end().catch(() => {})
  }
}

main().catch((e) => {
  console.error(`FAILED: ${(e as Error).message}`)
  process.exit(1)
})

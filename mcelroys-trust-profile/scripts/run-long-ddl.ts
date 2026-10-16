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
// USAGE
//   npx tsx scripts/run-long-ddl.ts --list
//   npx tsx scripts/run-long-ddl.ts product_ingredient_covering_index
//   npx tsx scripts/run-long-ddl.ts product_ingredient_covering_index --live
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

// EVERY LONG DDL WE HAVE NEEDED, BY NAME. Kept as a registry rather than
// taking arbitrary SQL on the command line: this script exists to run known,
// reviewed statements against a production database, and accepting free-form
// DDL from a shell argument is a different and much worse tool.
const JOBS: Record<string, { sql: string; verify: string; note: string }> = {
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
    note: 'Covering index for the related-products seed lookup. See the comment on @@index([ingredientId, productId]) in schema.prisma for why.',
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

  // Check first. Re-running a succeeded build wastes twenty minutes, and an
  // INVALID index left by a previous failure must be dropped, not built over.
  const pre = await client.query(job.verify)
  if (pre.rows.length > 0) {
    const valid = pre.rows[0].indisvalid
    if (valid) {
      log(`ALREADY EXISTS and is valid. Nothing to do.`)
      log(`If Prisma still thinks the migration failed, run the two`)
      log(`prisma migrate resolve commands in this file's header.`)
      await client.end()
      return
    }
    log(`An INVALID index of this name exists, left by a failed build.`)
    log(`Postgres will not use it. Drop it before retrying:`)
    log(`  DROP INDEX "${pre.rows[0].relname}";`)
    await client.end()
    process.exit(1)
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
  // nothing else can cut a build that may legitimately run for half an hour.
  await client.query('SET statement_timeout = 0')
  await client.query('SET lock_timeout = 0')
  await client.query('SET idle_in_transaction_session_timeout = 0')
  log('statement_timeout, lock_timeout and idle_in_transaction_session_timeout disabled for this session')

  // A SECOND CONNECTION, purely to watch. The building connection is blocked
  // inside CREATE INDEX and cannot report on itself.
  const watcher = new Client({ connectionString: process.env.DATABASE_URL })
  await watcher.connect()
  const started = Date.now()
  const beat = setInterval(() => {
    void (async () => {
      try {
        const r = await watcher.query(
          `SELECT phase, blocks_done, blocks_total, tuples_done, tuples_total
           FROM pg_stat_progress_create_index LIMIT 1`
        )
        const mins = ((Date.now() - started) / 60000).toFixed(1)
        if (r.rows.length === 0) {
          log(`${mins} min — no build reported yet (it may be waiting for a lock)`)
          return
        }
        const p = r.rows[0]
        const blocks =
          p.blocks_total > 0 ? ` blocks ${p.blocks_done}/${p.blocks_total}` : ''
        const tuples =
          p.tuples_total > 0 ? ` tuples ${p.tuples_done}/${p.tuples_total}` : ''
        log(`${mins} min — ${p.phase}${blocks}${tuples}`)
      } catch {
        /* a watcher that cannot read progress must not kill the build */
      }
    })()
  }, 10_000)

  log('building. This can take many minutes on a loaded instance; leave it alone.')
  try {
    await client.query(job.sql)
    clearInterval(beat)
    const post = await client.query(job.verify)
    const ok = post.rows.length > 0 && post.rows[0].indisvalid
    const mins = ((Date.now() - started) / 60000).toFixed(1)
    if (ok) {
      log(`DONE in ${mins} min, and the index reports valid.`)
      log('')
      log('Now record it in Prisma WITHOUT re-running the SQL:')
      log('  npx prisma migrate resolve --rolled-back 20261015181837_product_ingredient_covering_index')
      log('  npx prisma migrate resolve --applied     20261015181837_product_ingredient_covering_index')
      log('  npx prisma generate')
    } else {
      log(`FINISHED in ${mins} min but the index is NOT valid. Drop it and retry.`)
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

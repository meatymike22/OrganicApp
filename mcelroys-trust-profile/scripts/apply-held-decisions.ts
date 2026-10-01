// APPLY the decisions about held (unvetted) companies.
//
// About 2,700 companies are held: hidden from the site and never matched to
// recalls, because their name came from a mistyped Open Food Facts brand
// field ("Organics", "Multi-grain Bread", "Almond To a"). An AI review
// (2026-10-01) read each one with its products and the barcode evidence
// from USDA FoodData Central and the Open Food Facts export
// (logs/held-barcode-lookup-*.tsv), and decided per company:
//
//   moves         a product belongs to an existing verified company → move it
//                 (AI decisions, plus products the AI didn't see whose barcode
//                 USDA files under a brand or owner that matches exactly one
//                 verified company)
//   vets          the held name IS a real brand → make it visible
//   renames       a real brand with a garbled name → rename, keep the old name
//                 as an alias, make it visible
//   merges        the corrected name is an existing verified company → move
//                 all its products there
//   parentOwners  held companies that USDA names as the owner of verified
//                 brands → make visible and set them as those brands' parent
//
// Everything else stays held. Afterwards, held companies left with no
// products (and nothing else pointing at them) are deleted.
//
// It never touches a product that has already left its held company, and
// never changes a company that someone has vetted in the meantime.
//
// USAGE
//   npx tsx scripts/apply-held-decisions.ts --plan logs/held-decisions-2026-10-01.json          dry run
//   npx tsx scripts/apply-held-decisions.ts --plan logs/held-decisions-2026-10-01.json --live   apply
//   npx tsx scripts/apply-held-decisions.ts --undo logs/apply-held-decisions-applied-<ts>.json
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({
  adapter,
  queryPlanCacheMaxSize: 0,
  transactionOptions: { maxWait: 30_000, timeout: 600_000 },
} as unknown as ConstructorParameters<typeof PrismaClient>[0])

const args = process.argv.slice(2)
const argValue = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] ?? null : null)
const LIVE = args.includes('--live')
const PLAN_FILE = argValue('--plan')
const UNDO_FILE = argValue('--undo')
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
fs.mkdirSync('./logs', { recursive: true })
const LOG_FILE = path.join('./logs', `apply-held-decisions-${UNDO_FILE ? 'undo-' : LIVE ? '' : 'dryrun-'}${STAMP}.txt`)
function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

type Plan = {
  moves: { pid: string; to: string; why: string }[]
  vets: { cid: string; name: string }[]
  renames: { cid: string; oldName: string; newName: string }[]
  merges: { cid: string; oldName: string; into: string; intoName: string }[]
  parentOwners: { cid: string; name: string; children: string[]; why: string }[]
}
type Co = { id: string; legalName: string; dbaNames: string[] | null; vettingStatus: string; vettingMethod: string | null; vettedAt: Date | null; vettingNotes: string | null; parentCompanyId: string | null }

const NOTE = (why: string) => `AI review of held companies (2026-10-01): ${why}`

async function main() {
  if (UNDO_FILE) return undo(UNDO_FILE)
  if (!PLAN_FILE) throw new Error('Pass --plan <file>')
  log(`apply-held-decisions — ${LIVE ? 'LIVE' : 'DRY RUN (nothing is written)'} — ${PLAN_FILE}`)
  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8')) as Plan

  const companies = await prisma.$queryRawUnsafe<Co[]>(
    `SELECT id, "legalName", "dbaNames", "vettingStatus", "vettingMethod", "vettedAt", "vettingNotes", "parentCompanyId" FROM "Company"`
  )
  const co = new Map(companies.map((c) => [c.id, c]))
  const held = (id: string) => co.get(id)?.vettingStatus === 'unvetted'
  const verified = (id: string) => co.get(id)?.vettingStatus === 'vetted'
  const products = await prisma.$queryRawUnsafe<{ id: string; companyId: string }[]>(
    `SELECT p.id, p."companyId" FROM "Product" p JOIN "Company" c ON c.id = p."companyId" WHERE c."vettingStatus" = 'unvetted'`
  )
  const productCo = new Map(products.map((p) => [p.id, p.companyId]))
  const stats: Record<string, number> = {}
  const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n)

  // product moves (individual + whole-company merges)
  const moves = new Map<string, { from: string; to: string; why: string }>()
  for (const m of plan.moves) {
    const from = productCo.get(m.pid)
    if (!from) { bump('move skipped: product no longer under a held company'); continue }
    if (!verified(m.to)) { bump('move skipped: target not verified'); continue }
    moves.set(m.pid, { from, to: m.to, why: m.why })
  }
  for (const g of plan.merges) {
    if (!held(g.cid) || !verified(g.into)) { bump('merge skipped'); continue }
    for (const [pid, cid] of productCo) if (cid === g.cid) moves.set(pid, { from: cid, to: g.into, why: `merged: "${g.oldName}" is ${g.intoName}` })
  }
  bump('products to move', moves.size)

  // company updates
  const updates: { id: string; data: Partial<Co>; label: string }[] = []
  const vetData = (why: string) => ({ vettingStatus: 'vetted', vettingMethod: 'automated_ai', vettedAt: new Date(), vettingNotes: NOTE(why) })
  for (const v of plan.vets) {
    if (!held(v.cid)) { bump('vet skipped: no longer held'); continue }
    updates.push({ id: v.cid, data: vetData('the name is a real brand'), label: `vet "${v.name}"` })
  }
  for (const r of plan.renames) {
    const c = co.get(r.cid)
    if (!c || !held(r.cid)) { bump('rename skipped: no longer held'); continue }
    const dba = [...new Set([...(c.dbaNames ?? []), r.oldName])]
    updates.push({ id: r.cid, data: { legalName: r.newName, dbaNames: dba, ...vetData(`real brand, name corrected from "${r.oldName}"`) }, label: `rename "${r.oldName}" → "${r.newName}"` })
  }
  for (const o of plan.parentOwners) {
    if (!held(o.cid)) { bump('parent owner skipped: no longer held'); continue }
    updates.push({ id: o.cid, data: vetData(o.why), label: `vet owner "${o.name}"` })
    for (const ch of o.children) {
      const c = co.get(ch)
      if (!c || c.parentCompanyId) { bump('parent link skipped: brand missing or already has a parent'); continue }
      updates.push({ id: ch, data: { parentCompanyId: o.cid }, label: `"${c.legalName}" parent → "${o.name}"` })
    }
  }
  bump('companies to vet or rename', updates.filter((u) => 'vettingStatus' in u.data).length)
  bump('parent links to set', updates.filter((u) => 'parentCompanyId' in u.data).length)

  // held companies that will be empty afterwards
  const remaining = new Map<string, number>()
  for (const [pid, cid] of productCo) if (!moves.has(pid)) remaining.set(cid, (remaining.get(cid) ?? 0) + 1)
  const becomingVisible = new Set(updates.filter((u) => 'vettingStatus' in u.data).map((u) => u.id))
  const emptyCandidates = [...new Set(products.map((p) => p.companyId))].filter((cid) => !remaining.get(cid) && !becomingVisible.has(cid))
  bump('held companies left empty (to delete)', emptyCandidates.length)
  bump('held companies staying held', companies.filter((c) => c.vettingStatus === 'unvetted').length - emptyCandidates.length - becomingVisible.size)

  for (const k of Object.keys(stats).sort()) log(`  ${k}: ${stats[k].toLocaleString()}`)
  log('\nCompany changes:')
  for (const u of updates) log(`  ${u.label}`)
  const report = path.join('./logs', `apply-held-decisions-${LIVE ? '' : 'dryrun-'}${STAMP}.tsv`)
  const name = (id: string) => co.get(id)?.legalName ?? id
  fs.writeFileSync(report, ['product_id\tfrom\tto\twhy', ...[...moves].map(([pid, m]) => `${pid}\t${name(m.from)}\t${name(m.to)}\t${m.why}`)].join('\n') + '\n')
  log(`\nProduct moves listed in ${report}`)
  if (!LIVE) {
    log(`\nDRY RUN — nothing was written. Apply with:\n  npx tsx scripts/apply-held-decisions.ts --plan ${PLAN_FILE} --live`)
    return
  }

  const applied = {
    moves: [...moves].map(([pid, m]) => ({ pid, from: m.from })),
    companies: updates.map((u) => {
      const c = co.get(u.id)!
      const before: Record<string, unknown> = {}
      for (const k of Object.keys(u.data)) before[k] = (c as unknown as Record<string, unknown>)[k]
      return { id: u.id, before }
    }),
    deleted: [] as Record<string, unknown>[],
  }
  const appliedFile = path.join('./logs', `apply-held-decisions-applied-${STAMP}.json`)

  await prisma.$transaction(async (tx) => {
    const byTarget = new Map<string, string[]>()
    for (const [pid, m] of moves) byTarget.set(m.to, [...(byTarget.get(m.to) ?? []), pid])
    for (const [to, pids] of byTarget)
      await tx.$executeRawUnsafe(
        `UPDATE "Product" p SET "companyId" = $1 FROM "Company" c WHERE c.id = p."companyId" AND c."vettingStatus" = 'unvetted' AND p.id = ANY($2::text[])`,
        to,
        pids
      )
    for (const u of updates) await tx.company.update({ where: { id: u.id }, data: u.data as never })
    // delete held companies that are now empty and referenced by nothing
    const empties = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "Company" c WHERE c.id = ANY($1::text[]) AND c."vettingStatus" = 'unvetted'
         AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p."companyId" = c.id)
         AND NOT EXISTS (SELECT 1 FROM "Company" k WHERE k."parentCompanyId" = c.id)
         AND NOT EXISTS (SELECT 1 FROM "RegulatoryAction" a WHERE a."companyId" = c.id)
         AND NOT EXISTS (SELECT 1 FROM "RegulatoryActionLink" l WHERE l."companyId" = c.id)
         AND NOT EXISTS (SELECT 1 FROM "OwnershipCertification" x WHERE x."companyId" = c.id)
         AND NOT EXISTS (SELECT 1 FROM "InvestorFiling" x WHERE x."companyId" = c.id)
         AND NOT EXISTS (SELECT 1 FROM "SupplyChainDisclosure" x WHERE x."companyId" = c.id)
         AND NOT EXISTS (SELECT 1 FROM "IndependentInvestigation" x WHERE x."companyId" = c.id)
         AND NOT EXISTS (SELECT 1 FROM "OriginObservation" x WHERE x."shipperCompanyId" = c.id)`,
      emptyCandidates
    )
    applied.deleted = empties
    if (empties.length) await tx.$executeRawUnsafe(`DELETE FROM "Company" WHERE id = ANY($1::text[])`, empties.map((e) => e.id as string))
  })
  fs.writeFileSync(appliedFile, JSON.stringify(applied))
  log(`\nDone. ${moves.size.toLocaleString()} products moved, ${updates.length} company changes, ${applied.deleted.length.toLocaleString()} empty held companies deleted.`)
  log(`To reverse: npx tsx scripts/apply-held-decisions.ts --undo ${appliedFile}`)
}

async function undo(file: string) {
  log(`apply-held-decisions — UNDO ${file}`)
  const a = JSON.parse(fs.readFileSync(file, 'utf8'))
  await prisma.$transaction(async (tx) => {
    for (const c of a.deleted) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "Company" SELECT * FROM json_populate_record(NULL::"Company", $1::json) ON CONFLICT (id) DO NOTHING`,
        JSON.stringify(c)
      )
    }
    for (const m of a.moves) await tx.$executeRawUnsafe(`UPDATE "Product" SET "companyId" = $1 WHERE id = $2`, m.from, m.pid)
    for (const c of a.companies) {
      const data = { ...c.before }
      if (data.vettedAt) data.vettedAt = new Date(data.vettedAt as string)
      await tx.company.update({ where: { id: c.id }, data: data as never })
    }
  })
  log('Undone.')
}

main()
  .catch((e) => {
    log('FAILED:', e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

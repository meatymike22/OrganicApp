// CLASSIFY the companies that match-recalls.ts created from recall notices
// (vettingMethod = 'automated_recall'), using the decisions in
// scripts/recall-firms.json (from an AI review of each firm's recalls):
//
//   merged   the firm is the same business as an existing company: its
//            recalls move to that company and the firm record is deleted
//   roles    Company.businessRole: 'supply_chain' | 'retailer' | 'brand' |
//            null (not determined). On an existing (non-recall) company a
//            role is only set where none is set yet.
//   parents  the firm's parent company (a subsidiary or division)
//   owns     brands the firm owns or owned: its recalls naming them are
//            linked as owner_brand ("the company behind this brand")
//
// After the changes, the links on these recalls are re-labelled: a link to
// the issuing company itself becomes firm_is_brand, and a link to a brand in
// the issuer's family (or one it owns) becomes owner_brand. Barcode links
// are left as they are.
//
// USAGE
//   npx tsx scripts/classify-recall-firms.ts                 dry run: report only
//   npx tsx scripts/classify-recall-firms.ts --live          apply
//   npx tsx scripts/classify-recall-firms.ts --undo logs/classify-recall-firms-applied-<ts>.json
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter } as unknown as ConstructorParameters<typeof PrismaClient>[0])

const args = process.argv.slice(2)
const LIVE = args.includes('--live')
const UNDO_FILE = args.includes('--undo') ? args[args.indexOf('--undo') + 1] : null
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
fs.mkdirSync('./logs', { recursive: true })
const LOG_FILE = path.join('./logs', `classify-recall-firms-${UNDO_FILE ? 'undo-' : LIVE ? '' : 'dryrun-'}${STAMP}.txt`)
function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

type Decisions = {
  merged: Record<string, string>
  roles: Record<string, string | null>
  parents: Record<string, string>
  owns: Record<string, string[]>
  names: Record<string, string>
}
const ROLES = new Set(['supply_chain', 'retailer', 'brand'])
const BASE_NOTE = 'Named as the recalling firm in a government recall notice that lists or names products we carry.'
const ROLE_NOTE: Record<string, string> = {
  supply_chain: ' Classified by AI review of its recalls as a supply-chain company (makes, packs, imports or distributes for other brands).',
  retailer: ' Classified by AI review of its recalls as a retailer.',
  brand: ' Classified by AI review of its recalls as a brand owner.',
  none: ' Business type not determined.',
}

type Co = { id: string; legalName: string; parentCompanyId: string | null; businessRole: string | null; vettingMethod: string | null; vettingNotes: string | null }

async function plan() {
  const d = JSON.parse(fs.readFileSync(path.join('./scripts', 'recall-firms.json'), 'utf8')) as Decisions
  const companies = await prisma.$queryRawUnsafe<Co[]>(`SELECT id, "legalName", "parentCompanyId", "businessRole", "vettingMethod", "vettingNotes" FROM "Company"`)
  const byId = new Map(companies.map((c) => [c.id, c]))
  const isFirm = (id: string) => byId.get(id)?.vettingMethod === 'automated_recall'
  const problems: string[] = []

  // merges
  const merges: { firm: string; target: string }[] = []
  for (const [firm, target] of Object.entries(d.merged)) {
    if (!byId.has(firm)) continue // already merged
    if (!isFirm(firm)) { problems.push(`merge skipped, not a recall-created company: ${firm}`); continue }
    if (!byId.has(target)) { problems.push(`merge skipped, target missing: ${d.names[firm]} -> ${target}`); continue }
    merges.push({ firm, target })
  }
  const mergedTo = new Map(merges.map((m) => [m.firm, m.target]))

  // roles, notes, parents
  const companyChanges: { id: string; before: Partial<Co>; after: Partial<Co> }[] = []
  for (const [id, role] of Object.entries(d.roles)) {
    const c = byId.get(id)
    if (!c || mergedTo.has(id)) continue
    if (role !== null && !ROLES.has(role)) { problems.push(`unknown role ${role} for ${id}`); continue }
    const after: Partial<Co> = {}
    if (isFirm(id)) {
      if (c.businessRole !== role) after.businessRole = role
      const note = BASE_NOTE + ROLE_NOTE[role ?? 'none']
      if (c.vettingNotes !== note) after.vettingNotes = note
      const p = d.parents[id]
      if (p && byId.has(p) && c.parentCompanyId !== p) after.parentCompanyId = p
      if (p && !byId.has(p)) problems.push(`parent missing for ${c.legalName}: ${p}`)
    } else if (role && !c.businessRole) {
      after.businessRole = role
    }
    if (Object.keys(after).length) {
      const before: Partial<Co> = {}
      for (const k of Object.keys(after) as (keyof Co)[]) (before as Record<string, unknown>)[k] = c[k]
      companyChanges.push({ id, before, after })
    }
  }

  // parent map after the changes
  const parentOf = new Map(companies.map((c) => [c.id, c.parentCompanyId]))
  for (const ch of companyChanges) if ('parentCompanyId' in ch.after) parentOf.set(ch.id, ch.after.parentCompanyId ?? null)
  const ancestors = (id: string) => {
    const out: string[] = []
    let x = parentOf.get(id) ?? null
    for (let i = 0; x && i < 6; i++) {
      out.push(x)
      x = parentOf.get(x) ?? null
    }
    return out
  }

  // links on the recalls of these firms
  const firmIds = companies.filter((c) => c.vettingMethod === 'automated_recall').map((c) => c.id)
  const links = firmIds.length
    ? await prisma.$queryRawUnsafe<{ id: string; companyId: string; matchMethod: string; issuer: string }[]>(
        `SELECT l.id, l."companyId", l."matchMethod", a."companyId" AS issuer
           FROM "RegulatoryActionLink" l JOIN "RegulatoryAction" a ON a.id = l."actionId"
          WHERE a."companyId" = ANY($1::text[])`,
        firmIds
      )
    : []
  const actionCount = firmIds.length
    ? Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "RegulatoryAction" WHERE "companyId" = ANY($1::text[])`, merges.map((m) => m.firm)))[0].n)
    : 0
  const linkChanges: { id: string; from: string; to: string }[] = []
  for (const l of links) {
    if (l.matchMethod !== 'named_brand' && l.matchMethod !== 'brand_name') continue
    const firm = l.issuer
    const iss = mergedTo.get(firm) ?? firm
    let to: string | null = null
    if (l.companyId === iss) to = 'firm_is_brand'
    else if (ancestors(l.companyId).includes(iss) || ancestors(iss).includes(l.companyId) || (d.owns[firm] ?? []).includes(l.companyId) || (d.owns[iss] ?? []).includes(l.companyId)) to = 'owner_brand'
    if (to && to !== l.matchMethod) linkChanges.push({ id: l.id, from: l.matchMethod, to })
  }
  return { d, byId, merges, actionCount, companyChanges, linkChanges, problems }
}

async function main() {
  if (UNDO_FILE) return undo(UNDO_FILE)
  log(`classify-recall-firms — ${LIVE ? 'LIVE' : 'DRY RUN (nothing is written)'}`)
  const p = await plan()
  const count = (f: (c: (typeof p.companyChanges)[number]) => boolean) => p.companyChanges.filter(f).length
  const roleCounts: Record<string, number> = {}
  for (const c of p.companyChanges) if ('businessRole' in c.after) roleCounts[String(c.after.businessRole ?? 'not determined')] = (roleCounts[String(c.after.businessRole ?? 'not determined')] ?? 0) + 1
  const linkCounts: Record<string, number> = {}
  for (const l of p.linkChanges) linkCounts[`${l.from} -> ${l.to}`] = (linkCounts[`${l.from} -> ${l.to}`] ?? 0) + 1
  log(`  merge into an existing company: ${p.merges.length} firms (into ${new Set(p.merges.map((m) => m.target)).size} companies), moving ${p.actionCount} recalls`)
  log(`  role set: ${JSON.stringify(roleCounts)}`)
  log(`  parent set: ${count((c) => 'parentCompanyId' in c.after)}`)
  log(`  link labels changed: ${JSON.stringify(linkCounts)}`)
  for (const pr of p.problems) log(`  PROBLEM: ${pr}`)

  const report = path.join('./logs', `classify-recall-firms-${LIVE ? '' : 'dryrun-'}${STAMP}.tsv`)
  const name = (id: string) => p.byId.get(id)?.legalName ?? p.d.names[id] ?? id
  fs.writeFileSync(
    report,
    ['change\tcompany\tdetail',
      ...p.merges.map((m) => `merge\t${name(m.firm)}\tinto ${name(m.target)}`),
      ...p.companyChanges.map((c) => `update\t${name(c.id)}\t${Object.entries(c.after).map(([k, v]) => `${k}=${k === 'parentCompanyId' && v ? name(String(v)) : k === 'vettingNotes' ? '(note)' : v}`).join('; ')}`),
    ].join('\n') + '\n'
  )
  log(`Report: ${report}`)
  if (!LIVE) {
    log('\nDRY RUN — nothing was written. Apply with:\n  npx tsx scripts/classify-recall-firms.ts --live')
    return
  }

  const applied = {
    deletedCompanies: [] as Record<string, unknown>[],
    movedActions: [] as { id: string; from: string }[],
    companyChanges: p.companyChanges.map((c) => ({ id: c.id, before: c.before })),
    linkChanges: p.linkChanges.map((l) => ({ id: l.id, from: l.from })),
  }
  const appliedFile = path.join('./logs', `classify-recall-firms-applied-${STAMP}.json`)
  if (p.merges.length) {
    applied.deletedCompanies = await prisma.$queryRawUnsafe(`SELECT * FROM "Company" WHERE id = ANY($1::text[])`, p.merges.map((m) => m.firm))
    applied.movedActions = await prisma.$queryRawUnsafe(`SELECT id, "companyId" AS "from" FROM "RegulatoryAction" WHERE "companyId" = ANY($1::text[])`, p.merges.map((m) => m.firm))
  }
  fs.writeFileSync(appliedFile, JSON.stringify(applied))

  await prisma.$transaction(
    async (tx) => {
      for (const m of p.merges) await tx.regulatoryAction.updateMany({ where: { companyId: m.firm }, data: { companyId: m.target } })
      for (const c of p.companyChanges) await tx.company.update({ where: { id: c.id }, data: c.after as Record<string, string | null> })
      for (const l of p.linkChanges) await tx.regulatoryActionLink.update({ where: { id: l.id }, data: { matchMethod: l.to } })
      if (p.merges.length) await tx.company.deleteMany({ where: { id: { in: p.merges.map((m) => m.firm) }, vettingMethod: 'automated_recall' } })
    },
    { timeout: 600_000, maxWait: 60_000 }
  )
  log(`\nDone. To reverse: npx tsx scripts/classify-recall-firms.ts --undo ${appliedFile}`)
}

async function undo(file: string) {
  log(`classify-recall-firms — UNDO ${file}`)
  const a = JSON.parse(fs.readFileSync(file, 'utf8'))
  await prisma.$transaction(
    async (tx) => {
      for (const c of a.deletedCompanies) {
        const { id, legalName, dbaNames, hqLocation, ownershipNote, parentCompanyId, discoverySourceUrl, vettingStatus, vettingMethod, vettedAt, vettingNotes, brandOwner, businessRole, createdAt } = c
        await tx.company.create({ data: { id, legalName, dbaNames, hqLocation, ownershipNote, parentCompanyId, discoverySourceUrl, vettingStatus, vettingMethod, vettedAt: vettedAt ? new Date(vettedAt) : null, vettingNotes, brandOwner, businessRole, createdAt: new Date(createdAt) } as never })
      }
      for (const m of a.movedActions) await tx.regulatoryAction.update({ where: { id: m.id }, data: { companyId: m.from } })
      for (const c of a.companyChanges) await tx.company.update({ where: { id: c.id }, data: c.before })
      for (const l of a.linkChanges) await tx.regulatoryActionLink.update({ where: { id: l.id }, data: { matchMethod: l.from } })
    },
    { timeout: 600_000, maxWait: 60_000 }
  )
  log('Undone.')
}

main()
  .catch((e) => {
    log('FAILED:', e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

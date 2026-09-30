// MATCH government recalls to our companies, brands and products.
//
// Replaces the per-company lookups in ingest-fda-recalls.ts,
// ingest-fsis-recalls.ts and ingest-cpsc-recalls.ts, which query each agency
// once per company name and can't cover ~55,000 companies. This downloads
// each agency's full recall dataset once and matches locally.
//
// WHERE A RECALL GOES (the rules agreed for Rootify):
//   1. A recall lives on the page of the firm the notice NAMES — a brand, a
//      subsidiary or a parent. That creates the RegulatoryAction.
//   2. If the recall is tied to a brand, that brand's product pages link to
//      it (RegulatoryActionLink): the exact products when the notice lists
//      barcodes, otherwise every product of the brand, shown with the
//      notice's own product description.
//   3. A parent's recall that names none of its brands appears on the
//      parent's page only.
//
// HOW A NOTICE IS MATCHED
//   Firm:  the notice's firm name must EQUAL (after the shared name cleanup
//          in brandMatching.ts) the legal name or an alias of one verified
//          company. Near-misses are not guessed at.
//   Links, strongest first:
//     barcode      a barcode in the notice is one of our products
//     brand_name   the firm is itself a brand and the notice names it
//     owner_brand  the firm owns brands (via Company.parentCompanyId) and the
//                  notice names one of them
//     firm_is_brand  the firm is a single-brand company but the notice
//                  doesn't repeat the brand name — flagged for review
//   A barcode that belongs to a company outside the firm's own family (a
//   co-packer recalling a store brand, say) is also flagged for review.
//
// USAGE
//   npx tsx scripts/match-recalls.ts                  dry run: download, match, write a plan
//   npx tsx scripts/match-recalls.ts --sources fda    limit to some of: fda,fsis,cpsc
//   npx tsx scripts/match-recalls.ts --refresh        re-download even if today's files exist
//   npx tsx scripts/match-recalls.ts --live --plan logs/match-recalls-plan-<ts>.json [--reject <file>]
//                                                     apply a reviewed plan (no re-download).
//                                                     The reject file lists, one per line, plan ids
//                                                     (A123 = a whole recall, L456 = one link) or the
//                                                     review list's stable keys, to skip.
//   npx tsx scripts/match-recalls.ts --undo logs/match-recalls-applied-<ts>.json
//                                                     reverse one live run
//
// Downloads are kept in ./data/recalls (one set per day). Nothing is written
// to the database without --live.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { normalizeBrandName } from '@/lib/brandMatching'
import { normalizeUpc } from '@/lib/upc'
import { brandPhrases, extractUpcs, mentionsBrand, firmKeys, stripHtml, unzip, wordForm } from '@/lib/recallMatching'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter } as unknown as ConstructorParameters<typeof PrismaClient>[0])

// ---------------------------------------------------------------------------
// args, logging
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const argValue = (name: string) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] ?? null : null
}
const LIVE = args.includes('--live')
const PLAN_FILE = argValue('--plan')
const REJECT_FILE = argValue('--reject')
const UNDO_FILE = argValue('--undo')
const REFRESH = args.includes('--refresh')
const SOURCES = new Set((argValue('--sources') ?? 'fda,fsis,cpsc').split(',').map((s) => s.trim().toLowerCase()))

const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const DAY = new Date().toISOString().slice(0, 10)
fs.mkdirSync('./logs', { recursive: true })
const LOG_FILE = path.join('./logs', `match-recalls-${STAMP}.txt`)
function log(...parts: unknown[]) {
  const line = parts.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}
const oneLine = (v: unknown) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim()

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------
type Notice = {
  agency: 'FDA' | 'FSIS' | 'CPSC'
  // "food" for FDA food and FSIS; "other" for FDA drug and device recalls
  // and CPSC (consumer products).
  domain: 'food' | 'other'
  ref: string
  actionType: string
  classification: string | null
  reason: string
  productDescription: string | null
  status: string | null
  actionDate: string | null // ISO date
  terminationDate: string | null
  sourceUrl: string
  firms: string[]
  brandText: string // where brand names are looked for
  upcText: string // where barcodes are looked for
  listedUpcs: string[] // barcodes given in a dedicated field (CPSC)
}

type PlanLink = {
  lid: string
  key: string // stable across re-runs: <action key>|<brand id>|<product id or *>
  companyId: string
  companyName: string
  productId: string | null
  productName: string | null
  matchMethod: 'barcode' | 'brand_name' | 'owner_brand' | 'firm_is_brand'
  matchedText: string
  flag: 'ok' | 'review'
  note: string
}
type PlanAction = {
  aid: string
  key: string // stable across re-runs: <agency>|<ref>|<company id>
  agency: string
  ref: string
  firm: string
  companyId: string
  companyName: string
  existingActionId: string | null
  existingReviewed: boolean
  data: Omit<Notice, 'firms' | 'brandText' | 'upcText' | 'listedUpcs' | 'domain'>
  links: PlanLink[]
}

// ---------------------------------------------------------------------------
// downloads
// ---------------------------------------------------------------------------
const DATA_DIR = './data/recalls'
fs.mkdirSync(DATA_DIR, { recursive: true })

async function cachedJson(name: string, fetcher: () => Promise<unknown>): Promise<unknown> {
  const file = path.join(DATA_DIR, `${name}-${DAY}.json`)
  if (!REFRESH && fs.existsSync(file)) {
    log(`  using today's download ${file}`)
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  const data = await fetcher()
  fs.writeFileSync(file, JSON.stringify(data))
  log(`  saved ${file}`)
  return data
}

async function getOk(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`)
  return res
}

const FDA_ENDPOINTS = ['food', 'drug', 'device'] as const
function fdaDate(raw: unknown): string | null {
  const s = String(raw ?? '')
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null
}

async function loadFda(): Promise<Notice[]> {
  const index = (await (await getOk('https://api.fda.gov/download.json')).json()) as {
    results: Record<string, Record<string, { partitions: { file: string }[] }>>
  }
  const notices: Notice[] = []
  for (const endpoint of FDA_ENDPOINTS) {
    const records = (await cachedJson(`fda-${endpoint}-enforcement`, async () => {
      const all: unknown[] = []
      for (const part of index.results[endpoint]?.enforcement?.partitions ?? []) {
        log(`  downloading ${part.file}`)
        const buf = Buffer.from(await (await getOk(part.file)).arrayBuffer())
        for (const f of unzip(buf)) all.push(...((JSON.parse(f.data.toString('utf8')) as { results?: unknown[] }).results ?? []))
      }
      return all
    })) as Record<string, unknown>[]
    log(`  FDA ${endpoint}: ${records.length.toLocaleString()} enforcement records`)
    for (const r of records) {
      const ref = oneLine(r.recall_number)
      const firm = oneLine(r.recalling_firm)
      if (!ref || !firm) continue
      const desc = oneLine(r.product_description)
      const openfdaUpcs = ((r.openfda as { upc?: string[] } | undefined)?.upc ?? []).map(String)
      notices.push({
        agency: 'FDA',
        domain: endpoint === 'food' ? 'food' : 'other',
        ref,
        actionType: 'recall',
        classification: oneLine(r.classification) || null,
        reason: oneLine(r.reason_for_recall),
        productDescription: desc || null,
        status: oneLine(r.status) || null,
        actionDate: fdaDate(r.recall_initiation_date),
        terminationDate: fdaDate(r.termination_date),
        // Same form as ingest-fda-recalls.ts, so existing records line up.
        sourceUrl: `https://api.fda.gov/${endpoint}/enforcement.json?search=recall_number:"${ref}"`,
        firms: [firm],
        brandText: desc,
        upcText: [desc, oneLine(r.code_info), oneLine(r.more_code_info)].join(' \n '),
        listedUpcs: openfdaUpcs,
      })
    }
  }
  return notices
}

// FSIS: same endpoint, headers and field handling as ingest-fsis-recalls.ts.
const FSIS_URL = 'https://www.fsis.usda.gov/fsis/api/recall/v/1'
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
}
function pick(rec: Record<string, unknown>, patterns: RegExp[]): string {
  for (const p of patterns) {
    const key = Object.keys(rec).find((k) => p.test(k))
    if (key && rec[key] != null && String(rec[key]).trim() !== '') return String(rec[key])
  }
  return ''
}
function companyFromTitle(title: string): string {
  const fsisIssued = title.match(/^FSIS\s+Issues?\s+.*?\bfor\s+(.+)$/i)
  if (fsisIssued) {
    const after = fsisIssued[1].trim()
    if (/^(a|an|the)\s+/i.test(after)) return ''
    const trimmed = after
      .replace(/\s+(Ready-To-Eat|Frozen|Raw|Canned)\b.*$/i, '')
      .replace(/\s+Products?\b.*$/i, '')
      .replace(/\s+Due to\b.*$/i, '')
      .trim()
    return trimmed.length >= 3 ? trimmed : ''
  }
  const m = title.match(/^(.*?)\s+(Recalls|Issues|Expands|Updates|Recall of)\b/i)
  return m ? m[1].trim() : ''
}

async function loadFsis(): Promise<Notice[]> {
  const raw = (await cachedJson('fsis-recalls', async () => (await getOk(FSIS_URL, { headers: BROWSER_HEADERS })).json())) as
    | Record<string, unknown>[]
    | { results?: Record<string, unknown>[]; data?: Record<string, unknown>[] }
  const records = Array.isArray(raw) ? raw : raw.results ?? raw.data ?? []
  log(`  FSIS: ${records.length.toLocaleString()} records`)
  const notices: Notice[] = []
  for (const rec of records) {
    const lang = pick(rec, [/^langcode$/i])
    if (lang && !/english/i.test(lang)) continue // Spanish duplicates
    const title = stripHtml(pick(rec, [/^field_title$/i, /title/i]))
    const firm = pick(rec, [/^field_establishment$/i]) || companyFromTitle(title)
    if (!firm) continue
    const ref = pick(rec, [/recall_number/i, /recallnumber/i, /number/i])
    const urlField = pick(rec, [/url/i, /link/i, /path/i])
    const sourceUrl = urlField.startsWith('http') ? urlField : urlField ? `https://www.fsis.usda.gov${urlField}` : 'https://www.fsis.usda.gov/recalls'
    const productDescription = stripHtml(pick(rec, [/product/i, /item/i])) || null
    const summary = stripHtml(pick(rec, [/summary/i]))
    const recallType = pick(rec, [/recall_type/i])
    const dateStr = pick(rec, [/recall_date/i, /date/i])
    notices.push({
      agency: 'FSIS',
      domain: 'food',
      ref: ref || sourceUrl,
      actionType: /public health alert/i.test(`${recallType} ${title}`) ? 'public_health_alert' : 'recall',
      classification: pick(rec, [/risk_level/i]) || pick(rec, [/classification/i]) || null,
      reason: stripHtml(pick(rec, [/reason/i, /summary/i, /description/i])) || 'FSIS recall',
      productDescription,
      status: recallType || null,
      actionDate: dateStr && !isNaN(Date.parse(dateStr)) ? new Date(dateStr).toISOString().slice(0, 10) : null,
      terminationDate: null,
      sourceUrl,
      firms: [stripHtml(firm)],
      brandText: `${title} ${productDescription ?? ''}`,
      upcText: `${productDescription ?? ''} \n ${summary}`,
      listedUpcs: [],
    })
  }
  return notices
}

// CPSC: all recalls since the database began. The firm can be named as the
// manufacturer, importer or distributor (a brand with overseas factories is
// the importer); retailers are not the responsible firm and are ignored —
// same rule as ingest-cpsc-recalls.ts.
async function loadCpsc(): Promise<Notice[]> {
  const records = (await cachedJson('cpsc-recalls', async () =>
    (await getOk('https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=1970-01-01')).json()
  )) as Record<string, any>[]
  log(`  CPSC: ${records.length.toLocaleString()} records`)
  const names = (list: unknown) => (Array.isArray(list) ? list.map((x: any) => oneLine(x?.Name)).filter(Boolean) : [])
  const notices: Notice[] = []
  for (const r of records) {
    const ref = oneLine(r.RecallNumber ?? r.RecallID)
    const firms = [...new Set([...names(r.Manufacturers), ...names(r.Importers), ...names(r.Distributors)])]
    if (!ref || !firms.length) continue
    const products = Array.isArray(r.Products) ? r.Products : []
    const productDescription = products.map((p: any) => oneLine(p?.Name)).filter(Boolean).join(', ') || null
    const productDetails = products.map((p: any) => `${oneLine(p?.Name)} ${oneLine(p?.Description)} ${oneLine(p?.Model)}`).join(' \n ')
    notices.push({
      agency: 'CPSC',
      domain: 'other',
      ref,
      actionType: 'recall',
      classification: null,
      reason: names(r.Hazards).join(', ') || oneLine(r.Description),
      productDescription,
      status: null,
      actionDate: r.RecallDate ? String(r.RecallDate).slice(0, 10) : null,
      terminationDate: null,
      sourceUrl: oneLine(r.URL) || `https://www.cpsc.gov/Recalls?recall=${ref}`,
      firms,
      brandText: `${oneLine(r.Title)} ${productDetails}`,
      upcText: `${productDetails} \n ${oneLine(r.Description)}`,
      listedUpcs: Array.isArray(r.ProductUPCs) ? r.ProductUPCs.map((u: any) => oneLine(u?.UPC)).filter(Boolean) : [],
    })
  }
  return notices
}

// ---------------------------------------------------------------------------
// dry run: match and write a plan
// ---------------------------------------------------------------------------
type Co = { id: string; name: string; dba: string[]; parentId: string | null; products: number; human: boolean; nonFood: boolean }

async function dryRun() {
  log(`match-recalls — DRY RUN (nothing is written to the database). Sources: ${[...SOURCES].join(', ')}`)

  // --- our data ---
  const companies = await prisma.$queryRawUnsafe<{ id: string; legalName: string; dbaNames: string[] | null; parentCompanyId: string | null; vettingMethod: string | null; n: bigint; nonfood: bigint }[]>(
    `SELECT c.id, c."legalName", c."dbaNames", c."parentCompanyId", c."vettingMethod",
            (SELECT count(*) FROM "Product" p WHERE p."companyId" = c.id) AS n,
            (SELECT count(*) FROM "Product" p WHERE p."companyId" = c.id
                AND p."productType" IS NOT NULL AND p."productType" <> 'food_beverage') AS nonfood
       FROM "Company" c WHERE c."vettingStatus" = 'vetted'`
  )
  const byId = new Map<string, Co>()
  for (const c of companies)
    byId.set(c.id, { id: c.id, name: c.legalName, dba: c.dbaNames ?? [], parentId: c.parentCompanyId, products: Number(c.n), human: c.vettingMethod === 'human', nonFood: Number(c.nonfood) > 0 })
  const children = new Map<string, string[]>()
  for (const c of byId.values()) if (c.parentId && byId.has(c.parentId)) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id])
  const descendants = (id: string): string[] => {
    const out: string[] = []
    const walk = (x: string, depth: number) => {
      for (const k of children.get(x) ?? []) {
        out.push(k)
        if (depth < 4) walk(k, depth + 1)
      }
    }
    walk(id, 0)
    return out
  }
  const root = (id: string) => {
    let x = id
    for (let i = 0; i < 5; i++) {
      const p = byId.get(x)?.parentId
      if (!p || !byId.has(p)) break
      x = p
    }
    return x
  }
  const ancestors = (id: string) => {
    const out: string[] = []
    let x = byId.get(id)?.parentId
    for (let i = 0; x && i < 5; i++) {
      out.push(x)
      x = byId.get(x)?.parentId ?? null
    }
    return out
  }
  log(`Verified companies: ${byId.size.toLocaleString()} (${children.size.toLocaleString()} with brands under them)`)

  // name key → company ids
  const keyIndex = new Map<string, Set<string>>()
  const keysOf = new Map<string, Set<string>>()
  const legalKeysOf = new Map<string, Set<string>>()
  for (const c of byId.values()) {
    const ks = new Set<string>()
    for (const n of [c.name, ...c.dba]) for (const k of firmKeys(n)) ks.add(k)
    keysOf.set(c.id, ks)
    legalKeysOf.set(c.id, new Set(firmKeys(c.name)))
    for (const k of ks) {
      if (!keyIndex.has(k)) keyIndex.set(k, new Set())
      keyIndex.get(k)!.add(c.id)
    }
  }

  const products = await prisma.$queryRawUnsafe<{ id: string; upc: string; companyId: string; name: string }[]>(
    `SELECT id, upc, "companyId", name FROM "Product" WHERE upc IS NOT NULL`
  )
  const byUpc = new Map<string, { id: string; companyId: string; name: string }>()
  for (const p of products) {
    const r = normalizeUpc(p.upc)
    if (r.ok) byUpc.set(r.upc, { id: p.id, companyId: p.companyId, name: p.name })
  }
  const allCompanyNames = new Map<string, string>(
    (await prisma.$queryRawUnsafe<{ id: string; legalName: string }[]>(`SELECT id, "legalName" FROM "Company"`)).map((c) => [c.id, c.legalName])
  )
  log(`Products with a barcode: ${byUpc.size.toLocaleString()}`)

  const existing = await prisma.$queryRawUnsafe<{ id: string; sourceAgency: string; referenceNumber: string | null; companyId: string; reviewerId: string | null }[]>(
    `SELECT id, "sourceAgency", "referenceNumber", "companyId", "reviewerId" FROM "RegulatoryAction"`
  )
  const existingByKey = new Map(existing.map((e) => [`${e.sourceAgency}|${e.referenceNumber}|${e.companyId}`, e]))
  const existingByRef = new Map<string, typeof existing>()
  for (const e of existing) existingByRef.set(`${e.sourceAgency}|${e.referenceNumber}`, [...(existingByRef.get(`${e.sourceAgency}|${e.referenceNumber}`) ?? []), e])

  // --- notices ---
  log('\nDownloading recall data...')
  const notices: Notice[] = []
  const loaded: string[] = []
  const loaders: [string, () => Promise<Notice[]>][] = [
    ['fda', loadFda],
    ['fsis', loadFsis],
    ['cpsc', loadCpsc],
  ]
  for (const [name, fn] of loaders) {
    if (!SOURCES.has(name)) continue
    try {
      notices.push(...(await fn()))
      loaded.push(name)
    } catch (e) {
      log(`  ${name.toUpperCase()} FAILED: ${e instanceof Error ? e.message : String(e)} — continuing without it`)
    }
  }
  log(`Notices to match: ${notices.length.toLocaleString()} (from ${loaded.join(', ') || 'nothing'})\n`)

  // --- firm → company ---
  type Resolved = { company: Co; firm: string } | { ambiguous: string[]; firm: string } | null
  const resolveFirm = (firm: string): Resolved => {
    const ids = new Set<string>()
    for (const k of firmKeys(firm)) for (const id of keyIndex.get(k) ?? []) ids.add(id)
    if (ids.size === 0) return null
    if (ids.size === 1) return { company: byId.get([...ids][0])!, firm }
    // Several companies share the name: if one is the parent of all the
    // others, the notice names that legal entity. Otherwise don't guess.
    const list = [...ids]
    const top = list.find((id) => list.every((o) => o === id || ancestors(o).includes(id)))
    if (top) return { company: byId.get(top)!, firm }
    // Next, a company whose LEGAL name is the firm beats companies that only
    // carry it as an alias — if exactly one does.
    const fk = new Set(firmKeys(firm))
    const byLegal = list.filter((id) => [...(legalKeysOf.get(id) ?? [])].some((k) => fk.has(k)))
    if (byLegal.length === 1) return { company: byId.get(byLegal[0])!, firm }
    return { ambiguous: list, firm }
  }

  // Phrases for a brand, cached.
  const phraseCache = new Map<string, string[]>()
  const phrasesOf = (id: string) => {
    if (!phraseCache.has(id)) {
      const c = byId.get(id)!
      phraseCache.set(id, [...new Set([c.name, ...c.dba].flatMap(brandPhrases))])
    }
    return phraseCache.get(id)!
  }

  const plan: PlanAction[] = []
  const ambiguous: { agency: string; ref: string; firm: string; companies: string[] }[] = []
  const strayBarcodes: { agency: string; ref: string; firm: string; upc: string; product: string; company: string }[] = []
  const stats: Record<string, number> = {}
  const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n)
  let aSeq = 0
  let lSeq = 0

  for (const n of notices) {
    bump(`${n.agency} notices`)
    const upcExists = (u: string) => byUpc.has(u)
    const hits = new Map<string, string>() // upc → matched text
    for (const f of extractUpcs(n.upcText, upcExists)) if (byUpc.has(f.upc)) hits.set(f.upc, f.text)
    for (const raw of n.listedUpcs) {
      const r = normalizeUpc(raw)
      if (r.ok && byUpc.has(r.upc)) hits.set(r.upc, raw)
    }

    const resolvedCompanies = new Map<string, string>() // companyId → firm name as written
    for (const firm of n.firms) {
      const r = resolveFirm(firm)
      if (!r) continue
      if ('ambiguous' in r) {
        ambiguous.push({ agency: n.agency, ref: n.ref, firm, companies: r.ambiguous.map((id) => byId.get(id)!.name) })
        continue
      }
      resolvedCompanies.set(r.company.id, firm)
    }

    if (resolvedCompanies.size === 0) {
      // No company page to put it on. Barcode hits are listed for later
      // (a firm we don't have, e.g. a co-packer), never applied.
      if (hits.size) bump(`${n.agency} barcode hits with unknown firm`)
      for (const [upc] of hits) {
        const p = byUpc.get(upc)!
        strayBarcodes.push({ agency: n.agency, ref: n.ref, firm: n.firms.join(' / '), upc, product: p.name, company: allCompanyNames.get(p.companyId) ?? '' })
      }
      continue
    }

    for (const [companyId, firm] of resolvedCompanies) {
      const X = byId.get(companyId)!
      bump(`${n.agency} matched to a company`)
      // Keep a human decision: if a person already placed this notice on a
      // different company's page, leave it there.
      const sameRef = existingByRef.get(`${n.agency}|${n.ref}`) ?? []
      const exact = existingByKey.get(`${n.agency}|${n.ref}|${companyId}`)
      if (!exact && sameRef.some((e) => e.reviewerId)) {
        bump('skipped: already on another company page')
        continue
      }

      const family = new Set([X.id, ...descendants(X.id)])
      const wider = new Set([...descendants(root(X.id)), root(X.id)])

      // Drug, medical-device and consumer-product recalls: our catalogue is
      // food, so a match here on a food-only company is almost always a
      // different business with the same name (Cook Inc. catheters vs. a
      // food brand called COOK). Placed only if the company sells non-food
      // products, was checked by a person, or a barcode in the notice is
      // one of its products.
      if (n.domain === 'other' && !exact) {
        const familyBarcode = [...hits.keys()].some((u) => family.has(byUpc.get(u)!.companyId))
        const eligible = [...family].some((id) => byId.get(id)!.nonFood || byId.get(id)!.human)
        if (!familyBarcode && !eligible) {
          bump(`${n.agency} skipped: non-food recall for a food-only company`)
          continue
        }
      }
      const links: Omit<PlanLink, 'lid' | 'key'>[] = []

      // 1. barcodes
      const barcodeBrands = new Set<string>()
      for (const [upc, text] of hits) {
        const p = byUpc.get(upc)!
        const inFamily = family.has(p.companyId)
        const inWider = wider.has(p.companyId)
        if (inFamily) barcodeBrands.add(p.companyId)
        links.push({
          companyId: p.companyId,
          companyName: allCompanyNames.get(p.companyId) ?? '',
          productId: p.id,
          productName: p.name,
          matchMethod: 'barcode',
          matchedText: text,
          flag: inFamily ? 'ok' : 'review',
          note: inFamily ? '' : inWider ? 'barcode belongs to a sister company' : 'barcode belongs to a company outside the firm’s family',
        })
      }

      // 2. brands the firm owns, named in the notice. The firm's own names
      //    (and its parents') are removed from the text first, so "Kraft
      //    Heinz Foods" in a manufacturer line doesn't count as naming the
      //    Heinz brand.
      const firmPhrases = [X.id, ...ancestors(X.id)].flatMap((id) => (byId.has(id) ? phrasesOf(id) : []))
      const firmKeySet = new Set([X.id, ...ancestors(X.id)].flatMap((id) => [...(keysOf.get(id) ?? [])]))
      let childText = ' ' + wordForm(n.brandText) + ' '
      for (const fp of firmPhrases.sort((a, b) => b.length - a.length)) childText = childText.split(' ' + fp + ' ').join(' | ')
      childText = childText.trim()
      for (const b of family) {
        if (b === X.id || barcodeBrands.has(b)) continue
        const B = byId.get(b)!
        if (!B.products) continue
        const hit = phrasesOf(b).find((ph) => {
          // An alias that is really the owner's name isn't the brand's name.
          if (firmKeys(ph).some((k) => firmKeySet.has(k))) return false
          return mentionsBrand(childText, ph)
        })
        if (hit) links.push({ companyId: b, companyName: B.name, productId: null, productName: null, matchMethod: 'owner_brand', matchedText: hit, flag: 'review', note: '' })
      }

      // 3. the firm itself as a brand
      if (X.products && !barcodeBrands.has(X.id)) {
        const selfText = wordForm(n.brandText)
        const hit = phrasesOf(X.id).find((ph) => mentionsBrand(selfText, ph))
        // If the notice's barcodes belong to someone else's products, the firm
        // may be a co-packer naming itself; let a reviewer decide.
        const otherBarcodes = links.some((l) => l.matchMethod === 'barcode' && l.flag === 'review')
        if (hit) {
          links.push({ companyId: X.id, companyName: X.name, productId: null, productName: null, matchMethod: 'brand_name', matchedText: hit, flag: otherBarcodes ? 'review' : 'ok', note: otherBarcodes ? 'notice also lists barcodes of another company' : '' })
        } else if (!links.length && family.size === 1) {
          links.push({ companyId: X.id, companyName: X.name, productId: null, productName: null, matchMethod: 'firm_is_brand', matchedText: firm, flag: 'review', note: 'notice does not repeat the brand name' })
        }
      }

      if (!links.length) bump(`${n.agency} on company page only (no brand named)`)
      for (const l of links) bump(`links: ${l.matchMethod}${l.flag === 'review' ? ' (review)' : ''}`)

      const { firms: _f, brandText: _b, upcText: _u, listedUpcs: _l, domain: _d, ...data } = n
      const actionKey = `${n.agency}|${n.ref}|${X.id}`
      plan.push({
        aid: `A${++aSeq}`,
        key: actionKey,
        agency: n.agency,
        ref: n.ref,
        firm,
        companyId: X.id,
        companyName: X.name,
        existingActionId: exact?.id ?? null,
        existingReviewed: !!exact?.reviewerId,
        data,
        links: links.map((l) => ({ ...l, lid: `L${++lSeq}`, key: `${actionKey}|${l.companyId}|${l.productId ?? '*'}` })),
      })
      bump(exact ? 'actions already in database (refresh + links)' : 'new actions')
    }
  }

  // --- outputs ---
  const planFile = path.join('./logs', `match-recalls-plan-${STAMP}.json`)
  fs.writeFileSync(planFile, JSON.stringify({ createdAt: new Date().toISOString(), sources: loaded, plan, ambiguous, strayBarcodes }, null, 0))

  const tsv = [['id', 'key', 'action', 'agency', 'ref', 'firm', 'firm_company', 'method', 'flag', 'link_company', 'product', 'matched_text', 'note', 'product_description'].join('\t')]
  for (const a of plan) {
    if (!a.links.length) tsv.push([a.aid, a.key, a.aid, a.agency, a.ref, a.firm, a.companyName, 'company_page_only', 'ok', '', '', '', '', oneLine(a.data.productDescription).slice(0, 300)].map(oneLine).join('\t'))
    for (const l of a.links)
      tsv.push([l.lid, l.key, a.aid, a.agency, a.ref, a.firm, a.companyName, l.matchMethod, l.flag, l.companyName, l.productName ?? '', l.matchedText, l.note, oneLine(a.data.productDescription).slice(0, 300)].map(oneLine).join('\t'))
  }
  const tsvFile = path.join('./logs', `match-recalls-review-${STAMP}.tsv`)
  fs.writeFileSync(tsvFile, tsv.join('\n') + '\n')

  const side = path.join('./logs', `match-recalls-unplaced-${STAMP}.tsv`)
  fs.writeFileSync(
    side,
    [
      ['kind', 'agency', 'ref', 'firm', 'detail'].join('\t'),
      ...ambiguous.map((x) => ['ambiguous_firm', x.agency, x.ref, x.firm, x.companies.join(' | ')].map(oneLine).join('\t')),
      ...strayBarcodes.map((x) => ['barcode_unknown_firm', x.agency, x.ref, x.firm, `${x.upc} ${x.product} [${x.company}]`].map(oneLine).join('\t')),
    ].join('\n') + '\n'
  )

  log('Results')
  for (const k of Object.keys(stats).sort()) log(`  ${k}: ${stats[k].toLocaleString()}`)
  log(`  firms matching more than one company (not placed): ${ambiguous.length.toLocaleString()}`)
  log(`\nPlan:        ${planFile}`)
  log(`Review list: ${tsvFile}`)
  log(`Not placed:  ${side}`)
  log('\nDRY RUN — nothing was written. After review, apply with:')
  log(`  npx tsx scripts/match-recalls.ts --live --plan ${planFile} [--reject <file of ids>]`)
}

// ---------------------------------------------------------------------------
// live: apply a plan
// ---------------------------------------------------------------------------
async function applyPlan(planFile: string) {
  const { plan, sources } = JSON.parse(fs.readFileSync(planFile, 'utf8')) as { plan: PlanAction[]; sources: string[] }
  // One entry per line (first tab-separated column): a plan id (A123, L456)
  // or a stable key from the review list's "key" column, which still works
  // after the dry run is repeated.
  const rejected = new Set<string>(
    REJECT_FILE
      ? fs.readFileSync(REJECT_FILE, 'utf8').split(/\r?\n/).map((l) => l.split('\t')[0].trim()).filter((l) => l && !l.startsWith('#'))
      : []
  )
  log(`match-recalls — LIVE: applying ${planFile} (${plan.length.toLocaleString()} actions; ${rejected.size} ids rejected)`)

  const existing = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "RegulatoryAction"`)
  const existingByKey = new Map(existing.map((e) => [`${e.sourceAgency}|${e.referenceNumber}|${e.companyId}`, e]))
  const applied = { planFile, createdActionIds: [] as string[], updatedActions: [] as Record<string, unknown>[], deletedLinks: [] as Record<string, unknown>[], createdLinkIds: [] as string[] }
  const appliedFile = path.join('./logs', `match-recalls-applied-${STAMP}.json`)
  const save = () => fs.writeFileSync(appliedFile, JSON.stringify(applied))

  const toDate = (s: string | null) => (s ? new Date(s) : null)
  let created = 0, updated = 0, kept = 0, linksMade = 0
  const CHUNK = 250
  const todo = plan.filter((a) => !rejected.has(a.aid) && !rejected.has(a.key))
  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK)
    const newActions: Record<string, unknown>[] = []
    const newLinks: Record<string, unknown>[] = []
    const actionIdsWithRebuiltLinks: string[] = []
    for (const a of chunk) {
      const links = a.links.filter((l) => !rejected.has(l.lid) && !rejected.has(l.key))
      const fields = {
        sourceAgency: a.data.agency,
        actionType: a.data.actionType,
        referenceNumber: a.data.ref,
        classification: a.data.classification,
        reason: a.data.reason,
        productDescription: a.data.productDescription,
        status: a.data.status,
        actionDate: toDate(a.data.actionDate),
        terminationDate: toDate(a.data.terminationDate),
        sourceUrl: a.data.sourceUrl,
        sourceType: 'regulatory_filing',
        dataPulledDate: new Date(),
        aiDrafted: true,
      }
      const ex = existingByKey.get(`${a.agency}|${a.ref}|${a.companyId}`)
      let actionId: string
      if (ex) {
        actionId = String(ex.id)
        if (ex.reviewerId) kept++ // a person reviewed it: keep their record as is
        else {
          applied.updatedActions.push(ex)
          await prisma.regulatoryAction.update({ where: { id: actionId }, data: fields })
          updated++
        }
      } else {
        actionId = randomUUID()
        // productRelevance: "direct" when the notice is tied to one of our
        // brands or products; otherwise left for the company page only.
        newActions.push({ id: actionId, companyId: a.companyId, ...fields, productRelevance: links.length ? 'direct' : 'unreviewed' })
        applied.createdActionIds.push(actionId)
        created++
      }
      actionIdsWithRebuiltLinks.push(actionId)
      for (const l of links) {
        const id = randomUUID()
        newLinks.push({ id, actionId, companyId: l.companyId, productId: l.productId, matchMethod: l.matchMethod, matchedText: l.matchedText.slice(0, 500) })
        applied.createdLinkIds.push(id)
      }
    }
    // Links are rebuilt from the plan, so a re-run doesn't duplicate them.
    const old = await prisma.regulatoryActionLink.findMany({ where: { actionId: { in: actionIdsWithRebuiltLinks } } })
    applied.deletedLinks.push(...old)
    await prisma.$transaction([
      prisma.regulatoryActionLink.deleteMany({ where: { actionId: { in: actionIdsWithRebuiltLinks } } }),
      prisma.regulatoryAction.createMany({ data: newActions as never }),
      prisma.regulatoryActionLink.createMany({ data: newLinks as never, skipDuplicates: true }),
    ])
    linksMade += newLinks.length
    save()
    log(`  ${Math.min(i + CHUNK, todo.length).toLocaleString()} / ${todo.length.toLocaleString()} actions`)
  }

  await prisma.ingestionLog.create({ data: { source: 'match_recalls', recordsMatched: created + updated + kept, fileName: `${path.basename(planFile)} (${sources.join(', ')})` } })
  save()
  log(`\nDone. New actions ${created.toLocaleString()}, refreshed ${updated.toLocaleString()}, person-reviewed kept as is ${kept.toLocaleString()}, links ${linksMade.toLocaleString()}.`)
  log(`To reverse this run: npx tsx scripts/match-recalls.ts --undo ${appliedFile}`)
}

// ---------------------------------------------------------------------------
// undo
// ---------------------------------------------------------------------------
async function undo(file: string) {
  const a = JSON.parse(fs.readFileSync(file, 'utf8')) as { createdActionIds: string[]; updatedActions: Record<string, any>[]; deletedLinks: Record<string, any>[]; createdLinkIds: string[] }
  log(`match-recalls — UNDO ${file}${LIVE ? '' : ' (DRY RUN: add --live to reverse)'}`)
  log(`  would delete ${a.createdLinkIds.length} links and ${a.createdActionIds.length} actions, restore ${a.updatedActions.length} actions and ${a.deletedLinks.length} earlier links`)
  if (!LIVE) return
  for (let i = 0; i < a.createdLinkIds.length; i += 1000) await prisma.regulatoryActionLink.deleteMany({ where: { id: { in: a.createdLinkIds.slice(i, i + 1000) } } })
  for (let i = 0; i < a.createdActionIds.length; i += 1000) await prisma.regulatoryAction.deleteMany({ where: { id: { in: a.createdActionIds.slice(i, i + 1000) } } })
  for (const r of a.updatedActions) {
    const { id, companyId: _c, ...rest } = r
    for (const k of ['actionDate', 'terminationDate', 'dataPulledDate', 'reviewDate']) if (rest[k]) rest[k] = new Date(rest[k])
    await prisma.regulatoryAction.update({ where: { id }, data: rest })
  }
  if (a.deletedLinks.length) await prisma.regulatoryActionLink.createMany({ data: a.deletedLinks.map((l) => ({ ...l, createdAt: new Date(l.createdAt) })) as never, skipDuplicates: true })
  log('  reversed.')
}

async function main() {
  if (UNDO_FILE) return undo(UNDO_FILE)
  if (LIVE) {
    if (!PLAN_FILE) throw new Error('--live needs --plan <file> from a dry run, so only a reviewed plan is ever applied.')
    return applyPlan(PLAN_FILE)
  }
  return dryRun()
}

main()
  .catch((e) => {
    log('FAILED:', e instanceof Error ? e.stack ?? e.message : String(e))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

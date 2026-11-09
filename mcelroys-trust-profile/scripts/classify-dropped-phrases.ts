// IS THIS DROPPED PHRASE A PRODUCT LINE, OR A MOTTO?
//
//   npx tsx scripts/classify-dropped-phrases.ts                 # 200-phrase dry run
//   npx tsx scripts/classify-dropped-phrases.ts --sample 400
//
// READ-ONLY. No --live, no column, no migration. This spends a couple of
// cents and prints every verdict for hand scoring. Nothing it decides
// reaches a page.
//
// ---------------------------------------------------------------------------
// WHY A MODEL, AFTER REFUSING ONE TWICE.
//
// Michael, 2026-11-06: "i dont want the company motto near the product at
// all. we have to figure out a way to distinguish motto from legitimate
// product information."
//
// TWO STRUCTURAL HYPOTHESES WERE TESTED AND BOTH FAILED:
//
//   1. "a line belongs to one company, a motto spreads across many"
//      6,973 of 7,470 dropped phrases belong to exactly ONE company. The
//      bucket mixes real lines (lindor, oikos, grill mates, craisins) with
//      junk (of wisconsin, indiana, culinary) with company names the strip
//      missed (flagstone foods, por kwan). No separation.
//
//   2. "a line covers a meaningful share of its company's catalogue, a motto
//      does not". INVERTED: "our specialty" sits at 8.4% while lindor is
//      1.0%, grill mates 0.5%, oikos 0.2%, true goodness 0.1%. Open Food
//      Facts' coverage is sparse enough that share measures how complete the
//      data is, not how the brand is structured.
//
// That is the argument FOR a model rather than against it. "Does this phrase
// name something, or does it only praise the product?" is a language
// judgement, and nothing in the catalogue encodes it. r33's standing lesson
// applies in reverse here: a heuristic that cannot distinguish its own
// successes from its failures does not get to run on a page -- and after two
// honest attempts, no heuristic can.
//
// WHAT MAKES THIS SAFE RATHER THAN A THIRD GUESS: every verdict is one short
// phrase a human can agree with in a second. "Our Speciality -> motto".
// "Lindor -> product line". "House of Dorchester -> company name". That is
// auditable in a way "companies >= 5" never was. The project's standing rule
// for model verdicts (r30) applies in full: model identity and timestamp are
// recorded, and a hand-scored sample comes before it gates anything --
// because a verdict like this CANNOT be re-derived from the source tables,
// so the hand-scored sample is the only ground truth there will ever be.
//
// THE PHRASE ALONE IS NOT ENOUGH, which is why each call carries the company
// name and up to three product names the phrase appears on. "Lindor" in
// isolation is a noise word; "Lindor" across Lindt chocolate products is
// obviously a range. Judging it without that context would be guessing with
// extra steps.

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'node:fs'
import path from 'node:path'
import { productDisplayName } from '../src/lib/productName'
import { splitByProductNoun, MIN_COMPANIES } from '../src/lib/titleOrientation'
import { PRODUCT_NOUNS } from '../src/lib/productNouns.generated'

const args = process.argv.slice(2)
const val = (flag: string, dflt: string) => {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const SAMPLE = parseInt(val('--sample', '200'), 10)
const MODEL = val('--model', 'claude-haiku-5-5')
// A SECOND OPINION IS ONLY A CHECK IF IT KNOWS SOMETHING THE FIRST DID NOT.
//
// Michael, 2026-11-08: "maybe each pass needs an API call potentially to
// weed out all bad classifications or assignments."
//
// Re-asking the SAME model the SAME question on the SAME evidence is not
// verification -- it agrees with itself most of the time, so it raises
// confidence without raising accuracy, which is worse than no check because
// it looks like one. That is the r36 mistake in another costume: the pilot's
// A/B was invalid twice because the control was not independent, and the
// output looked clean both times.
//
// So the check differs on two axes at once. A DIFFERENT MODEL, and a
// DIFFERENT QUESTION -- not "what is this phrase" again, but the specific
// doubt the flag raises: this contains a food word, so is it a name or a
// description?
const VERIFIER = val('--verifier', 'claude-sonnet-5')
const CONCURRENCY = parseInt(val('--concurrency', '6'), 10)
const BATCH = 20000
// Of the sample, this many come from the most-used phrases and the rest are
// drawn from the long tail. Head-only would score the easy, famous cases and
// tell us nothing about the 6,973 one-company phrases that are the actual
// problem.
const HEAD_SHARE = 0.6

const API = 'https://api.anthropic.com'
// Read from the environment, never logged, never echoed, never sent anywhere
// but Anthropic's endpoint.
const API_KEY = process.env.ANTHROPIC_API_KEY

const LOG_DIR = path.resolve('logs')
fs.mkdirSync(LOG_DIR, { recursive: true })
const LOG_FILE = path.join(
  LOG_DIR,
  `classify-dropped-phrases-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
)
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
function log(line = '') {
  console.log(line)
  stream.write(line + '\n')
}
console.log(`Log file: ${LOG_FILE}`)

// A WORD THE CATALOGUE KNOWS AS A FOOD TERM AT ALL -- product noun or
// flavour, anywhere in the phrase, not just at the end.
//
// MEASURED AS A RULE IT IS A DISASTER: it flags 20 of 120 product lines and
// 14 of those are real brands -- Light & Fit, Nut Harvest, Pop Weaver,
// Cobblestone Bread Co, Natural Choice, and Jack Nicklaus (because
// "jack" is Monterey Jack). 30% precision. Deciding on it would delete real
// brands from the page.
//
// MEASURED AS A FLAG IT IS VERY GOOD: those same 20 rows contained ALL SIX
// real descriptor errors in the sample. It catches everything wrong while
// costing a second look at roughly 17% of rows.
//
// That difference -- useless as a rule, excellent as a flag -- is the whole
// design. A cheap signal that cannot decide can still say where to look.
function foodWordsIn(phrase: string): string[] {
  const words = phrase.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (const w of words) {
    const e = PRODUCT_NOUNS.get(w.toLowerCase())
    if (e !== undefined && e.all >= MIN_COMPANIES) out.push(w.toLowerCase())
  }
  return out
}

type Verdict = 'product_line' | 'motto' | 'company_name' | 'unclear'
const VERDICTS: Verdict[] = ['product_line', 'motto', 'company_name', 'unclear']

interface Candidate {
  phrase: string
  company: string
  products: number
  examples: string[]
}

function buildPrompt(c: Candidate): string {
  return `A grocery catalogue stores product names as comma-separated fields. One field has been set aside because it is not the product and not a description of it. Decide what it actually is.

PHRASE: ${JSON.stringify(c.phrase)}
COMPANY ON FILE: ${JSON.stringify(c.company)}
IT APPEARS ON THESE PRODUCT NAMES:
${c.examples.map((e) => `  - ${e}`).join('\n')}

Answer with one of exactly four labels.

product_line — a named range or sub-brand the maker sells under, which helps
  tell this product apart from similar ones. "Lindor", "Oikos", "Grill
  Mates", "Steamfresh", "Light & Fit". A shopper could look for it.

motto — a slogan, a claim, or a piece of marketing that names nothing. "Our
  Speciality", "Taste the Difference", "Simply the Best", "Premium Quality".
  Removing it loses no information about which product this is.

company_name — the maker's own name, or another name for the same company,
  rather than a range within it.

unclear — you cannot tell from what is here. USE THIS FREELY. It is a real
  answer and a much better one than a confident guess; these decide what a
  shopper sees on a page.

A PRODUCT LINE AND A MOTTO CAN BOTH SOUND APPEALING. "True Goodness" is a
real Meijer organic range even though it reads like a slogan, and
"Sensible Portions" is a real brand. The test is not whether it sounds
promotional. The test is whether it NAMES a specific set of products that a
person could ask for by that name, or whether it only says something nice
about them.

Reply with JSON only, no other text:
{"verdict":"product_line|motto|company_name|unclear","reason":"<at most 12 words>"}`
}

function buildVerifyPrompt(c: Candidate, food: string[]): string {
  return `A grocery catalogue has labelled this phrase as a BRAND NAME -- a named range a shopper could ask for. Check that one judgement.

PHRASE: ${JSON.stringify(c.phrase)}
COMPANY ON FILE: ${JSON.stringify(c.company)}
IT APPEARS ON THESE PRODUCT NAMES:
${c.examples.map((e) => `  - ${e}`).join('\n')}

The phrase contains ${food.length === 1 ? 'a word' : 'words'} the catalogue uses as food terms: ${food.map((f) => JSON.stringify(f)).join(', ')}. That is the only reason this is being re-checked, and it is WEAK evidence on its own -- plenty of real brands contain food words. "Nut Harvest" is a Frito-Lay brand. "Cobblestone Bread Co" is a bakery brand. "Light & Fit" is a Danone range.

Answer ONE question: is this phrase the NAME of something, or a DESCRIPTION of the product?

name — a brand, range or sub-brand. A shopper could ask for it by this name
  and get a specific set of products. Keep it even if it contains food words.

description — it tells you what the product is like rather than naming a
  range: a flavour, a variety, a cut, a preparation. "Thai Lime Rice
  Coconut", "Popsicle Orange", "Fancy Shredded". It belongs under the
  product title, not beside the brand.

unsure — genuinely cannot tell. A real and useful answer; do not guess.

Reply with JSON only, no other text:
{"call":"name|description|unsure","reason":"<at most 12 words>"}`
}

type Call = 'name' | 'description' | 'unsure'
const CALLS: Call[] = ['name', 'description', 'unsure']

interface Judged {
  ok: boolean
  verdict?: Verdict
  reason?: string
  failure?: string
  inputTokens: number
  outputTokens: number
}

function parseVerdict(text: string): { ok: true; verdict: Verdict; reason: string } | { ok: false; detail: string } {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return { ok: false, detail: text.slice(0, 160) }
  let o: Record<string, unknown>
  try {
    o = JSON.parse(m[0])
  } catch {
    return { ok: false, detail: m[0].slice(0, 160) }
  }
  const v = String(o.verdict ?? '')
  if (!VERDICTS.includes(v as Verdict)) return { ok: false, detail: `bad verdict ${JSON.stringify(v)}` }
  return { ok: true, verdict: v as Verdict, reason: String(o.reason ?? '').slice(0, 120) }
}

interface RawCall {
  ok: boolean
  text?: string
  failure?: string
  inputTokens: number
  outputTokens: number
}

async function ask(model: string, prompt: string, maxTokens: number): Promise<RawCall> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response
    try {
      res = await fetch(`${API}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': API_KEY as string,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          // r30: Haiku 5.5 thinks adaptively and, when it does, can spend the
          // whole budget and return no text block at all -- on about 15% of
          // calls. That fails closed, but it would make the sample
          // unrepresentative rather than merely smaller.
          thinking: { type: 'disabled' },
          output_config: { effort: 'high' },
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
    } catch (e) {
      return { ok: false, failure: `api_error: ${e instanceof Error ? e.message : String(e)}`, inputTokens: 0, outputTokens: 0 }
    }

    if (res.status === 429 || res.status === 529) {
      await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)))
      continue
    }

    const text = await res.text()
    if (!res.ok) {
      // MATCH LOOSELY AND PRINT THE RAW MESSAGE. A pattern that does not
      // match the vendor's actual wording has twice turned a real failure
      // rate into a false zero in this project (r30, r33).
      return { ok: false, failure: `http_${res.status}: ${text.slice(0, 220)}`, inputTokens: 0, outputTokens: 0 }
    }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(text)
    } catch {
      return { ok: false, failure: `bad_envelope: ${text.slice(0, 160)}`, inputTokens: 0, outputTokens: 0 }
    }
    const blocks = (body.content as { type: string; text?: string }[] | undefined) ?? []
    const textBlock = blocks.find((b) => b.type === 'text')?.text
    const usage = (body.usage ?? {}) as Record<string, number>
    const inTok = usage.input_tokens ?? 0
    const outTok = usage.output_tokens ?? 0
    if (!textBlock) {
      return { ok: false, failure: `no_text_block: stop=${String(body.stop_reason)} blocks=${blocks.map((b) => b.type).join(',')}`, inputTokens: inTok, outputTokens: outTok }
    }
    return { ok: true, text: textBlock, inputTokens: inTok, outputTokens: outTok }
  }
  return { ok: false, failure: 'retries_exhausted', inputTokens: 0, outputTokens: 0 }
}

async function judge(c: Candidate): Promise<Judged> {
  const r = await ask(MODEL, buildPrompt(c), 120)
  if (!r.ok) return { ok: false, failure: r.failure, inputTokens: r.inputTokens, outputTokens: r.outputTokens }
  const parsed = parseVerdict(r.text as string)
  if (!parsed.ok)
    return { ok: false, failure: `unparseable: ${parsed.detail}`, inputTokens: r.inputTokens, outputTokens: r.outputTokens }
  return { ok: true, verdict: parsed.verdict, reason: parsed.reason, inputTokens: r.inputTokens, outputTokens: r.outputTokens }
}

interface Verified {
  ok: boolean
  call?: Call
  reason?: string
  failure?: string
  inputTokens: number
  outputTokens: number
}

function parseCall(text: string): { ok: true; call: Call; reason: string } | { ok: false; detail: string } {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return { ok: false, detail: text.slice(0, 160) }
  let o: Record<string, unknown>
  try {
    o = JSON.parse(m[0])
  } catch {
    return { ok: false, detail: m[0].slice(0, 160) }
  }
  const v = String(o.call ?? '')
  if (!CALLS.includes(v as Call)) return { ok: false, detail: `bad call ${JSON.stringify(v)}` }
  return { ok: true, call: v as Call, reason: String(o.reason ?? '').slice(0, 120) }
}

async function verify(c: Candidate, food: string[]): Promise<Verified> {
  const r = await ask(VERIFIER, buildVerifyPrompt(c, food), 120)
  if (!r.ok) return { ok: false, failure: r.failure, inputTokens: r.inputTokens, outputTokens: r.outputTokens }
  const parsed = parseCall(r.text as string)
  if (!parsed.ok)
    return { ok: false, failure: `unparseable: ${parsed.detail}`, inputTokens: r.inputTokens, outputTokens: r.outputTokens }
  return { ok: true, call: parsed.call, reason: parsed.reason, inputTokens: r.inputTokens, outputTokens: r.outputTokens }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    log('DATABASE_URL is not set. Is .env present in the project root?')
    process.exitCode = 1
    return
  }
  if (!API_KEY) {
    log('ANTHROPIC_API_KEY is not set. Is .env present in the project root?')
    process.exitCode = 1
    return
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

  try {
    log('\n===== BUILDING THE DROPPED-PHRASE SET =====')
    log('  A phrase is dropped when it leads a name whose product noun is in')
    log('  a LATER field. That is the same set whichever split rule ships.')
    log('')
    log('  LEADING FLAVOURS NEVER REACH THE MODEL. splitByProductNoun now')
    log('  rescues a leading field whose last noun the lexicon knows to be a')
    log('  flavour -- "Thai Lime Rice Coconut", "Popsicle Orange" -- into the')
    log('  secondary. Those are settled structurally, for free, and are gone')
    log('  from this set before a single call is made.')

    type Row = { id: string; name: string; legalName: string | null; dbaNames: string[] | null }
    const byPhrase = new Map<string, { company: string; products: number; examples: string[] }>()
    let scanned = 0
    let cursor = ''
    for (;;) {
      const rows = await prisma.$queryRaw<Row[]>`
        SELECT p.id, p.name, co."legalName", co."dbaNames"
          FROM "Product" p
          LEFT JOIN "Company" co ON co.id = p."companyId"
         WHERE p.id > ${cursor}
         ORDER BY p.id
         LIMIT ${BATCH}`
      if (rows.length === 0) break
      for (const r of rows) {
        const displayed = productDisplayName(r.name, r.legalName, r.dbaNames ?? [])
        const ns = splitByProductNoun(displayed)
        if (!ns.dropped) continue
        const key = ns.dropped
        let e = byPhrase.get(key)
        if (e === undefined) {
          e = { company: r.legalName ?? '(none)', products: 0, examples: [] }
          byPhrase.set(key, e)
        }
        e.products++
        if (e.examples.length < 3) e.examples.push(displayed)
      }
      scanned += rows.length
      cursor = rows[rows.length - 1].id
      if (scanned % 100000 < BATCH) console.log(`  ... ${scanned.toLocaleString()} scanned`)
    }
    log(`  scanned ${scanned.toLocaleString()} products`)
    log(`  distinct dropped phrases: ${byPhrase.size.toLocaleString()}`)
    log(`  products affected:        ${[...byPhrase.values()].reduce((n, v) => n + v.products, 0).toLocaleString()}`)

    // ---- the sample: head by product count, plus a random tail
    const all: Candidate[] = [...byPhrase.entries()].map(([phrase, v]) => ({
      phrase, company: v.company, products: v.products, examples: v.examples,
    }))
    all.sort((a, b) => b.products - a.products)
    const headN = Math.min(Math.round(SAMPLE * HEAD_SHARE), all.length)
    const head = all.slice(0, headN)
    const rest = all.slice(headN)
    // Deterministic pseudo-shuffle so two runs score the same phrases and are
    // comparable, without pulling in a seeded-random dependency.
    rest.sort((a, b) => (hash(a.phrase) - hash(b.phrase)))
    const tail = rest.slice(0, Math.max(0, SAMPLE - headN))
    const sample = [...head, ...tail]

    log(`\n===== SAMPLE: ${sample.length} phrases =====`)
    log(`  ${head.length} most-used, ${tail.length} from the long tail`)
    log(`  model ${MODEL}, thinking disabled, concurrency ${CONCURRENCY}`)
    log('  NOTHING IS WRITTEN. No column, no migration, no page change.')

    const results: { c: Candidate; j: Judged; food: string[]; v?: Verified }[] = []
    let inTok = 0, outTok = 0
    let vInTok = 0, vOutTok = 0
    let next = 0
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (;;) {
          const i = next++
          if (i >= sample.length) return
          const c = sample[i]
          const j = await judge(c)
          inTok += j.inputTokens
          outTok += j.outputTokens
          results.push({ c, j, food: foodWordsIn(c.phrase) })
          if (results.length % 25 === 0) console.log(`  ... ${results.length}/${sample.length} judged`)
        }
      })
    )

    // ---- THE SECOND OPINION, on the flagged rows only.
    //
    // Flagged = the model called it a brand AND the catalogue recognises a
    // food word in it. That is a disagreement between a language judgement
    // and a structural signal, which is the only kind of re-check worth
    // paying for. Rows where they agree are left alone.
    const flagged = results.filter(({ j, food }) => j.ok && j.verdict === 'product_line' && food.length > 0)
    log(`\n===== SECOND OPINION =====`)
    log(`  flagged: ${flagged.length} of ${results.length} (model said brand, catalogue sees a food word)`)
    log(`  verifier ${VERIFIER}, asked a DIFFERENT question: name or description?`)
    if (flagged.length > 0) {
      let vnext = 0
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          for (;;) {
            const i = vnext++
            if (i >= flagged.length) return
            const row = flagged[i]
            const v = await verify(row.c, row.food)
            vInTok += v.inputTokens
            vOutTok += v.outputTokens
            row.v = v
          }
        })
      )
      const vc = new Map<string, number>()
      for (const r of flagged) {
        const k = r.v?.ok ? (r.v.call as string) : `FAILED: ${(r.v?.failure ?? '').split(':')[0]}`
        vc.set(k, (vc.get(k) ?? 0) + 1)
      }
      log('')
      for (const [k, v] of [...vc].sort((a, b) => b[1] - a[1]))
        log(`  ${String(v).padStart(4)}  ${k}`)
      const overturned = flagged.filter((r) => r.v?.ok && r.v.call === 'description')
      log('')
      log(`  OVERTURNED: ${overturned.length} rows the first pass called a brand and`)
      log(`  the verifier calls a description. These move to the secondary.`)
      for (const r of overturned.sort((a, b) => b.c.products - a.c.products)) {
        log('')
        log(`  ${String(r.c.products).padStart(4)} products   ${JSON.stringify(r.c.phrase)}   [${r.c.company}]`)
        log(`       food words: ${r.food.join(', ')}`)
        log(`       ${MODEL}: ${r.j.reason}`)
        log(`       ${VERIFIER}: ${r.v?.reason}`)
        for (const e of r.c.examples) log(`       e.g. ${e}`)
      }
      const upheld = flagged.filter((r) => r.v?.ok && r.v.call === 'name')
      log('')
      log(`  UPHELD: ${upheld.length} real brands that merely contain a food word.`)
      log(`  ${upheld.slice(0, 14).map((r) => JSON.stringify(r.c.phrase)).join(', ')}`)
    }

    const counts = new Map<string, number>()
    const productWeight = new Map<string, number>()
    for (const { c, j } of results) {
      const k = j.ok ? (j.verdict as string) : `FAILED: ${(j.failure ?? '').split(':')[0]}`
      counts.set(k, (counts.get(k) ?? 0) + 1)
      productWeight.set(k, (productWeight.get(k) ?? 0) + c.products)
    }

    log('\n===== VERDICTS =====')
    log('   phrases |  products | verdict')
    log('  ---------+-----------+------------------')
    for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1]))
      log(`  ${String(v).padStart(8)} | ${(productWeight.get(k) ?? 0).toLocaleString().padStart(9)} | ${k}`)

    log('\n===== EVERY ROW, FOR HAND SCORING =====')
    log('  Score the verdict, not the phrase. The question is only: would a')
    log('  shopper ask for this by name, or does it just say something nice?')
    for (const v of [...VERDICTS, 'FAILED']) {
      const rows = results.filter(({ j }) => (j.ok ? j.verdict === v : v === 'FAILED'))
      if (rows.length === 0) continue
      log(`\n  --- ${v} (${rows.length}) ---`)
      for (const { c, j } of rows.sort((a, b) => b.c.products - a.c.products)) {
        log('')
        log(`  ${String(c.products).padStart(4)} products   ${JSON.stringify(c.phrase)}   [${c.company}]`)
        log(`       ${j.ok ? j.reason : j.failure}`)
        for (const e of c.examples) log(`       e.g. ${e}`)
      }
    }

    // Haiku 5.5 published rates. CHECK THESE before quoting them anywhere.
    const cost = (inTok / 1e6) * 0.1 + (outTok / 1e6) * 0.5
    // Sonnet published rates. CHECK THESE before quoting them anywhere.
    const vCost = (vInTok / 1e6) * 3 + (vOutTok / 1e6) * 15
    const perPhrase = results.length > 0 ? cost / results.length : 0
    const flagRate = results.length > 0 ? flagged.length / results.length : 0
    const perFlag = flagged.length > 0 ? vCost / flagged.length : 0
    log('\n===== TOKENS AND COST (measured, not estimated) =====')
    log(`  ${MODEL.padEnd(18)} in ${inTok.toLocaleString().padStart(9)}  out ${outTok.toLocaleString().padStart(7)}  $${cost.toFixed(4)}`)
    log(`  ${VERIFIER.padEnd(18)} in ${vInTok.toLocaleString().padStart(9)}  out ${vOutTok.toLocaleString().padStart(7)}  $${vCost.toFixed(4)}`)
    log(`  this run total:        $${(cost + vCost).toFixed(4)}`)
    log('')
    log(`  flag rate: ${(flagRate * 100).toFixed(1)}%  (only these cost a second opinion)`)
    log(`  all ${byPhrase.size.toLocaleString()} phrases, extrapolated:`)
    log(`    first pass:  $${(perPhrase * byPhrase.size).toFixed(2)}`)
    log(`    second pass: $${(perFlag * byPhrase.size * flagRate).toFixed(2)}`)
    log(`    TOTAL:       $${(perPhrase * byPhrase.size + perFlag * byPhrase.size * flagRate).toFixed(2)}   (batch API halves this)`)
    log('  CHECK THESE RATES against current pricing before quoting them.')

    log('\n===== NOTHING WAS WRITTEN =====')
    log('  If the verdicts above read right, the next step is a column that')
    log('  records them with the model id and a timestamp, and a hand-scored')
    log('  sample kept as the only ground truth there will ever be (r30).')
    log(`\nLog written to ${LOG_FILE}`)
  } finally {
    await prisma.$disconnect()
  }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

main().catch((e) => {
  log(`\nFAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  process.exitCode = 1
})

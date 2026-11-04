// PILOT: CAN A MODEL SPLIT A PRODUCT NAME USING THE PACKAGE PHOTO?
//
//   npx tsx scripts/pilot-title-split.ts --selftest
//   npx tsx scripts/pilot-title-split.ts --models
//   npx tsx scripts/pilot-title-split.ts --pilot 40 --model <id>
//   npx tsx scripts/pilot-title-split.ts --pilot 40 --model <id> --ab
//
// THIS SCRIPT WRITES NOTHING. EVER. There is no --live and no update call in
// it. A title is the most visible string on a product page, and round 30's
// rule applies with more force here than it did to image labels: a model's
// verdict is a materialised value that cannot be re-derived from the source
// tables, so a hand-scored sample is the only ground truth there will ever
// be. Score this by eye first; the writing script is a separate decision.
//
// WHAT --ab IS FOR, AND WHY IT IS THE POINT OF THE PILOT.
//
// The whole premise is that the PACKAGE TYPOGRAPHY carries the answer. That
// premise is testable and might be false: a model may well split
// `"PB&J" Wafer Sticks Peanut Butter Filled Wafer Sticks with Strawberry Dip`
// correctly from the words alone, in which case the photo adds nothing and
// the entire image pipeline is cost and complexity for no gain.
//
// --ab asks each row twice, once with the photo and once without, and reports
// how often they agree. If agreement is very high, build the text-only
// version. If the photo version is better where they differ, the photo earns
// its place. Either way the answer comes from measurement rather than from
// the idea sounding good.
//
// COST. Round 30 measured 625 input tokens per image on Haiku 5.5 and ran
// 184,099 images for about $11. This task adds the name string to the input
// and asks for a JSON object back instead of one word, so per-row output is
// higher. The run reports the tokens the API actually returned and projects
// from those — NOT from an estimate, because the first image-cost estimate
// this project made was wrong by 4x for exactly that reason.

import 'dotenv/config'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'node:fs'
import path from 'node:path'
import { buildPrompt, parseSplit, selftest, validateSplit, type SplitVerdict } from '../src/lib/titleSplit'

const argv = process.argv.slice(2)
const has = (f: string) => argv.includes(f)
const val = (f: string, d: string) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

const SELFTEST = has('--selftest')
const MODELS = has('--models')
const AB = has('--ab')
const NOIMAGE = has('--noimage')
const REPEATED = has('--repeated')
const N = parseInt(val('--pilot', '40'), 10)
const MINLEN = parseInt(val('--minlen', '40'), 10)
const MODEL = val('--model', '')
const CONCURRENCY = parseInt(val('--concurrency', '6'), 10)

const API = 'https://api.anthropic.com'
// Read from the environment and never logged, echoed, or sent anywhere but
// the vendor endpoint.
const API_KEY = process.env.ANTHROPIC_API_KEY

const LOG_DIR = path.resolve('logs')
fs.mkdirSync(LOG_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const LOG_FILE = path.join(LOG_DIR, `pilot-title-split-${SELFTEST ? 'selftest' : 'pilot'}-${stamp}.txt`)
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
function log(line = '') {
  console.log(line)
  stream.write(line + '\n')
}
function logErr(line: string, e?: unknown) {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : e === undefined ? '' : String(e)
  log(`${line}${msg ? ' ' + msg : ''}`)
  if (e && typeof e === 'object') {
    const any = e as Record<string, unknown>
    if (any.code !== undefined) log(`  code: ${String(any.code)}`)
    if (any.meta !== undefined) log(`  meta: ${JSON.stringify(any.meta)}`)
  }
}
console.log(`Log file: ${LOG_FILE}`)

type Ask =
  | { ok: true; verdict: SplitVerdict; inputTokens: number; outputTokens: number; thinkingTokens: number }
  | { ok: false; reason: string; detail?: string }

async function ask(name: string, company: string, imageUrl: string | null, model: string): Promise<Ask> {
  const prompt = buildPrompt(name, company, imageUrl !== null)
  const content: unknown[] = []
  if (imageUrl !== null) content.push({ type: 'image', source: { type: 'url', url: imageUrl } })
  content.push({ type: 'text', text: prompt })

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
          // Same reason as the image classifier: Haiku 5.5 thinks adaptively
          // and, when it does, can spend the whole budget and return no text
          // block at all. That fails CLOSED — no answer rather than a wrong
          // one — but it fails on 15% of calls, which would make the pilot's
          // sample unrepresentative rather than merely smaller.
          thinking: { type: 'disabled' },
          // `high` is the top of the band where `disabled` is accepted.
          output_config: { effort: 'high' },
          // JSON object with four short strings. 32 was right for a one-word
          // label; this needs room for the name echoed back in two pieces
          // plus the typography sentence.
          max_tokens: 500,
          messages: [{ role: 'user', content }],
        }),
      })
    } catch (e) {
      return { ok: false, reason: 'api_error', detail: e instanceof Error ? e.message : String(e) }
    }

    if (res.status === 429 || res.status === 529) {
      await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)))
      continue
    }

    const text = await res.text()
    if (!res.ok) {
      // The exact wording the API uses for an image it could not fetch. The
      // first version of this pattern elsewhere in the project never matched
      // the real message, which made "zero fetch failures" an artifact of
      // broken detection rather than a measurement.
      // `timed out` ADDED 2026-11-03, after all 25 photo rows of the first
      // pilot fell through to a bare http_400. The real message is
      // "The request timed out while downloading the image". This is the
      // SECOND time this project has shipped a fetch-failure pattern that
      // did not match the API's actual wording — round 30's missed
      // "Unable to download the file", which made "zero fetch failures in
      // 183,146 images" an artifact of broken detection rather than a
      // measurement. Match loosely and report the raw text.
      if (/unable to download|could not (be )?(fetch|download)|failed to (fetch|download)|unsupported (image|media)|verify the url|timed? ?out|timeout/i.test(text)) {
        return { ok: false, reason: 'fetch_failed', detail: text.slice(0, 200) }
      }
      return { ok: false, reason: `http_${res.status}`, detail: text.slice(0, 300) }
    }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(text)
    } catch {
      return { ok: false, reason: 'bad_envelope', detail: text.slice(0, 200) }
    }
    const blocks = (body.content as { type: string; text?: string }[] | undefined) ?? []
    const textBlock = blocks.find((b) => b.type === 'text')?.text
    const usage = (body.usage ?? {}) as Record<string, number>
    if (!textBlock) {
      return { ok: false, reason: 'no_text_block', detail: `stop=${String(body.stop_reason)} blocks=${blocks.map((b) => b.type).join(',')}` }
    }

    const parsed = parseSplit(textBlock)
    if (!parsed.ok) return { ok: false, reason: parsed.reason, detail: parsed.detail }

    return {
      ok: true,
      verdict: parsed.verdict,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      thinkingTokens: usage.thinking_tokens ?? 0,
    }
  }
  return { ok: false, reason: 'retries_exhausted' }
}

function describe(v: SplitVerdict): string {
  const b = v.leading_brand ? `[brand: ${v.leading_brand}] ` : ''
  const s = v.secondary ? `  ||  ${v.secondary}` : '  ||  (none)'
  return `${b}${v.title}${s}`
}

async function main() {
  if (SELFTEST) {
    const ok = selftest(log)
    log(`\nLog written to ${LOG_FILE}`)
    process.exitCode = ok ? 0 : 1
    return
  }

  if (!API_KEY) {
    log('ANTHROPIC_API_KEY is not set. Is .env present in the project root?')
    process.exitCode = 1
    return
  }

  if (MODELS) {
    // Ask the key what it can use rather than hardcoding an id that may be
    // wrong for this account.
    const res = await fetch(`${API}/v1/models?limit=100`, {
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    })
    const body = (await res.json()) as { data?: { id: string; display_name?: string }[] }
    log('MODELS AVAILABLE TO THIS KEY')
    for (const m of body.data ?? []) log(`  ${m.id}${m.display_name ? `   ${m.display_name}` : ''}`)
    log(`\nLog written to ${LOG_FILE}`)
    return
  }

  if (!MODEL) {
    log('No --model given. Run --models first and pass one.')
    process.exitCode = 1
    return
  }
  if (!process.env.DATABASE_URL) {
    log('DATABASE_URL is not set. Is .env present in the project root?')
    process.exitCode = 1
    return
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

  try {
    // THE SAMPLE. Products that would actually benefit: a package photo to
    // read, and a name long enough that a split is plausible. md5(id) for a
    // stable pseudo-random draw rather than whatever the index returns, which
    // would bias the sample toward one corner of the catalogue.
    // --repeated SELECTS THE POPULATION THAT ACTUALLY HAS A SPLIT TO FIND.
    //
    // The first pilot sampled on LENGTH and mostly drew names with no second
    // part at all — `Jamaican jerk authentic caribbean seasoning` is one
    // phrase, and no splitter should touch it. Length finds LONG names; the
    // problem is CONCATENATED ones.
    //
    // The signature is a repeated word: `"PB&J" Wafer Sticks Peanut Butter
    // Filled Wafer Sticks with Strawberry Dip` repeats "Wafer Sticks", and so
    // do the Reese's and Snickers rows in that first sample. Measured at
    // 19.6% of the 57,609 published names of 40-200 characters, so roughly
    // 11,300 products, of which only about 21% have a package photo.
    //
    // A repeated 5+ character word, not a repeated substring: Postgres
    // supports a backreference regex but `name ~ '(.{12,}).*\1'` exhausted a
    // 25-second statement timeout on this table, and this database has been
    // taken down twice by expensive queries. Word-level costs a cheap unnest.
    const repeatedClause = REPEATED
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM unnest(string_to_array(lower(p.name), ' ')) AS w
          WHERE length(w) >= 5 GROUP BY w HAVING count(*) > 1)`
      : Prisma.empty
    // A photo is required only when we are going to look at one.
    const photoClause = NOIMAGE
      ? Prisma.empty
      : Prisma.sql`AND p."imageKind" = 'package'
                   AND p."imageUrl" IS NOT NULL AND btrim(p."imageUrl") <> ''`

    const rows = await prisma.$queryRaw<
      { id: string; upc: string | null; name: string; imageUrl: string | null; company: string }[]
    >`
      SELECT p.id, p.upc, p.name, p."imageUrl", c."legalName" AS company
      FROM "Product" p JOIN "Company" c ON c.id = p."companyId"
      WHERE p."publicationStatus" = 'published'
        AND length(p.name) >= ${MINLEN}
        ${photoClause}
        ${repeatedClause}
      ORDER BY md5(p.id)
      LIMIT ${N}
    `

    log(`PILOT: ${rows.length} products, model ${MODEL}`)
    log(`  filter: published, length(name) >= ${MINLEN}${NOIMAGE ? '' : ", imageKind='package'"}${REPEATED ? ', REPEATED WORD (concatenated names only)' : ''}`)
    log(`  mode:   ${AB ? 'A/B (photo and text-only for every row)' : NOIMAGE ? 'TEXT ONLY (no photo)' : 'photo'}`)
    log(`  NOTHING IS WRITTEN. This is a read-only measurement.\n`)

    let inTok = 0, outTok = 0, thinkTok = 0
    const outcomes = new Map<string, number>()
    const bump = (k: string) => outcomes.set(k, (outcomes.get(k) ?? 0) + 1)
    let agree = 0, differ = 0, comparable = 0

    const lines: string[] = []
    let next = 0
    const worker = async () => {
      for (;;) {
        const i = next++
        if (i >= rows.length) return
        const r = rows[i]

        const withPhoto = NOIMAGE || !r.imageUrl ? null : await ask(r.name, r.company, r.imageUrl, MODEL)
        const textOnly = AB || NOIMAGE ? await ask(r.name, r.company, null, MODEL) : null

        for (const a of [withPhoto, textOnly]) {
          if (a && a.ok) { inTok += a.inputTokens; outTok += a.outputTokens; thinkTok += a.thinkingTokens }
        }

        const out: string[] = []
        out.push(`[${String(i + 1).padStart(3)}] ${r.upc ?? '(no upc)'}  ${r.imageUrl ?? '(no photo)'}`)
        out.push(`      brand on file: ${r.company}`)
        out.push(`      stored name:   ${r.name}`)

        const render = (label: string, a: Ask | null) => {
          if (!a) return
          if (!a.ok) {
            // Full detail, not a 90-char slice. The first pilot truncated the
            // message mid-sentence at "The request timed out w", which hid
            // what it had timed out ON.
            out.push(`      ${label}: FAILED (${a.reason})${a.detail ? ' ' + a.detail.replace(/\s+/g, ' ') : ''}`)
            bump(`${label}:${a.reason}`)
            return
          }
          const check = validateSplit(a.verdict, r.name, r.company)
          const mark = check.ok ? 'SPLIT  ' : `REJECT(${check.reason})`
          out.push(`      ${label}: ${mark} ${describe(a.verdict)}`)
          out.push(`              conf=${a.verdict.confidence}  evidence: ${a.verdict.typography}`)
          bump(`${label}:${check.ok ? 'split' : check.reason}`)
        }

        render('PHOTO', withPhoto)
        render('TEXT ', textOnly)

        // Does the photo change the answer? Only comparable when both
        // produced a usable split.
        if (withPhoto?.ok && textOnly?.ok) {
          const a = validateSplit(withPhoto.verdict, r.name, r.company)
          const b = validateSplit(textOnly.verdict, r.name, r.company)
          if (a.ok && b.ok) {
            comparable++
            const same = withPhoto.verdict.title.trim() === textOnly.verdict.title.trim()
            if (same) agree++; else differ++
            out.push(`      -> photo and text ${same ? 'AGREE' : 'DIFFER'}`)
          }
        }

        lines[i] = out.join('\n')
        if ((i + 1) % 10 === 0) console.log(`    ...${i + 1}/${rows.length}`)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))

    log('===== EVERY ROW, FOR HAND SCORING =====\n')
    for (const l of lines) if (l) log(l + '\n')

    log('===== OUTCOMES =====')
    for (const [k, n] of [...outcomes.entries()].sort((a, b) => b[1] - a[1])) {
      log(`  ${String(n).padStart(4)}  ${k}`)
    }

    if (comparable > 0) {
      log('\n===== DOES THE PHOTO CHANGE THE ANSWER? =====')
      log(`  rows where both gave a valid split: ${comparable}`)
      log(`  same title:      ${agree}  (${((100 * agree) / comparable).toFixed(1)}%)`)
      log(`  different title: ${differ}  (${((100 * differ) / comparable).toFixed(1)}%)`)
      log(`  If "same" is very high, the photo is not earning its place and the`)
      log(`  text-only version is the one to build.`)
    }

    log('\n===== TOKENS (measured, not estimated) =====')
    log(`  input:    ${inTok.toLocaleString()}`)
    log(`  output:   ${outTok.toLocaleString()}`)
    log(`  thinking: ${thinkTok.toLocaleString()}${thinkTok === 0 ? '  (off, as sent)' : '  !! NOT ZERO'}`)
    const calls = rows.length * (AB ? 2 : 1)
    if (calls > 0) {
      const inPer = inTok / calls, outPer = outTok / calls
      log(`  per call: ${inPer.toFixed(0)} in, ${outPer.toFixed(0)} out`)
      // Rates stated so the arithmetic is checkable rather than asserted.
      const IN_RATE = 0.10 / 1_000_000, OUT_RATE = 0.50 / 1_000_000
      const per = inPer * IN_RATE + outPer * OUT_RATE
      log(`  at $0.10/M in and $0.50/M out (Haiku 5.5, <=100K prompts):`)
      log(`      per product:        $${per.toFixed(6)}`)
      log(`      x 17,566 (>=40 ch): $${(per * 17566).toFixed(2)}   (batch API halves this)`)
      log(`  CHECK THESE RATES against current pricing before quoting them.`)
    }
    log(`\nLog written to ${LOG_FILE}`)
  } catch (e) {
    logErr('FAILED:', e)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()

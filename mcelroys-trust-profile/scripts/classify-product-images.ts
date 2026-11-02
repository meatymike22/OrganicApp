// CLASSIFY WHAT EACH PRODUCT PHOTOGRAPH SHOWS — PILOT FIRST.
//
//   npx tsx scripts/classify-product-images.ts --selftest
//   npx tsx scripts/classify-product-images.ts --models
//   npx tsx scripts/classify-product-images.ts --pilot 500 --model <id>
//
// WHY A PILOT AND NOT A RUN. This column is the one materialised value on
// Product that cannot be re-derived from the source tables — no query can
// check it later, so a hand-scored sample is the only ground truth there will
// ever be. The pilot writes NOTHING. It classifies, prints every verdict with
// its image URL grouped by verdict, and stops. Score it by eye, then we add
// the column and run for real.
//
// THERE IS DELIBERATELY NO --live IN THIS FILE YET. The schema has no
// imageKind column, and defining one before seeing 500 real results is how a
// column ends up shaped wrong. The pilot tells us whether the taxonomy in
// src/lib/imageKind.ts survives contact with the data.
//
// IMAGES ARE SENT BY URL, not downloaded. 184,099 images never touch this
// machine, and a URL the API cannot fetch is recorded as a fetch failure
// rather than a verdict — which makes this run a free measurement of
// DECISION #31 (do stored OFF image URLs decay as contributors re-upload?).
// The vision docs do not document fetch-failure behaviour, so anything that
// is not a clean classification is counted and reported, never guessed at.
//
// COST. The API caps visual tokens per image, so cost is bounded even for the
// 98,806 products whose dimensions we never recorded. Measured over the
// 85,293 we did record: 25.6% exceed the standard-tier cap of 1,568 tokens,
// and the average after capping is 1,074 (standard tier) or 1,528 (the
// high-resolution tier used by Claude 4.7 and later). The pilot prints the
// ACTUAL usage the API reports, so the full-run estimate comes from
// measurement rather than this comment.
import 'dotenv/config'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'node:fs'
import path from 'node:path'
import {
  CLASSIFY_PROMPT, IMAGE_KINDS, parseKind, type ImageKind,
} from '../src/lib/imageKind'

const args = process.argv.slice(2)
const SELFTEST = args.includes('--selftest')
const LIST_MODELS = args.includes('--models')
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const PILOT_N = Number(flag('--pilot') ?? 0) || 0
const LIVE = args.includes('--live')
const LIMIT = Number(flag('--limit') ?? 0) || 0
const MODEL = flag('--model')
const CONCURRENCY = Number(flag('--concurrency') ?? 6) || 6

// --- logging: path printed at module scope AND at the end ---
// Michael, 2026-10-27: "for scripts like this in the future please add a log
// function so i dont have to copy and paste". The start matters more than the
// end: a run that dies halfway still leaves a file worth reading.
const LOG_DIR = path.resolve('logs')
fs.mkdirSync(LOG_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const LOG_FILE = path.join(
  LOG_DIR,
  `classify-images-${SELFTEST ? 'selftest' : LIVE ? 'live' : 'pilot'}-${stamp}.txt`
)
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
function log(line = '') {
  console.log(line)
  stream.write(line + '\n')
}
function logErr(line: string, e?: unknown) {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : e === undefined ? '' : String(e)
  log(`${line}${msg ? ' ' + msg : ''}`)
}
console.log(`Log file: ${LOG_FILE}`)

// --- the API key is read and never printed ---
// It stays in .env and in process memory. Nothing in this script logs it,
// echoes it, or sends it anywhere but api.anthropic.com.
const API_KEY = process.env.ANTHROPIC_API_KEY
const API = 'https://api.anthropic.com'

type Verdict =
  | { ok: true; kind: ImageKind; inputTokens: number; outputTokens: number; thinkingTokens: number }
  | { ok: false; reason: 'fetch_failed' | 'unparseable' | 'api_error' | 'rate_limited'; detail: string; raw?: string }

async function classifyOne(url: string, model: string): Promise<Verdict> {
  // Retries only the two statuses that mean "try again": 429 (rate limit) and
  // 529 (overloaded). A 400 means the request or the image is wrong and will
  // be wrong again, so it is reported rather than retried in a loop.
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
          // THINKING OFF, AND WHY THIS IS NOT OPTIONAL.
          //
          // Haiku 5.5 uses ADAPTIVE thinking by default: it decides per
          // request whether to think. On the 20-image run it skipped thinking
          // on 17 images (3 output tokens each) and entered it on 3, where it
          // spent the entire output budget reasoning and never emitted a text
          // block at all:
          //
          //   stop_reason=max_tokens  blocks=[thinking:""]  out_tokens=32
          //
          // So the failures were not wrong answers, they were no answer. For
          // a one-word label off an image, thinking buys nothing and is
          // billed as output tokens — and it fails CLOSED here, producing an
          // unparseable result rather than a verdict.
          //
          // Raising max_tokens is the wrong lever: it lets the model think
          // longer at more cost without making a text block any more certain.
          thinking: { type: 'disabled' },
          // Pinned ONLY to stay inside the range where `disabled` is
          // accepted — the docs say Haiku 5.5 rejects disabled with a 400 at
          // `xhigh` or `max` effort, and the default is not visible to us.
          // `high` is the top of the accepted band, so this is not a quality
          // trade; it is making a valid request instead of a lucky one.
          output_config: { effort: 'high' },
          // Was 8. Measured output is 3 tokens per answer, so this costs
          // nothing in practice — but 8 left no room if the model emits any
          // leading whitespace or a short preamble before the label, and
          // "truncated before the first visible character" was one of the
          // candidate explanations for the empty replies. Raising it removes
          // that hypothesis for free rather than leaving it confounded.
          max_tokens: 32,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', url } },
              { type: 'text', text: CLASSIFY_PROMPT },
            ],
          }],
        }),
      })
    } catch (e) {
      return { ok: false, reason: 'api_error', detail: e instanceof Error ? e.message : String(e) }
    }

    if (res.status === 429 || res.status === 529) {
      const wait = 1500 * Math.pow(2, attempt)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }

    const text = await res.text()
    if (!res.ok) {
      // An image the API could not fetch is NOT a model verdict. It is the
      // third state, and it is also the decision-#31 signal, so it is
      // separated from other 400s by the message the API gives.
      //
      // THE FIRST VERSION OF THIS PATTERN DID NOT MATCH THE REAL MESSAGE,
      // which is:
      //
      //   HTTP 400 invalid_request_error
      //   "Unable to download the file. Please verify the URL and try again."
      //
      // It looked for "could not fetch", "failed to fetch" and "image.*url",
      // none of which appear. So every genuinely unfetchable image was filed
      // as api_error, left NULL, and retried on every subsequent run — and
      // because `unreadable` was therefore never written, the absence of
      // `unreadable` rows was read as "zero fetch failures". It proved
      // nothing. A measurement that reports zero is only evidence once you
      // have confirmed it CAN report non-zero.
      //
      // Matching on the wording is still the right discriminator — a 400
      // about downloading is the image's problem, any other 400 is ours and
      // must not be written as a verdict about the photograph — but the
      // pattern now covers how the API actually phrases it, and the `else`
      // branch logs the unmatched message so the next mismatch is visible
      // instead of silent.
      const looksLikeFetch =
        /unable to download|could not (be )?(fetch|download)|failed to (fetch|download)|unsupported (image|media)|verify the url/i.test(
          text
        )
      if (!looksLikeFetch && res.status === 400) {
        logErr('  400 NOT recognised as a fetch failure — check this wording: ', text.slice(0, 200))
      }
      return {
        ok: false,
        reason: looksLikeFetch ? 'fetch_failed' : 'api_error',
        detail: `HTTP ${res.status}: ${text.slice(0, 180)}`,
      }
    }

    let body: {
      content?: { type: string; text?: string }[]
      usage?: {
        input_tokens: number
        output_tokens: number
        output_tokens_details?: { thinking_tokens?: number }
      }
      stop_reason?: string
    }
    try {
      body = JSON.parse(text)
    } catch {
      return { ok: false, reason: 'api_error', detail: `unparseable response body: ${text.slice(0, 120)}` }
    }
    const reply = body.content?.find((c) => c.type === 'text')?.text ?? ''
    const kind = parseKind(reply)
    if (!kind) {
      // KEEP THE WHOLE RESPONSE, not just the text we tried to read.
      //
      // The first 20-image run returned `model said: ""` three times —
      // empty, which is neither a wrong label nor a refusal, and the script
      // had discarded everything that could explain it. An empty text block
      // has at least three causes that need different fixes: max_tokens cut
      // the answer off before any visible character, the content came back
      // in a block type we are not reading, or the model returned no content
      // at all. stop_reason and the block types tell them apart.
      const blocks = (body.content ?? []).map((c) => `${c.type}:${JSON.stringify(c.text ?? '').slice(0, 60)}`)
      return {
        ok: false,
        reason: 'unparseable',
        detail: `stop_reason=${body.stop_reason ?? '(none)'} blocks=[${blocks.join(', ') || '(empty array)'}] out_tokens=${body.usage?.output_tokens ?? '?'}`,
        raw: reply,
      }
    }
    return {
      ok: true,
      kind,
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      // Reported so that "thinking is off" is something we SEE rather than
      // something we assume because we sent a parameter. If this is not zero,
      // the parameter did not take and the cost model is wrong.
      thinkingTokens: body.usage?.output_tokens_details?.thinking_tokens ?? 0,
    }
  }
  return { ok: false, reason: 'rate_limited', detail: 'still rate limited after 4 attempts' }
}

// --- selftest: pure, no API, no DB ---
function selfTest(): boolean {
  let bad = 0
  const check = (name: string, got: unknown, want: unknown) => {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) bad++
    log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}  (expected ${JSON.stringify(want)}, got ${JSON.stringify(got)})`)
  }

  log('\nparseKind accepts exactly the labels and nothing else')
  check('package', parseKind('package'), 'package')
  check('trailing newline', parseKind('package\n'), 'package')
  check('capitalised', parseKind('Package'), 'package')
  check('with a full stop', parseKind('nutrition_panel.'), 'nutrition_panel')
  check('underscored label survives', parseKind('ingredients_panel'), 'ingredients_panel')
  check('barcode', parseKind(' barcode '), 'barcode')
  check('other', parseKind('other'), 'other')

  log('\nMUST NOT guess. Anything unrecognised is a parse failure, not a label.')
  // A loose parser would map each of these onto a real label, and the wrong
  // ones hide a photograph. 'other' is the dangerous default: it is a verdict
  // that means "do not show this", so a coerced 'other' silently deletes a
  // usable photo.
  check('a sentence', parseKind('This appears to be a package.'), null)
  check('a near-miss', parseKind('packaging'), null)
  check('a different word', parseKind('label'), null)
  check('empty', parseKind(''), null)
  check('refusal', parseKind("I can't tell"), null)
  check('two labels', parseKind('package nutrition_panel'), null)
  // 'unreadable' is OURS to assign, never the model's — it records that we
  // could not look, which the model is in no position to tell us.
  check('unreadable is not a model answer', parseKind('unreadable'), null)

  log('\nThe taxonomy is closed and ordered')
  check('kind count', IMAGE_KINDS.length, 6)
  check('package is usable', IMAGE_KINDS.includes('package'), true)

  log(bad === 0 ? '\nAll self-tests passed.' : `\n${bad} FAILURES`)
  return bad === 0
}

// THE REAL RUN. Resumable, gate-critical first, writes as it goes.
async function runLive(model: string) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

  // ORDERED GATE-CRITICAL FIRST, which is not cosmetic. 1,256 records are
  // published ONLY because they have a photograph, and they are the reason
  // this column exists. Putting them first means the part that matters is
  // finished in minutes even if the remaining 183,000 take hours or get
  // interrupted.
  //
  // RESUMABLE BY CONSTRUCTION: the filter is imageJudgedAt IS NULL, so the
  // work already done is simply not loaded again. There is no cursor to keep
  // and no state outside the table — stop this with Ctrl-C and run it again
  // and it continues. That matters at 184,099 images; a run that has to
  // complete or start over would be a run that never completes.
  const rows = await prisma.$queryRaw<
    { id: string; upc: string | null; name: string; imageUrl: string; gate_critical: boolean }[]
  >`
    SELECT p.id, p.upc, p.name, p."imageUrl",
           (regexp_replace(lower(p.name), '[^[:alnum:]]', '', 'g')
            = regexp_replace(lower(c."legalName"), '[^[:alnum:]]', '', 'g')) AS gate_critical
    FROM "Product" p JOIN "Company" c ON c.id = p."companyId"
    WHERE p."publicationStatus" = 'published'
      AND p."imageUrl" IS NOT NULL AND btrim(p."imageUrl") <> ''
      AND p."imageJudgedAt" IS NULL
    ORDER BY gate_critical DESC, md5(p.id)
    ${LIMIT > 0 ? Prisma.sql`LIMIT ${LIMIT}` : Prisma.empty}
  `

  const remaining = await prisma.product.count({
    where: {
      publicationStatus: 'published',
      imageUrl: { not: null },
      imageJudgedAt: null,
    },
  })

  log(`LIVE RUN — model ${model}`)
  log(`  still unjudged in total: ${remaining.toLocaleString()}`)
  log(`  loaded this run:         ${rows.length.toLocaleString()}${LIMIT > 0 ? `  (--limit ${LIMIT})` : ''}`)
  log(`  of those, gate-critical: ${rows.filter((r) => r.gate_critical).length.toLocaleString()}  (done first)`)
  log(`  concurrency:             ${CONCURRENCY}`)
  log('')

  const counts = new Map<string, number>()
  let written = 0, skipped = 0, inTok = 0, outTok = 0, thinkTok = 0, done = 0
  const started = Date.now()
  const skippedReasons = new Map<string, number>()

  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= rows.length) return
      const r = rows[i]
      const verdict = await classifyOne(r.imageUrl, model)

      let kindToWrite: string | null = null
      if (verdict.ok) {
        inTok += verdict.inputTokens
        outTok += verdict.outputTokens
        thinkTok += verdict.thinkingTokens
        kindToWrite = verdict.kind
      } else if (verdict.reason === 'fetch_failed') {
        // THE IMAGE IS THE PROBLEM, so record it and move on. 'unreadable' is
        // the third state in column form: we looked and could not tell. A
        // later pass can retry exactly these without re-judging everything.
        kindToWrite = 'unreadable'
      }
      // AN API ERROR IS OUR PROBLEM, NOT THE IMAGE'S, so nothing is written
      // and the row stays NULL — the next run picks it up. Writing a verdict
      // because our own request failed would be indistinguishable later from
      // a verdict about the photograph.

      if (kindToWrite !== null) {
        try {
          await prisma.product.update({
            where: { id: r.id },
            data: { imageKind: kindToWrite, imageKindModel: model, imageJudgedAt: new Date() },
          })
          written++
          counts.set(kindToWrite, (counts.get(kindToWrite) ?? 0) + 1)
        } catch (e) {
          logErr(`  write failed for ${r.id}:`, e)
          skipped++
          skippedReasons.set('write_failed', (skippedReasons.get('write_failed') ?? 0) + 1)
        }
      } else {
        skipped++
        const why = verdict.ok ? 'unknown' : verdict.reason
        skippedReasons.set(why, (skippedReasons.get(why) ?? 0) + 1)
        if (skippedReasons.get(why)! <= 3) logErr(`  skipped ${r.upc ?? r.id} (${why}): `, verdict.ok ? '' : verdict.detail)
      }

      done++
      if (done % 250 === 0) {
        const perSec = done / ((Date.now() - started) / 1000)
        const left = Math.round((rows.length - done) / perSec)
        console.log(`    ...${done.toLocaleString()}/${rows.length.toLocaleString()}  ${perSec.toFixed(1)}/s  ~${Math.floor(left / 60)}m left`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  log(`\n===== CLASSIFICATION COMPLETE =====`)
  log(`  written:  ${written.toLocaleString()}`)
  log(`  skipped:  ${skipped.toLocaleString()}  (left NULL, a later run retries them)`)
  for (const [why, n] of [...skippedReasons.entries()].sort((a, b) => b[1] - a[1])) {
    log(`      ${String(n).padStart(7)}  ${why}`)
  }
  log(`\n  verdicts written:`)
  for (const [kind, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    log(`      ${String(n).padStart(7)}  ${kind}  (${((100 * n) / written).toFixed(1)}%)`)
  }
  log(`\n  input tokens:    ${inTok.toLocaleString()}`)
  log(`  output tokens:   ${outTok.toLocaleString()}`)
  log(`  thinking tokens: ${thinkTok.toLocaleString()}${thinkTok === 0 ? '  (off, as sent)' : '  !! NOT ZERO'}`)
  log(`  minutes elapsed: ${((Date.now() - started) / 60000).toFixed(1)}`)

  const stillLeft = await prisma.product.count({
    where: { publicationStatus: 'published', imageUrl: { not: null }, imageJudgedAt: null },
  })
  log(`\n  still unjudged after this run: ${stillLeft.toLocaleString()}`)
  if (stillLeft > 0) log('  Run the same command again to continue — it resumes from the table.')

  log(`\n  NOTHING IS HIDDEN YET. imageKind is written, but no page reads it`)
  log('  until the display rule is wired in. Check the numbers above against')
  log('  the pilot before that happens: the pilot measured 98.0% package on')
  log('  the gate-critical stratum and 98.8% on the general population, so a')
  log('  materially different split here means the sample was not')
  log('  representative and the hand-scoring does not transfer.')

  await prisma.$disconnect()
  log(`\nLog written to ${path.resolve(LOG_FILE)}`)
}

async function main() {
  if (SELFTEST) {
    log('SELF TEST — no API, no database')
    const ok = selfTest()
    if (!ok) process.exitCode = 1
    log(`\nLog written to ${LOG_FILE}`)
    return
  }

  if (!API_KEY) {
    log('ANTHROPIC_API_KEY is not set in .env — nothing was called.')
    process.exitCode = 1
    return
  }

  if (LIST_MODELS) {
    // Asks the key what it can use, rather than hardcoding a model id that
    // might be wrong. Pass the one you want to --model.
    const res = await fetch(`${API}/v1/models?limit=100`, {
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    })
    const text = await res.text()
    if (!res.ok) {
      log(`Could not list models — HTTP ${res.status}: ${text.slice(0, 300)}`)
      process.exitCode = 1
      return
    }
    const body = JSON.parse(text) as { data?: { id: string; display_name?: string }[] }
    log('\nModels this key can use:')
    for (const m of body.data ?? []) log(`    ${m.id}${m.display_name ? `    ${m.display_name}` : ''}`)
    log('\nPick one and pass it as --model <id>.')
    log(`\nLog written to ${LOG_FILE}`)
    return
  }

  if (LIVE) {
    if (!MODEL) {
      log('Usage: --live --model <id> [--limit N]   (run --models first to see ids)')
      process.exitCode = 1
      return
    }
    await runLive(MODEL)
    return
  }

  if (!PILOT_N || !MODEL) {
    log('Usage: --pilot <N> --model <id>   (run --models first to see ids)')
    log('   or: --live --model <id> [--limit N]')
    process.exitCode = 1
    return
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })

  // TWO STRATA, DELIBERATELY.
  //
  // A. The gate-critical ones: products whose name is their company name and
  //    which are published ONLY because they have a photograph. 1,256 records
  //    rest on this classifier being right about them, so they are sampled
  //    heavily even though they are 0.7% of the population.
  // B. A random sample of everything else, because the classifier will run on
  //    all 184,099 and a sample drawn only from the hard cases would measure
  //    accuracy on a population the run does not have.
  //
  // Reported separately. One accuracy number over a blended sample would hide
  // exactly the thing worth knowing.
  const half = Math.max(1, Math.floor(PILOT_N / 2))
  const gateCritical = await prisma.$queryRaw<{ id: string; upc: string | null; name: string; imageUrl: string }[]>`
    SELECT p.id, p.upc, p.name, p."imageUrl"
    FROM "Product" p JOIN "Company" c ON c.id = p."companyId"
    WHERE p."publicationStatus" = 'published'
      AND p."imageUrl" IS NOT NULL AND btrim(p."imageUrl") <> ''
      AND regexp_replace(lower(p.name), '[^[:alnum:]]', '', 'g')
        = regexp_replace(lower(c."legalName"), '[^[:alnum:]]', '', 'g')
    ORDER BY md5(p.id)
    LIMIT ${half}
  `
  const general = await prisma.$queryRaw<{ id: string; upc: string | null; name: string; imageUrl: string }[]>`
    SELECT p.id, p.upc, p.name, p."imageUrl"
    FROM "Product" p JOIN "Company" c ON c.id = p."companyId"
    WHERE p."publicationStatus" = 'published'
      AND p."imageUrl" IS NOT NULL AND btrim(p."imageUrl") <> ''
      AND regexp_replace(lower(p.name), '[^[:alnum:]]', '', 'g')
        <> regexp_replace(lower(c."legalName"), '[^[:alnum:]]', '', 'g')
    ORDER BY md5(p.id || 'g')
    LIMIT ${PILOT_N - half}
  `
  await prisma.$disconnect()

  const strata: { label: string; rows: typeof gateCritical }[] = [
    { label: 'A — gate-critical (name is the company name, published only because it has a photo)', rows: gateCritical },
    { label: 'B — general population', rows: general },
  ]

  log(`PILOT — ${PILOT_N} images, model ${MODEL}, nothing will be written.`)
  log(`  stratum A (gate-critical): ${gateCritical.length}`)
  log(`  stratum B (general):       ${general.length}`)

  let inTok = 0, outTok = 0, thinkTok = 0, done = 0
  const results: { stratum: string; upc: string | null; name: string; url: string; verdict: Verdict }[] = []

  for (const { label, rows } of strata) {
    let next = 0
    const worker = async () => {
      for (;;) {
        const i = next++
        if (i >= rows.length) return
        const r = rows[i]
        const verdict = await classifyOne(r.imageUrl, MODEL)
        if (verdict.ok) {
          inTok += verdict.inputTokens
          outTok += verdict.outputTokens
          thinkTok += verdict.thinkingTokens
        }
        results.push({ stratum: label, upc: r.upc, name: r.name, url: r.imageUrl, verdict })
        done++
        if (done % 25 === 0) console.log(`    ...${done}/${PILOT_N}`)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  }

  // --- report ---
  for (const { label } of strata) {
    const mine = results.filter((r) => r.stratum === label)
    if (mine.length === 0) continue
    log(`\n${'='.repeat(74)}\nSTRATUM ${label}\n${'='.repeat(74)}`)
    const byKind = new Map<string, typeof mine>()
    for (const r of mine) {
      const key = r.verdict.ok ? r.verdict.kind : `COULD NOT CLASSIFY: ${r.verdict.reason}`
      const list = byKind.get(key) ?? []
      list.push(r)
      byKind.set(key, list)
    }
    for (const [kind, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const pct = ((100 * list.length) / mine.length).toFixed(1)
      log(`\n  ${kind}: ${list.length} of ${mine.length} (${pct}%)`)
      // GROUPED BY VERDICT ON PURPOSE. Scanning 60 URLs the model all called
      // "nutrition_panel" is fast, because you are looking for the one that
      // is wrong. A mixed list makes you re-read the question every row.
      for (const r of list) {
        log(`      ${r.url}`)
        log(`        name: ${JSON.stringify(r.name).slice(0, 80)}   upc: ${r.upc ?? '(none)'}`)
        if (!r.verdict.ok && r.verdict.raw !== undefined) log(`        model said: ${JSON.stringify(r.verdict.raw)}`)
        if (!r.verdict.ok) log(`        detail: ${r.verdict.detail}`)
      }
    }
  }

  const failures = results.filter((r) => !r.verdict.ok)
  const fetchFails = failures.filter((r) => !r.verdict.ok && r.verdict.reason === 'fetch_failed').length

  log(`\n${'='.repeat(74)}\nMEASURED COST — from the usage the API reported, not an estimate\n${'='.repeat(74)}`)
  const classified = results.length - failures.length
  log(`  classified:        ${classified} of ${results.length}`)
  log(`  input tokens:      ${inTok.toLocaleString()}`)
  log(`  output tokens:     ${outTok.toLocaleString()}`)
  log(`  thinking tokens:   ${thinkTok.toLocaleString()}${thinkTok === 0 ? '  (thinking is off, as sent)' : '  !! NOT ZERO — the thinking parameter did not take'}`)
  if (classified > 0) {
    const perImage = inTok / classified
    log(`  input per image:   ${perImage.toFixed(0)}`)
    const total = 184099
    log(`\n  Extrapolated to all ${total.toLocaleString()} published images with a photo:`)
    log(`    input tokens:    ${Math.round(perImage * total).toLocaleString()}`)
    log(`    output tokens:   ${Math.round((outTok / classified) * total).toLocaleString()}`)
    log(`  Multiply by the model's per-million price, then halve it if the run`)
    log(`  goes through the Batch API. Prices change, so they are not hardcoded here.`)
  }

  log(`\nCOULD NOT CLASSIFY: ${failures.length}`)
  log(`  of which the image would not fetch: ${fetchFails}`)
  log(`  A fetch failure is the DECISION #31 signal — a stored OFF image URL`)
  log(`  that no longer resolves. If this number is more than a rounding error,`)
  log(`  photo coverage is decaying silently and periodic rechecks become`)
  log(`  maintenance rather than a one-off.`)

  log(`\n===== PILOT — NOTHING WAS WRITTEN =====`)
  log(`\nWHAT TO DO WITH THIS. Scan each verdict group for a URL that does not`)
  log(`belong. The number that matters is not overall accuracy: it is how often`)
  log(`a real package shot was called something else, because that is the`)
  log(`failure that removes a working photograph from a product page.`)
  log(`Stratum A matters more than B — those 1,256 records are published ONLY`)
  log(`because they have a photo, so a wrong verdict there is the difference`)
  log(`between a thin page and a withheld one.`)
  log(`\nLog written to ${LOG_FILE}`)
}

main().catch((e) => {
  logErr('FATAL:', e)
  log(`\nLog written to ${LOG_FILE}`)
  process.exitCode = 1
})

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
// --live WRITES. Everything else here is read-only.
//
// Two things make a write safe to repeat. The unique index on `phrase` means
// a judgement is stored once per phrase and an interrupted run costs only the
// calls it had not yet made. And a row carrying a human verdict is NEVER
// re-judged or overwritten, whatever flags are passed -- Michael, 2026-11-08:
// "i think a human could correct this too since the scale is low." A person's
// correction is the only ground truth this project will ever have for
// measuring the model (r30), so a script must not be able to destroy one.
const LIVE = args.includes('--live')
// --rejudge re-asks phrases already in the table, for a model or prompt
// change. It still skips human-corrected rows. Without it, a --live run is a
// resume: it judges only what is missing.
const REJUDGE = args.includes('--rejudge')
// --rejudge-verdicts motto,unclear re-asks ONLY rows carrying those verdicts.
//
// A prompt change usually invalidates part of the table, not all of it. The
// 2026-11-09 taxonomy fix (adding `claim`) could only ever change rows the old
// prompt had pushed into `motto` or `unclear`, so re-asking all 6,684 would
// spend $2.40 to re-confirm 3,906 product_line calls that cannot move. This
// re-asks 2,063 and costs cents. A row held by a human verdict is still never
// touched.
// --verify-unverified runs ONLY the second opinion, on stored rows that never
// got one. No first pass, no re-judging, no verdict rewritten.
//
// WHY IT EXISTS. The flag deciding who gets a second opinion was a CONTENT
// signal -- "the phrase contains a food word" -- and content was never the
// reason to doubt a row. The 2026-11-09 re-judge promoted 639 phrases out of
// `unclear` into `product_line`, and the slice the food-word flag happened to
// catch came back 43.6% overturned against 26.3% for the original cohort. The
// reason to doubt them is their PROVENANCE: a model had already declined to
// call them once. That is free to know and better evidence than a word in the
// string.
//
// --verify-limit caps the spend; rows are taken by product reach, so the money
// goes where the page impact is. --verify-since restricts to one cohort.
const VERIFY_ONLY = args.includes('--verify-unverified')
const VERIFY_LIMIT = parseInt(val('--verify-limit', '600'), 10)
const VERIFY_SINCE = val('--verify-since', '')
const REJUDGE_VERDICTS = val('--rejudge-verdicts', '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)
// In --live mode the default is EVERY phrase, not a sample. An explicit
// --sample caps it, for a staged first run.
const SAMPLE_GIVEN = args.includes('--sample')
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

// FIVE LABELS, NOT FOUR. `claim` added 2026-11-09.
//
// The four-label version had this inside the motto definition:
//
//   motto -- a slogan, A CLAIM, or a piece of marketing that names nothing.
//
// So "Free Range" and "Plant Based" were returned as mottos and DROPPED, and
// the model was obeying the prompt exactly. It was not a classification error;
// it was a taxonomy error, and the prompt caused it.
//
// Michael, 2026-11-09: "free range, plant based, etc basically everything on
// that list is not a motto so the algorithm needs to change to account for
// that. All of that is information that is clearly not a motto."
//
// He is right, and it is the same rule the rest of the project already runs
// on: a label claim is first-class sourced information here (r32's wording
// rules; decision #10, where an allergen free-from tag "isnt an ingredient so
// it needs to be classified as something else"). Deleting one is the opposite
// of the point of the site.
type Verdict = 'product_line' | 'claim' | 'motto' | 'company_name' | 'unclear'
const VERDICTS: Verdict[] = ['product_line', 'claim', 'motto', 'company_name', 'unclear']

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

Answer with one of exactly five labels.

product_line — a named range or sub-brand the maker sells under, which helps
  tell this product apart from similar ones. "Lindor", "Oikos", "Grill
  Mates", "Steamfresh", "Light & Fit". A shopper could look for it.

claim — a factual, checkable statement about the food itself: how it was
  made, farmed or prepared, what it contains, or what it lacks.
  "Free Range", "Plant Based", "Non-GMO", "Gluten Free", "Grass Fed",
  "Hand-Trimmed", "Kosher", "Cold Pressed", "No Added Sugar", "Wild Caught".
  It names no range, but it is NOT marketing noise -- somebody could check it
  against the package and be right or wrong about it. THIS IS REAL
  INFORMATION AND MUST NOT BE THROWN AWAY.

motto — praise with no checkable content. It asserts nothing a person could
  verify. "Our Speciality", "Taste the Difference", "Simply the Best",
  "Delicious Deals", "That's Smart!", "Happy Easter".
  Removing it loses no information about which product this is.

company_name — the maker's own name, or another name for the same company,
  rather than a range within it.

unclear — you cannot tell from what is here. USE THIS FREELY. It is a real
  answer and a much better one than a confident guess; these decide what a
  shopper sees on a page.

CLAIM VERSUS MOTTO IS THE DISTINCTION THAT MATTERS MOST HERE, and it is not
about tone. Both can sound promotional. The test is whether the phrase states
something that could be CHECKED. "Free Range" can be checked against the
package and is a claim. "Premium Quality" cannot be checked by anybody and is
a motto. When a phrase states a fact AND praises, it is a claim.

A PHRASE THAT SOUNDS LIKE A CLAIM CAN STILL BE A BRAND. "No Yolks" is a real
egg-noodle brand, not a statement about yolks. "Natural Delights" is a real
Medjool date brand. "Smart Balance" is a real spread brand. If the phrase
names a set of products a shopper could ask for, it is product_line even when
it reads like a claim or like praise.

A PRODUCT LINE AND A MOTTO CAN BOTH SOUND APPEALING. "True Goodness" is a
real Meijer organic range even though it reads like a slogan, and
"Sensible Portions" is a real brand. The test is not whether it sounds
promotional. The test is whether it NAMES a specific set of products that a
person could ask for by that name, or whether it only says something nice
about them.

Reply with JSON only, no other text:
{"verdict":"product_line|claim|motto|company_name|unclear","reason":"<at most 12 words>"}`
}

// THE SECOND OPINION NOW COVERS THE CLASS THAT DELETES, NOT ONLY THE CLASS
// THAT DISPLAYS. Changed 2026-11-09.
//
// Of the five verdicts, only `product_line` puts the phrase on the page.
// `motto`, `company_name` and `unclear` all drop it. The verifier was wired to
// re-check `product_line` alone -- so every judgement that DESTROYS
// information went unchecked, while the one that merely shows something got a
// second opinion. That is backwards, and it is why the mislabelled claims sat
// there unexamined until the rows were read by hand.
//
// A `motto` call now always gets the second opinion. It is the destructive
// verdict with no structural signal available to flag it (hypotheses 1 and 2
// in the round log both failed at exactly this), there are only a few hundred
// of them, and Sonnet on that slice costs cents.
//
// ONE VERIFIER, ONE VOCABULARY, framing adapted to what the first pass said.
// `name | description | unsure` answers both questions, so the 841 rows
// already verified stay comparable:
//   first pass said product_line -> `description` overturns it
//   first pass said motto        -> `name` overturns it
function buildVerifyPrompt(c: Candidate, food: string[], verdict: Verdict): string {
  const framing = verdict === 'motto'
    ? `A grocery catalogue has labelled this phrase a MOTTO -- praise that names nothing, to be deleted from the product page entirely. Check that one judgement, because deleting a real name is the costliest mistake here.`
    : `A grocery catalogue has labelled this phrase as a BRAND NAME -- a named range a shopper could ask for. Check that one judgement.`
  const why = verdict === 'motto'
    ? `Every motto call is re-checked, because dropping the phrase is irreversible on the page and a brand that sounds like praise is easy to mistake for one. "Natural Delights" is a real Medjool date brand. "No Yolks" is a real egg-noodle brand. "Sensible Portions" is a real snack brand.`
    : `The phrase contains ${food.length === 1 ? 'a word' : 'words'} the catalogue uses as food terms: ${food.map((f) => JSON.stringify(f)).join(', ')}. That is the only reason this is being re-checked, and it is WEAK evidence on its own -- plenty of real brands contain food words. "Nut Harvest" is a Frito-Lay brand. "Cobblestone Bread Co" is a bakery brand. "Light & Fit" is a Danone range.`
  return `${framing}

PHRASE: ${JSON.stringify(c.phrase)}
COMPANY ON FILE: ${JSON.stringify(c.company)}
IT APPEARS ON THESE PRODUCT NAMES:
${c.examples.map((e) => `  - ${e}`).join('\n')}

${why}

Answer ONE question: is this phrase the NAME of something, or a DESCRIPTION of the product?

name — a brand, range or sub-brand. A shopper could ask for it by this name
  and get a specific set of products. Keep it even if it contains food words.

description — it tells you what the product is like rather than naming a
  range: a flavour, a variety, a cut, a preparation, a claim about how it was
  made. "Thai Lime Rice Coconut", "Popsicle Orange", "Fancy Shredded",
  "Free Range". It belongs under the product title, not beside the brand.

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

async function verify(c: Candidate, food: string[], verdict: Verdict): Promise<Verified> {
  const r = await ask(VERIFIER, buildVerifyPrompt(c, food, verdict), 120)
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

    if (VERIFY_ONLY) {
      await verifyOnly(prisma, byPhrase)
      return
    }

    // ---- RESUME, and the human-override floor.
    //
    // Read what is already judged. Two separate reasons to skip a phrase, and
    // only one of them is overridable:
    //   a human verdict  -> ALWAYS skipped. --rejudge does not reach it.
    //   a model verdict  -> skipped unless --rejudge.
    let alreadyJudged = 0
    let humanHeld = 0
    let pending = all
    if (LIVE) {
      const seen = await prisma.$queryRaw<{ phrase: string; verdict: string; humanVerdict: string | null }[]>`
        SELECT phrase, verdict, "humanVerdict" FROM "DroppedPhraseVerdict"`
      const human = new Set<string>()
      const model = new Map<string, string>()
      for (const r of seen) {
        if (r.humanVerdict === null) model.set(r.phrase, r.verdict)
        else human.add(r.phrase)
      }
      pending = all.filter((c) => {
        if (human.has(c.phrase)) { humanHeld++; return false }
        const stored = model.get(c.phrase)
        if (stored === undefined) return true
        // Re-ask when --rejudge, or when --rejudge-verdicts names this verdict.
        if (REJUDGE) return true
        if (REJUDGE_VERDICTS.includes(stored)) return true
        alreadyJudged++
        return false
      })
      if (REJUDGE_VERDICTS.length > 0)
        log(`  --rejudge-verdicts: re-asking rows currently labelled ${REJUDGE_VERDICTS.join(', ')}`)
      log('')
      log(`  already in DroppedPhraseVerdict: ${seen.length.toLocaleString()}`)
      log(`    held by a human verdict (never re-judged): ${humanHeld.toLocaleString()}`)
      log(`    model verdict, ${REJUDGE ? 'RE-JUDGING (--rejudge)' : 'skipped'}: ${alreadyJudged.toLocaleString()}`)
      log(`  left to judge: ${pending.length.toLocaleString()}`)
    }

    // In --live mode with no explicit --sample, judge everything that is left.
    const TARGET = LIVE && !SAMPLE_GIVEN ? pending.length : SAMPLE
    const headN = Math.min(Math.round(TARGET * HEAD_SHARE), pending.length)
    const head = pending.slice(0, headN)
    const rest = pending.slice(headN)
    // Deterministic pseudo-shuffle so two runs score the same phrases and are
    // comparable, without pulling in a seeded-random dependency.
    rest.sort((a, b) => (hash(a.phrase) - hash(b.phrase)))
    const tail = rest.slice(0, Math.max(0, TARGET - headN))
    const sample = [...head, ...tail]

    log(`\n===== SAMPLE: ${sample.length} phrases =====`)
    log(`  ${head.length} most-used, ${tail.length} from the long tail`)
    log(`  model ${MODEL}, thinking disabled, concurrency ${CONCURRENCY}`)
    if (LIVE) {
      log('  *** --live: VERDICTS ARE WRITTEN to DroppedPhraseVerdict ***')
      log('  Written as each one is judged, not at the end, so an interrupted')
      log('  run keeps its work and a re-run resumes. A FAILED judgement is')
      log('  NOT written -- an absent row means "not yet judged", which is')
      log('  true and retryable, where a stored non-verdict would be neither.')
    } else {
      log('  NOTHING IS WRITTEN. Pass --live to record these verdicts.')
    }

    // Record one judgement. Upsert, so a resume is idempotent.
    //
    // THE UPDATE BRANCH LISTS ITS FIELDS EXPLICITLY AND humanVerdict,
    // humanNote AND humanAt ARE NOT AMONG THEM. That is the guard, and it is
    // positional: adding a spread of the whole object here would silently
    // destroy human corrections. The verifier columns ARE cleared, because a
    // fresh judgement invalidates the second opinion that was attached to the
    // old one; the verify pass below re-fills them.
    async function record(c: Candidate, j: Judged) {
      if (!LIVE || !j.ok) return
      const data = {
        verdict: j.verdict as string,
        reason: j.reason ?? null,
        model: MODEL,
        judgedAt: new Date(),
        productCount: c.products,
        verifier: null,
        verifierCall: null,
        verifierReason: null,
        verifiedAt: null,
      }
      try {
        await prisma.droppedPhraseVerdict.upsert({
          where: { phrase: c.phrase },
          create: { phrase: c.phrase, ...data },
          update: data,
        })
      } catch (e) {
        log(`  !! WRITE FAILED for ${JSON.stringify(c.phrase)}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

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
          await record(c, j)
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
    // A `product_line` call is flagged only where a structural signal
    // contradicts it. A `motto` call is ALWAYS flagged, because it deletes the
    // phrase and no structural signal exists that separates a motto from a
    // name -- both hypotheses that tried failed.
    const flagged = results.filter(({ j, food }) =>
      j.ok && ((j.verdict === 'product_line' && food.length > 0) || j.verdict === 'motto'))
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
            const v = await verify(row.c, row.food, row.j.verdict as Verdict)
            vInTok += v.inputTokens
            vOutTok += v.outputTokens
            row.v = v
            if (LIVE && v.ok) {
              try {
                await prisma.droppedPhraseVerdict.update({
                  where: { phrase: row.c.phrase },
                  data: {
                    verifier: VERIFIER,
                    verifierCall: v.call as string,
                    verifierReason: v.reason ?? null,
                    verifiedAt: new Date(),
                  },
                })
              } catch (e) {
                log(`  !! VERIFIER WRITE FAILED for ${JSON.stringify(row.c.phrase)}: ${e instanceof Error ? e.message : String(e)}`)
              }
            }
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
      // TWO DIRECTIONS NOW, and the second one is the important one.
      const lineToDesc = flagged.filter((r) => r.j.verdict === 'product_line' && r.v?.ok && r.v.call === 'description')
      const mottoToName = flagged.filter((r) => r.j.verdict === 'motto' && r.v?.ok && r.v.call === 'name')
      log('')
      log(`  MOTTO -> NAME: ${mottoToName.length} rows the first pass would have DELETED`)
      log(`  and the verifier says name something. READ EVERY ONE: this is the`)
      log(`  direction where a mistake destroys information rather than misplacing it.`)
      for (const r of mottoToName.sort((a, b) => b.c.products - a.c.products)) {
        log('')
        log(`  ${String(r.c.products).padStart(4)} products   ${JSON.stringify(r.c.phrase)}   [${r.c.company}]`)
        log(`       ${MODEL}: ${r.j.reason}`)
        log(`       ${VERIFIER}: ${r.v?.reason}`)
        for (const e of r.c.examples) log(`       e.g. ${e}`)
      }
      const overturned = lineToDesc
      log('')
      log(`  BRAND -> DESCRIPTION: ${overturned.length} rows the first pass called a brand`)
      log(`  and the verifier calls a description. These move to the secondary.`)
      for (const r of overturned.sort((a, b) => b.c.products - a.c.products)) {
        log('')
        log(`  ${String(r.c.products).padStart(4)} products   ${JSON.stringify(r.c.phrase)}   [${r.c.company}]`)
        log(`       food words: ${r.food.join(', ')}`)
        log(`       ${MODEL}: ${r.j.reason}`)
        log(`       ${VERIFIER}: ${r.v?.reason}`)
        for (const e of r.c.examples) log(`       e.g. ${e}`)
      }
      const upheld = flagged.filter((r) => r.j.verdict === 'product_line' && r.v?.ok && r.v.call === 'name')
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

    if (LIVE) {
      const stored = await prisma.$queryRaw<{ n: bigint; verified: bigint; human: bigint }[]>`
        SELECT count(*) AS n,
               count(*) FILTER (WHERE "verifiedAt" IS NOT NULL) AS verified,
               count(*) FILTER (WHERE "humanVerdict" IS NOT NULL) AS human
          FROM "DroppedPhraseVerdict"`
      const row = stored[0]
      log('\n===== WRITTEN =====')
      log(`  DroppedPhraseVerdict now holds ${Number(row.n).toLocaleString()} rows`)
      log(`    with a second opinion: ${Number(row.verified).toLocaleString()}`)
      log(`    held by a human:       ${Number(row.human).toLocaleString()}`)
      // NOT `byPhrase.size - rows`. That conflates two different things and
      // printed "-3" on the 2026-11-09 full run: the table also holds rows for
      // phrases that have since STOPPED existing, because a strip fix changed
      // what gets dropped. Count the two separately.
      const inSet = [...byPhrase.keys()]
      const stillOpen = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n
          FROM unnest(${inSet}::text[]) AS p(phrase)
         WHERE NOT EXISTS (
           SELECT 1 FROM "DroppedPhraseVerdict" d WHERE d.phrase = p.phrase)`
      log(`  phrases in the set, still unjudged: ${Number(stillOpen[0].n).toLocaleString()}`)
      log(`  rows whose phrase no longer exists: ${(Number(row.n) - (byPhrase.size - Number(stillOpen[0].n))).toLocaleString()}`)
      log('    (a strip fix changed what gets dropped; these are harmless but')
      log('     they are stale, and a re-run will not revisit them)')
      log('')
      log('  NOTHING DISPLAYS YET. The page still uses the r37 rule, so these')
      log('  verdicts change nothing a reader sees until it is wired up -- and')
      log('  per r30 that waits on a hand-scored sample, which is the only')
      log('  ground truth there will ever be for this column.')
    } else {
      log('\n===== NOTHING WAS WRITTEN =====')
      log('  If the verdicts above read right, re-run with --live to record')
      log('  them, then hand-score a sample before anything is wired to a')
      log('  page -- that sample is the only ground truth there will ever be.')
    }
    log(`\nLog written to ${LOG_FILE}`)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the second opinion over stored rows that never received one.
//
// IT TAKES THE SCANNED MAP RATHER THAN QUERYING FOR EXAMPLES. The verifier
// needs the same evidence the first pass had -- the company and up to three
// product names -- and those are not on the verdict row. The first draft of
// this fetched them with `p.name ILIKE phrase || '%'`, which would have missed
// most rows, because `phrase` comes from the DISPLAYED name after the company
// strip and the stored name usually still carries the company in front of it.
// So it reuses the scan above: the same functions, on the same rows, as the
// path that produced the verdicts. Costs one extra pass over Product and is
// correct instead of approximately correct.
async function verifyOnly(
  prisma: PrismaClient,
  byPhrase: Map<string, { company: string; products: number; examples: string[] }>
) {
  log('\n===== SECOND OPINION ONLY =====')
  log('  No first pass. Nothing is re-asked of the first model, and no verdict')
  log('  is rewritten -- only the verifier columns are filled in.')
  log(`  verifier ${VERIFIER}, limit ${VERIFY_LIMIT}, ordered by product reach`)
  if (VERIFY_SINCE) log(`  only rows judged at or after ${VERIFY_SINCE}`)

  type Row = { phrase: string; reason: string | null; productCount: number }
  const since = VERIFY_SINCE ? new Date(VERIFY_SINCE) : new Date(0)
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT phrase, reason, "productCount"
      FROM "DroppedPhraseVerdict"
     WHERE verdict = 'product_line'
       AND "verifiedAt" IS NULL
       AND "humanVerdict" IS NULL
       AND "judgedAt" >= ${since}
     ORDER BY "productCount" DESC, phrase
     LIMIT ${VERIFY_LIMIT}`
  log(`  rows matching:  ${rows.length.toLocaleString()}`)

  // A stored phrase may no longer be in the dropped set at all, after a strip
  // fix changed what gets dropped. Those cannot be verified -- there is no
  // evidence left to show the model -- and silently sending an empty example
  // list would be worse than skipping them.
  const have = rows.filter((r) => byPhrase.has(r.phrase))
  log(`  with evidence:  ${have.length.toLocaleString()}`)
  if (have.length < rows.length)
    log(`  SKIPPED ${rows.length - have.length}: phrase no longer in the dropped set, so there is nothing to show the verifier`)
  if (have.length === 0) {
    log('  nothing to do.')
    return
  }

  let vIn = 0, vOut = 0, next = 0
  const out: { r: Row; v: Verified }[] = []
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const i = next++
        if (i >= have.length) return
        const r = have[i]
        const ev = byPhrase.get(r.phrase) as { company: string; products: number; examples: string[] }
        const c: Candidate = {
          phrase: r.phrase,
          company: ev.company,
          products: ev.products,
          examples: ev.examples,
        }
        const v = await verify(c, foodWordsIn(r.phrase), 'product_line')
        vIn += v.inputTokens
        vOut += v.outputTokens
        out.push({ r, v })
        if (v.ok) {
          try {
            await prisma.droppedPhraseVerdict.update({
              where: { phrase: r.phrase },
              data: {
                verifier: VERIFIER,
                verifierCall: v.call as string,
                verifierReason: v.reason ?? null,
                verifiedAt: new Date(),
              },
            })
          } catch (e) {
            log(`  !! WRITE FAILED for ${JSON.stringify(r.phrase)}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        if (out.length % 50 === 0) console.log(`  ... ${out.length}/${have.length} checked`)
      }
    })
  )

  const counts = new Map<string, number>()
  for (const { v } of out) {
    const k = v.ok ? (v.call as string) : `FAILED: ${(v.failure ?? '').split(':')[0]}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  log('')
  for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(4)}  ${k}`)

  const desc = out.filter(({ v }) => v.ok && v.call === 'description')
  const decided = out.filter(({ v }) => v.ok && v.call !== 'unsure').length
  log('')
  log(`  OVERTURNED: ${desc.length} of ${decided} decided (${decided > 0 ? ((desc.length / decided) * 100).toFixed(1) : '0'}%)`)
  log('  Stored as product_line, verifier calls them descriptions.')
  log('')
  log('  THE RATE IS THE POINT, NOT THE ROWS. 26.3% was the first cohort and')
  log('  43.6% the 117 promoted rows the food-word flag happened to catch. If')
  log('  it holds here, the promoted cohort should not reach a page until a')
  log('  person has been through it.')
  for (const { r, v } of desc.sort((a, b) => b.r.productCount - a.r.productCount)) {
    log('')
    log(`  ${String(r.productCount).padStart(4)} products   ${JSON.stringify(r.phrase)}`)
    log(`       ${MODEL}: ${r.reason}`)
    log(`       ${VERIFIER}: ${v.reason}`)
    for (const e of byPhrase.get(r.phrase)?.examples ?? []) log(`       e.g. ${e}`)
  }

  // Sonnet published rates. CHECK THESE before quoting them anywhere.
  const cost = (vIn / 1e6) * 3 + (vOut / 1e6) * 15
  log('')
  log(`  ${VERIFIER} in ${vIn.toLocaleString()} out ${vOut.toLocaleString()}  $${cost.toFixed(4)}`)
  log(`\nLog written to ${LOG_FILE}`)
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

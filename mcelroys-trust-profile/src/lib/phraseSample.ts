// WHICH ~200 OF THE 6,684 VERDICTS A HUMAN SCORES, AND WHY THOSE.
//
// Michael, 2026-11-12: "i will not have time to hand score 1100 verdicts."
// He does not have to. The hand-scored set is a SAMPLE whose only job is to
// measure the model's error rate per verdict class; it was never meant to be
// the whole table. ~200 rows answers that question, and takes one sitting.
//
// THE SAMPLE MUST BE STABLE AND IT MUST NOT BE HEAD-WEIGHTED. Those two
// properties are the whole design, and both were learned the hard way.
//
//   STABLE: if the page drew a fresh random sample on every load, a reviewer
//   who scores twenty rows, closes the tab and comes back would be scoring a
//   different twenty. The scored set becomes a biased walk through the table
//   and measures nothing. So the order is a pure function of the phrase --
//   same rows, same order, every load, forever, with no stored sample and no
//   extra column.
//
//   NOT HEAD-WEIGHTED: ordering by productCount would put the biggest phrases
//   first, and r38 already paid for that mistake three times -- "$1.79 ->
//   $2.11 -> $2.40 actual ... a rate measured on the easy head of a
//   distribution under-predicts the tail every time." The classifier's own
//   200-row pilot was head-weighted and its 13% overturn rate turned out to
//   be 26.4% over the full run. A hash of the phrase is uncorrelated with
//   size, spelling, company and verdict, which is exactly what is wanted.
//
// THE QUOTAS ARE NOT PROPORTIONAL, ALSO ON PURPOSE. product_line is 68% of
// the table but it is the verdict that merely DISPLAYS a phrase. motto,
// company_name and unclear DELETE it, and r38's lesson was "verify the
// verdict that destroys, not the one that displays" -- so the destructive
// classes are over-sampled relative to their share, and motto, at 16 rows
// with a measured 37.5% error, is scored in full.

export const VERDICTS = ['product_line', 'claim', 'company_name', 'motto', 'unclear'] as const
export type Verdict = (typeof VERDICTS)[number]

// What each verdict does to the phrase on the page. The reviewer sees this,
// because "which of these deletes the phrase" is the only context that makes
// a wrong call feel as expensive as it is.
export const VERDICT_EFFECT: Record<string, 'shows' | 'deletes'> = {
  product_line: 'shows',
  claim: 'shows',
  company_name: 'deletes',
  motto: 'deletes',
  unclear: 'deletes',
}

export const SAMPLE_PLAN: { verdict: string; take: number; why: string }[] = [
  { verdict: 'motto', take: 1000, why: 'all of them — 16 rows, and the verifier overturned 37.5%' },
  { verdict: 'company_name', take: 50, why: 'deletes the phrase' },
  { verdict: 'unclear', take: 50, why: 'deletes the phrase, and it is the largest destructive class' },
  { verdict: 'claim', take: 40, why: 'the newest verdict, never measured against a human' },
  { verdict: 'product_line', take: 50, why: 'the only verdict that displays; 26.4% verifier overturn' },
]

// FNV-1a, 32-bit. Deliberately NOT crypto: this needs to be deterministic,
// dependency-free and runnable in a selftest, and it is choosing a sample
// order, not protecting anything.
export function stableHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export type Scorable = { phrase: string; verdict: string; humanVerdict: string | null }

// The sample, in the order a reviewer should see it. Rows already carrying a
// humanVerdict stay IN the sample and keep their place -- they are the
// progress bar, and dropping them would renumber everything on every save.
export function pickSample<T extends Scorable>(rows: T[]): T[] {
  const out: T[] = []
  for (const quota of SAMPLE_PLAN) {
    const ofClass = rows
      .filter((r) => r.verdict === quota.verdict)
      .sort((a, b) => {
        const d = stableHash(a.phrase) - stableHash(b.phrase)
        // A hash tie would otherwise leave the order to Array.sort's input
        // order, which is the database's, which is not stable.
        return d !== 0 ? d : a.phrase < b.phrase ? -1 : a.phrase > b.phrase ? 1 : 0
      })
      .slice(0, quota.take)
    out.push(...ofClass)
  }
  return out
}

export function sampleProgress<T extends Scorable>(sample: T[]) {
  const done = sample.filter((r) => r.humanVerdict !== null).length
  return { done, total: sample.length, remaining: sample.length - done }
}

// --------------------------------------------------------------- selftest
//   npx tsx src/lib/phraseSample.ts --selftest
// ⚠️ THE typeof GUARD IS NOT DECORATION. Every other selftest block in this
// repo lives in a file that only scripts and server code import, where
// process.argv always exists. This file is imported by a CLIENT component —
// the scoring board needs VERDICTS and VERDICT_EFFECT — and in the browser
// Next ships a `process` shim carrying env and nothing else, so
// `process.argv[1]` throws "Cannot read properties of undefined (reading
// '1')" before a single component renders. Optional chaining does not save
// it: `process.argv` is what is undefined, not its first element. And tsc
// sees none of this, because the type says string[].
const IS_SELFTEST_CLI =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('phraseSample.ts') === true &&
  process.argv.includes('--selftest')

if (IS_SELFTEST_CLI) {

  let bad = 0
  const ok = (label: string, cond: boolean) => {
    if (!cond) bad++
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
  }

  const mk = (phrase: string, verdict: string, humanVerdict: string | null = null) =>
    ({ phrase, verdict, humanVerdict })

  // Deterministic, and not trivially so.
  ok('hash is deterministic', stableHash('lindor') === stableHash('lindor'))
  ok('hash separates near-identical strings', stableHash('lindor') !== stableHash('lindo'))
  ok('hash is a uint32', stableHash('x') >= 0 && stableHash('x') <= 0xffffffff)

  // THE PROPERTY THAT MATTERS: the same rows in the same order, whatever
  // order the database happened to return them in.
  const rows = Array.from({ length: 400 }, (_, i) => mk(`phrase-${i}`, 'product_line'))
  const a = pickSample(rows).map((r) => r.phrase)
  const shuffled = [...rows].reverse()
  const b = pickSample(shuffled).map((r) => r.phrase)
  ok('sample is identical under a reversed input', JSON.stringify(a) === JSON.stringify(b))
  const c = pickSample([...rows].sort(() => 0.5 - Math.random())).map((r) => r.phrase)
  ok('sample is identical under a shuffled input', JSON.stringify(a) === JSON.stringify(c))

  // ...and it is NOT just the first N, which is what a missing sort would give.
  ok('sample is not the input order', JSON.stringify(a) !== JSON.stringify(rows.slice(0, 50).map((r) => r.phrase)))

  ok('quota is respected', a.length === 50)

  // A class smaller than its quota returns all of it, not an error.
  const few = [mk('a', 'motto'), mk('b', 'motto')]
  ok('a short class returns everything it has', pickSample(few).length === 2)

  // Every class in the plan is represented, and only classes in the plan.
  const mixed = [
    ...Array.from({ length: 80 }, (_, i) => mk(`pl${i}`, 'product_line')),
    ...Array.from({ length: 80 }, (_, i) => mk(`un${i}`, 'unclear')),
    ...Array.from({ length: 80 }, (_, i) => mk(`cn${i}`, 'company_name')),
    ...Array.from({ length: 80 }, (_, i) => mk(`cl${i}`, 'claim')),
    ...Array.from({ length: 5 }, (_, i) => mk(`mo${i}`, 'motto')),
    ...Array.from({ length: 80 }, (_, i) => mk(`zz${i}`, 'something_else')),
  ]
  const s = pickSample(mixed)
  ok('plan quotas applied per class', s.filter((r) => r.verdict === 'product_line').length === 50)
  ok('claim quota is 40', s.filter((r) => r.verdict === 'claim').length === 40)
  ok('all 5 mottos taken', s.filter((r) => r.verdict === 'motto').length === 5)
  ok('a verdict not in the plan is excluded', s.filter((r) => r.verdict === 'something_else').length === 0)
  ok('total is the sum of the quotas', s.length === 50 + 40 + 50 + 50 + 5)

  // Scored rows keep their place, so the list does not renumber on save.
  const withScores = mixed.map((r, i) => (i % 3 === 0 ? { ...r, humanVerdict: 'motto' } : r))
  const s2 = pickSample(withScores)
  ok('a scored row stays in the sample', s2.length === s.length)
  ok('order is unchanged by scoring', JSON.stringify(s2.map((r) => r.phrase)) === JSON.stringify(s.map((r) => r.phrase)))

  const p = sampleProgress(s2)
  ok('progress counts scored rows', p.done + p.remaining === p.total && p.done > 0)

  console.log(bad === 0 ? '\nphraseSample: all cases pass' : `\nphraseSample: ${bad} FAILURES`)
  if (bad > 0) process.exitCode = 1
}

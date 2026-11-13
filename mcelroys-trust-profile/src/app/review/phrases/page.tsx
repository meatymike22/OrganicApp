// THE HAND-SCORING PAGE — the ground truth the whole title thread waits on.
//
// Michael, 2026-11-12: "i will not have time to hand score 1100 verdicts."
// He does not have to. See src/lib/phraseSample.ts: the scored set is a
// ~206-row stratified sample whose only job is to measure the model's error
// rate per verdict class, and r30's rule is that such a sample must exist
// "before it gates anything" because a model's verdict "cannot be re-derived
// from the source tables, so that sample is the only ground truth there will
// ever be."
//
// ⚠️ DEVELOPMENT ONLY, deliberately. He also asked whether the public could
// contribute here. They could, eventually, but not as this: a stranger's
// verdict is not the human-review step this project's legal posture rests on,
// and DroppedPhraseVerdict has humanVerdict/humanNote/humanAt and no
// humanBy — there is nowhere to record WHOSE verdict it is. That needs a
// migration and accounts before anyone but Michael writes here.
import { notFound } from 'next/navigation'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { pickSample, sampleProgress, SAMPLE_PLAN } from '@/lib/phraseSample'
import { ScoreBoard, type ScoreRow } from './ScoreBoard'
import { colors, font, layout } from '@/lib/design'

// Never cached: a score written a second ago must be on the next render.
export const dynamic = 'force-dynamic'

type Evidence = { company: string; products: number; examples: string[] }
type EvidenceFile = { builtAt: string; scanned: number; phrases: Record<string, Evidence> }

function readEvidence(): EvidenceFile | null {
  try {
    const p = path.join(process.cwd(), 'data', 'phrase-evidence.json')
    return JSON.parse(fs.readFileSync(p, 'utf8')) as EvidenceFile
  } catch {
    return null
  }
}

export default async function Page() {
  if (process.env.NODE_ENV === 'production') notFound()

  const all = await prisma.droppedPhraseVerdict.findMany({
    select: {
      phrase: true, verdict: true, reason: true, model: true,
      verifierCall: true, verifierReason: true,
      humanVerdict: true, humanNote: true, productCount: true,
    },
  })
  const sample = pickSample(all)
  const progress = sampleProgress(sample)
  const ev = readEvidence()

  const rows: ScoreRow[] = sample.map((r) => {
    const e = ev?.phrases[r.phrase]
    return {
      phrase: r.phrase,
      verdict: r.verdict,
      reason: r.reason,
      model: r.model,
      verifierCall: r.verifierCall,
      verifierReason: r.verifierReason,
      humanVerdict: r.humanVerdict,
      humanNote: r.humanNote,
      productCount: r.productCount,
      company: e?.company ?? null,
      examples: e?.examples ?? [],
    }
  })

  return (
    <main
      style={{
        maxWidth: 820, margin: '0 auto', padding: '28px 16px 80px',
        background: colors.paper, minHeight: '100vh', fontFamily: font.sans,
      }}
    >
      <h1 style={{ margin: 0, fontFamily: font.display, fontSize: 26, fontWeight: 600, color: colors.ink }}>
        Score the dropped-phrase verdicts
      </h1>
      <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, color: colors.ink2, maxWidth: '64ch' }}>
        {progress.total} rows, sampled from {all.length.toLocaleString()} judged phrases. The sample is
        a pure function of the phrase, so it is the same {progress.total} rows every time you open this
        — close the tab and come back and you will not be scoring different ones.
      </p>

      {ev === null && (
        <div
          style={{
            marginTop: 14, padding: '12px 14px', borderRadius: layout.radius,
            border: `1px solid ${colors.line}`, background: colors.card,
            fontSize: 13.5, lineHeight: 1.55, color: colors.ink2,
          }}
        >
          <strong style={{ color: colors.ink }}>No evidence file.</strong> The company and example
          product names are missing, and they are most of what makes a phrase judgeable. Run{' '}
          <code style={{ fontFamily: font.mono }}>
            npx tsx scripts/build-phrase-evidence.ts
          </code>{' '}
          first.
        </div>
      )}

      {ev !== null && (
        <p style={{ margin: '8px 0 0', fontSize: 12.5, color: colors.ink4 }}>
          Evidence built {new Date(ev.builtAt).toLocaleString()} from {ev.scanned.toLocaleString()}{' '}
          products — the same scan, through the same two functions, that the classifier saw.
        </p>
      )}

      <details style={{ marginTop: 14 }}>
        <summary style={{ fontSize: 13, color: colors.ink3, cursor: 'pointer' }}>
          Why these rows and not the biggest ones
        </summary>
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6, color: colors.ink2 }}>
          Ordering by product count would put the largest phrases first, and a rate measured on the
          easy head of a distribution under-predicts the tail every time — the classifier&rsquo;s own
          head-weighted pilot said 13% and the full run came back 26.4%. The quotas are not
          proportional either: the verdicts that <em>delete</em> a phrase are over-sampled, because an
          error there loses a real brand.
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {SAMPLE_PLAN.map((q) => (
              <li key={q.verdict} style={{ marginTop: 3 }}>
                <strong>{q.verdict}</strong> — {q.why}
              </li>
            ))}
          </ul>
        </div>
      </details>

      <ScoreBoard rows={rows} />
    </main>
  )
}

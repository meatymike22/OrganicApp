'use client'

// THE SCORING UI. Built for one property above all others: speed.
//
// 206 rows is one sitting only if a row costs about ten seconds, so the
// whole interaction is keyboard — a number key picks a verdict, Enter agrees
// with the model, and either one advances. The mouse works, and nobody who
// is actually scoring will use it.
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { colors, font, layout, status } from '@/lib/design'
import { VERDICTS, VERDICT_EFFECT } from '@/lib/phraseSample'
import { saveHumanVerdict } from './actions'

export type ScoreRow = {
  phrase: string
  verdict: string
  reason: string | null
  model: string
  verifierCall: string | null
  verifierReason: string | null
  humanVerdict: string | null
  humanNote: string | null
  productCount: number
  company: string | null
  examples: string[]
}

export function ScoreBoard({ rows }: { rows: ScoreRow[] }) {
  // The server's values are the truth; this holds what has been written since
  // the last render so a score appears instantly instead of after a round
  // trip. Keyed by phrase, which is unique.
  const [local, setLocal] = useState<Record<string, string | null>>({})
  const [i, setI] = useState(0)
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()
  const noteRef = useRef<HTMLInputElement>(null)

  const scored = useCallback(
    (r: ScoreRow) => (r.phrase in local ? local[r.phrase] : r.humanVerdict),
    [local]
  )

  const done = useMemo(() => rows.filter((r) => scored(r) !== null).length, [rows, scored])
  const row = rows[i]

  const go = useCallback(
    (delta: number) => {
      setI((n) => Math.min(rows.length - 1, Math.max(0, n + delta)))
      setNote('')
    },
    [rows.length]
  )

  // The next row with no score, which is where a returning reviewer wants to
  // be — not back at row 1.
  const jumpToNextUnscored = useCallback(() => {
    const from = rows.findIndex((r, n) => n > i && scored(r) === null)
    const any = rows.findIndex((r) => scored(r) === null)
    const target = from !== -1 ? from : any
    if (target !== -1) {
      setI(target)
      setNote('')
    }
  }, [rows, i, scored])

  const save = useCallback(
    (verdict: string | null) => {
      if (row === undefined) return
      const phrase = row.phrase
      const n = note
      setLocal((m) => ({ ...m, [phrase]: verdict }))
      startTransition(async () => {
        try {
          await saveHumanVerdict(phrase, verdict, n === '' ? null : n)
        } catch (e) {
          // Put it back rather than showing a score that was never written.
          setLocal((m) => ({ ...m, [phrase]: row.humanVerdict }))
          console.error('failed to save', phrase, e)
        }
      })
      setNote('')
      if (verdict !== null) setTimeout(() => go(1), 60)
    },
    [row, note, go]
  )

  useEffect(() => {
    // Land on the first unscored row when the page opens.
    const first = rows.findIndex((r) => r.humanVerdict === null)
    if (first > 0) setI(first)
    // Intentionally once: later renders must not yank the reviewer around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Never while typing a note.
      if (document.activeElement === noteRef.current) {
        if (e.key === 'Escape') noteRef.current?.blur()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key >= '1' && e.key <= String(VERDICTS.length)) {
        e.preventDefault()
        save(VERDICTS[Number(e.key) - 1])
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (row !== undefined) save(row.verdict)
      } else if (e.key === 'ArrowRight' || e.key === 'j') {
        e.preventDefault(); go(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'k') {
        e.preventDefault(); go(-1)
      } else if (e.key === 'n') {
        e.preventDefault(); noteRef.current?.focus()
      } else if (e.key === 'u') {
        e.preventDefault(); save(null)
      } else if (e.key === 'Tab') {
        e.preventDefault(); jumpToNextUnscored()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, go, row, jumpToNextUnscored])

  if (row === undefined) {
    return <p style={{ marginTop: 24, color: colors.ink2 }}>No verdicts to score.</p>
  }

  const current = scored(row)
  const agreesWithModel = current !== null && current === row.verdict

  return (
    <div style={{ marginTop: 18 }}>
      {/* progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, height: 6, background: colors.line, borderRadius: 3, overflow: 'hidden' }}>
          <div
            style={{
              width: `${(done / rows.length) * 100}%`, height: '100%',
              background: status.confirmed.fg, transition: 'width .2s cubic-bezier(.22,1,.36,1)',
            }}
          />
        </div>
        <span style={{ fontSize: 13, color: colors.ink2, fontVariantNumeric: 'tabular-nums' }}>
          {done} / {rows.length} scored
        </span>
        <span style={{ fontSize: 12, color: colors.ink4, fontVariantNumeric: 'tabular-nums' }}>
          row {i + 1}
        </span>
      </div>

      {/* the card */}
      <div
        style={{
          marginTop: 16, padding: '20px 22px', background: colors.card,
          border: `1px solid ${colors.line}`,
          borderLeft: `4px solid ${current === null ? colors.lineStrong : status.confirmed.fg}`,
          borderRadius: layout.radius,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: 0.35, color: colors.ink4 }}>
          <span style={{ textTransform: 'uppercase' }}>The dropped phrase</span>
        </div>
        <div style={{ marginTop: 4, fontFamily: font.display, fontSize: 30, fontWeight: 600, color: colors.ink }}>
          {row.phrase}
        </div>

        <div style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.6, color: colors.ink2 }}>
          <div>
            <span style={{ color: colors.ink4 }}>company </span>
            {row.company ?? <em style={{ color: colors.ink4 }}>no evidence file</em>}
            <span style={{ color: colors.ink4 }}>
              {' · '}{row.productCount.toLocaleString()} {row.productCount === 1 ? 'product' : 'products'}
            </span>
          </div>
          {row.examples.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: colors.ink2 }}>
              {row.examples.map((e) => (
                <li key={e} style={{ marginTop: 2 }}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        {/* what the machines said — AFTER the evidence, on purpose: reading
            the verdict first is how a reviewer ends up agreeing with it. */}
        <div
          style={{
            marginTop: 16, paddingTop: 14, borderTop: `1px solid ${colors.line}`,
            fontSize: 13, lineHeight: 1.55, color: colors.ink2,
          }}
        >
          <div>
            <strong style={{ color: colors.ink }}>{row.verdict}</strong>
            <span style={{ color: colors.ink4 }}>
              {' '}— {VERDICT_EFFECT[row.verdict] === 'deletes' ? 'deletes the phrase' : 'shows the phrase'} · {row.model}
            </span>
          </div>
          {row.reason !== null && <div style={{ marginTop: 3, color: colors.ink3 }}>{row.reason}</div>}
          {row.verifierCall !== null && (
            <div style={{ marginTop: 7, color: colors.ink3 }}>
              <span style={{ color: colors.ink4 }}>second opinion: </span>
              <strong style={{ color: colors.ink2 }}>{row.verifierCall}</strong>
              {row.verifierReason !== null && ` — ${row.verifierReason}`}
            </div>
          )}
        </div>
      </div>

      {/* the buttons */}
      <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {VERDICTS.map((v, n) => {
          const picked = current === v
          return (
            <button
              key={v}
              onClick={() => save(v)}
              style={{
                padding: '9px 13px', borderRadius: layout.radius, cursor: 'pointer',
                border: `1px solid ${picked ? status.confirmed.fg : colors.line}`,
                background: picked ? status.confirmed.bg : colors.card,
                color: picked ? status.confirmed.fg : colors.ink2,
                fontSize: 13.5, fontWeight: picked ? 600 : 400, fontFamily: 'inherit',
                transition: 'background .12s, border-color .15s',
              }}
            >
              <span style={{ color: colors.ink4, marginRight: 6 }}>{n + 1}</span>
              {v}
              {VERDICT_EFFECT[v] === 'deletes' && (
                <span style={{ color: colors.ink4, marginLeft: 6, fontSize: 11 }}>del</span>
              )}
            </button>
          )
        })}
      </div>

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          ref={noteRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="note (n) — optional, saved with the next verdict"
          style={{
            flex: 1, minWidth: 240, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
            border: `1px solid ${colors.line}`, borderRadius: layout.radius,
            background: colors.card, color: colors.ink,
          }}
        />
        <button onClick={() => save(null)} style={ghost}>clear (u)</button>
        <button onClick={() => go(-1)} style={ghost}>← prev</button>
        <button onClick={() => go(1)} style={ghost}>next →</button>
        <button onClick={jumpToNextUnscored} style={ghost}>next unscored (tab)</button>
      </div>

      <p style={{ marginTop: 10, fontSize: 12.5, color: colors.ink4, lineHeight: 1.5 }}>
        <strong style={{ color: colors.ink3 }}>Enter</strong> agrees with the model
        {agreesWithModel && <span style={{ color: status.confirmed.fg }}> · agreed</span>}
        {' · '}<strong style={{ color: colors.ink3 }}>1–5</strong> picks a verdict
        {' · '}<strong style={{ color: colors.ink3 }}>←/→</strong> moves
        {pending && <span style={{ color: colors.ink4 }}> · saving…</span>}
      </p>
      {row.humanNote !== null && (
        <p style={{ marginTop: 6, fontSize: 12.5, color: colors.ink3 }}>
          saved note: {row.humanNote}
        </p>
      )}
    </div>
  )
}

const ghost: React.CSSProperties = {
  padding: '8px 11px', borderRadius: layout.radius, cursor: 'pointer',
  border: `1px solid ${colors.line}`, background: colors.card,
  color: colors.ink3, fontSize: 12.5, fontFamily: 'inherit',
}

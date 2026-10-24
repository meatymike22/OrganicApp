import Link from 'next/link'
import { colors, font, layout } from '@/lib/design'
import { AisleBar, SiteFooter, TopNav } from '@/components/SiteChrome'
import { correctionsNewestFirst, type Correction } from '@/lib/corrections'

// CORRECTIONS — the fourth page that was promising something and 404ing.
//
// The home page links here twice: once in body copy ("the correction is
// dated and stays on the page — read our corrections log") and once in the
// footer. `/contact` describes the practice in prose because this page did
// not exist. So the site has been publicly committing to a corrections log
// while the link went nowhere, which is the same failure `/contact` fixed.
//
// WHY A PAGE AND NOT A PARAGRAPH. The project's protective measures include
// "respond promptly to any disputes; correct if wrong, hold ground with
// sources if right", and the home page's claim is specifically that a
// correction is DATED and STAYS VISIBLE rather than being quietly edited
// away. That promise needs somewhere to live, and it needs to keep the old
// wording — a page that only shows the current text is not a correction log.
//
// THE HARD PART IS THE EMPTY STATE, and it is a truthfulness problem rather
// than a design one. An empty log invites exactly one wrong inference: that
// the site has never been wrong. It has been public since 2026-10-11, which
// is not long, and nobody has reported anything. Those are different facts
// from "we have made no errors" and the page says which one it is. This is
// the same three-state rule the rest of the site runs on — confirmed,
// nothing on file, not checked — turned on ourselves.
//
// WHAT IS DELIBERATELY NOT HERE:
//
//   NO DISCLAIMERS. Michael, repeatedly: the caveats live on /disclaimer and
//   nowhere else. Linked once at the end.
//
//   NO RESPONSE-TIME PROMISE, for the same reason /contact has none.
//
//   NO "last reviewed" DATE. It would be a freshness claim about the whole
//   catalogue that nothing verifies, and an unverified freshness claim on a
//   page about accuracy is worse than no claim.
//
//   NO SCORE, COUNT-AS-VIRTUE, or "accuracy rate". A low correction count is
//   not evidence of accuracy, and presenting it as a number invites reading
//   it as one.
//
// WHEN THE FIRST REAL CORRECTION LANDS it will also need a note ON the page
// it affected, linking back to the #anchor here. That mechanism does not
// exist yet — see the backlog. This page is the index, not the whole promise.

export const metadata = {
  title: 'Corrections',
  description:
    'Every correction Rootify has made to a fact about a named company or product, with the date and what the page said before.',
}

const PUBLIC_SINCE = '11 October 2026'

export default function CorrectionsPage() {
  const log = correctionsNewestFirst()

  return (
    <>
      <TopNav />
      <AisleBar />

      <div
        style={{
          flexGrow: 1,
          maxWidth: 820,
          marginLeft: 'auto',
          marginRight: 'auto',
          width: '100%',
          boxSizing: 'border-box',
          padding: `28px clamp(18px, 4vw, ${layout.gutter}px) 0`,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: font.display,
            fontSize: 'clamp(27px, 3.6vw, 36px)',
            fontWeight: 600,
            lineHeight: 1.12,
            letterSpacing: '-0.015em',
          }}
        >
          Corrections
        </h1>

        <p style={{ margin: '14px 0 0', fontSize: 15.5, lineHeight: 1.65, color: colors.ink2 }}>
          When we get a fact wrong about a company or a product, we fix it and record it here —
          dated, and including what the page said before. The old wording stays visible. A
          correction you cannot see is not a correction.
        </p>

        <Section title={log.length === 0 ? 'The log' : `The log — ${log.length} so far`}>
          {log.length === 0 ? <EmptyLog /> : log.map((c) => <Entry key={c.id} c={c} />)}
        </Section>

        <Section title="What goes in this log, and what does not">
          <P>
            <strong style={{ color: colors.ink }}>Logged:</strong> anything that changed a fact
            about a named company or product. The wrong company, a wrong ingredient list, a recall
            attached to the wrong maker, a misread register entry, a wrong date or number.
          </P>
          <P>
            <strong style={{ color: colors.ink }}>Not logged:</strong> typos, wording, layout, a
            tooltip rewritten to be clearer, a section moved. Those change how a fact reads, not
            what it says.
          </P>
          <P>
            The line matters in both directions. Log too little and this page is decorative; log
            every wording change and the real corrections are buried under them, which fails the
            same way.
          </P>
        </Section>

        <Section title="Found something wrong?">
          <P>
            Tell us and it gets fixed and listed here. The{' '}
            <Link href="/contact" style={{ color: colors.link }}>
              contact page
            </Link>{' '}
            says what to include and what happens next — or write straight to{' '}
            <a
              href="mailto:corrections@rootify.app"
              style={{ color: colors.link, fontWeight: 600, wordBreak: 'break-word' }}
            >
              corrections@rootify.app
            </a>
            .
          </P>
          <P>
            One thing worth saying here as well as there: we correct errors, and we do not remove
            accurate records. If a recall notice or a register entry genuinely names a company, it
            stays on the page with its source and its date.
          </P>
        </Section>

        <Section title="Where a correction cannot help">
          <P>
            We can correct our reading of a public record. We cannot change the record. If a
            register entry or a recall notice is itself wrong at the source, the fix has to happen
            there — what we will do is say so on the page and link what you have told us.
          </P>
          <P>
            What we are and are not claiming about any of this data, and why there are no scores,
            is on the{' '}
            <Link href="/disclaimer" style={{ color: colors.link }}>
              disclaimer page
            </Link>
            .
          </P>
        </Section>

        <div style={{ height: 44 }} />
      </div>

      <SiteFooter />
    </>
  )
}

// THE EMPTY STATE. The one thing this must not do is let "nothing listed"
// read as "never wrong". So it states the two facts separately: how long the
// site has been public, and that nothing has been reported or found. It
// deliberately does not congratulate itself.
function EmptyLog() {
  return (
    <div
      style={{
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderRadius: layout.radius,
        padding: '18px 18px 8px',
      }}
    >
      <P>
        <strong style={{ color: colors.ink }}>Nothing has been corrected yet.</strong> Rootify has
        been public since {PUBLIC_SINCE}. In that time nobody has reported a factual error and we
        have not found one ourselves.
      </P>
      <P>
        That is a short record and a small number of readers, not a claim to be right. We are
        publishing hundreds of thousands of product records built from public registers, and some
        of them will be wrong. This page is where you will see it when they are.
      </P>
    </div>
  )
}

function Entry({ c }: { c: Correction }) {
  return (
    <div
      id={c.id}
      style={{
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderRadius: layout.radius,
        padding: '16px 18px',
        marginBottom: 12,
        scrollMarginTop: 90,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
          fontSize: 12,
          color: colors.ink3,
        }}
      >
        <time dateTime={c.correctedOn} style={{ fontFamily: font.mono }}>
          {c.correctedOn}
        </time>
        <span>·</span>
        <span>{reportedByLabel(c.reportedBy)}</span>
      </div>

      <div
        style={{
          marginTop: 6,
          fontFamily: font.display,
          fontSize: 17,
          fontWeight: 600,
          lineHeight: 1.3,
        }}
      >
        {c.href ? (
          <Link href={c.href} style={{ color: colors.ink }}>
            {c.where}
          </Link>
        ) : (
          c.where
        )}
      </div>

      <Field label="It said">{c.said}</Field>
      <Field label="It now says">{c.saysNow}</Field>
      <Field label="Why it was wrong">{c.why}</Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10, maxWidth: '72ch' }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: colors.ink4,
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 3, fontSize: 14.5, lineHeight: 1.62, color: colors.ink2 }}>
        {children}
      </div>
    </div>
  )
}

// "We found it ourselves" is said plainly rather than omitted. A log that
// only ever credits outside reports implies nobody here is looking.
function reportedByLabel(by: Correction['reportedBy']): string {
  switch (by) {
    case 'the company':
      return 'Reported by the company'
    case 'a reader':
      return 'Reported by a reader'
    case 'us':
      return 'Found by us'
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 34 }}>
      <h2
        style={{
          margin: 0,
          fontFamily: font.display,
          fontSize: 21,
          fontWeight: 600,
          borderBottom: `2px solid ${colors.ink}`,
          paddingBottom: 8,
        }}
      >
        {title}
      </h2>
      <div style={{ marginTop: 13 }}>{children}</div>
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: '0 0 11px',
        fontSize: 14.5,
        lineHeight: 1.68,
        color: colors.ink2,
        maxWidth: '72ch',
      }}
    >
      {children}
    </p>
  )
}

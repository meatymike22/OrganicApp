import Link from 'next/link'
import { colors, font, layout } from '@/lib/design'
import { AisleBar, SiteFooter, TopNav } from '@/components/SiteChrome'

// CONTACT — the page three other pages have been promising.
//
// WHY IT EXISTS, and why it is a launch blocker rather than a nicety.
// `/disclaimer` tells a company whose record is wrong: "tell us and we will
// fix it. Send the page and what is wrong to our contact page." `/faq` says
// "ask us and we will add it." The home page links "Contact us". All three
// linked at a 404 for weeks, which means the site made a promise it had no
// way to keep — and it makes that promise specifically to the people most
// likely to be annoyed with it.
//
// That is a legal posture, not a UX gap. Rootify publishes state hazard
// classifications on 439 products and names real companies against real
// regulatory records. The project's own protective measures list "respond
// promptly to any disputes; correct if wrong, hold ground with sources if
// right" — and a dispute channel that 404s inverts that. A company with no
// route to a correction has only one other route, and it costs more.
//
// WHAT IS DELIBERATELY NOT HERE:
//
//   NO FORM. A form collects personal data, which needs /privacy written
//   first, and a backend to deliver the mail. A mailto needs neither and
//   works today. Upgrade later; do not block the dispute channel on it.
//
//   NO LINK TO /corrections. It does not exist yet, and linking it from here
//   would recreate the exact bug this page fixes. The practice is described
//   in prose instead. ADD THE LINK when that page is built.
//
//   NO DISCLAIMERS. Michael, repeatedly and most recently 2026-10-20: the
//   caveats live on /disclaimer and nowhere else. This page links there once
//   and otherwise says what to do.
//
//   NO RESPONSE-TIME PROMISE. "We reply within 24 hours" is a commitment a
//   one-person project cannot keep every week, and a missed promise to a
//   company in a dispute is worse than no promise. What is committed to here
//   is that every correction is read and answered — which is true, and is
//   the part that matters.

export const metadata = {
  title: 'Contact',
  description:
    'How to reach Rootify — including how to report something wrong about you or your company, and what happens when you do.',
}

const CORRECTIONS = 'corrections@rootify.app'
const GENERAL = 'hello@rootify.app'

export default function ContactPage() {
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
          Contact
        </h1>

        <p style={{ margin: '14px 0 0', fontSize: 15.5, lineHeight: 1.65, color: colors.ink2 }}>
          Rootify is a small, independent project. Mail here is read by a person, and every message
          about a factual error gets an answer.
        </p>

        <Section title="Something here is wrong about you or your company">
          <P>
            This is the one we most want to hear about, and it is the fastest way to get it fixed.
            Write to <Mail address={CORRECTIONS} /> and tell us three things:
          </P>
          <Numbered
            rows={[
              ['The page', 'Paste the URL. One page per message keeps it traceable.'],
              [
                'What is wrong',
                'Which line, and what it should say instead. "The ingredient list is out of date" is enough to start; "the ingredient list is from the 2023 packaging" is faster.',
              ],
              [
                'Where the right version is',
                'A link to your own published label, register entry or press release if you have one. Not required — we will go and check either way — but it removes a round trip.',
              ],
            ]}
          />
          <P>
            <strong style={{ color: colors.ink }}>What happens next.</strong> We go back to the
            record the page was built from. If we got it wrong, we correct it, note the date, and
            keep the correction visible rather than quietly editing the page. If the record itself
            is wrong at the source — a register entry, a recall notice — we will say so on the page
            and link what you have told us, because we can correct our reading of a public record
            but we cannot change the record.
          </P>
          <P>
            A correction to a factual record does not require a lawyer and will not get one.
          </P>
        </Section>

        <Section title="What writing to us will and will not do">
          <P>
            We correct errors. We do not remove accurate records. If a recall notice, a warning
            letter or a register entry genuinely names your company, it stays on the page with its
            source and its date — that is the whole point of the site, and taking it down on request
            would make every other page worth less.
          </P>
          <P>
            What we will always do is make sure the page says what the record says and no more: the
            right company, the right products, the right dates, and your side of it where you have
            given us one.
          </P>
        </Section>

        <Section title="Everything else">
          <P>
            Questions, corrections to our wording, a product or a company you think should be here,
            or anything you want to tell us: <Mail address={GENERAL} />.
          </P>
          <P>
            If it is a question about how the site works, how we decide what to publish, or where a
            particular fact came from, the{' '}
            <Link href="/faq" style={{ color: colors.link }}>
              FAQ
            </Link>{' '}
            probably answers it, and the{' '}
            <Link href="/sourcing" style={{ color: colors.link }}>
              sourcing page
            </Link>{' '}
            lists every source we use. If it does not, ask and we will add it.
          </P>
          <P>
            The limits of what any of this means — what we are not claiming, and why there are no
            scores — are on the{' '}
            <Link href="/disclaimer" style={{ color: colors.link }}>
              disclaimer page
            </Link>
            .
          </P>
        </Section>

        <Section title="Press and anything legal">
          <P>
            Use <Mail address={GENERAL} /> and say which it is in the subject line. We would rather
            answer a question early than read about it later.
          </P>
        </Section>

        <div style={{ height: 44 }} />
      </div>

      <SiteFooter />
    </>
  )
}

// An address, as a link and as readable text. NOT obfuscated: an address a
// person has to decode is an address a company in a hurry does not write to,
// and the spam saved is not worth the correction lost.
function Mail({ address }: { address: string }) {
  return (
    <a
      href={`mailto:${address}`}
      style={{ color: colors.link, fontWeight: 600, wordBreak: 'break-word' }}
    >
      {address}
    </a>
  )
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

// A numbered list rather than prose, because this one is a form someone is
// filling in from the top down and prose makes them re-read it to check they
// have everything.
function Numbered({ rows }: { rows: [string, string][] }) {
  return (
    <ol style={{ margin: '0 0 11px', padding: '0 0 0 20px', maxWidth: '72ch' }}>
      {rows.map(([label, detail]) => (
        <li key={label} style={{ margin: '0 0 9px', fontSize: 14.5, lineHeight: 1.68, color: colors.ink2 }}>
          <strong style={{ color: colors.ink }}>{label}.</strong> {detail}
        </li>
      ))}
    </ol>
  )
}

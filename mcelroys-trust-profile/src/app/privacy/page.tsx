import Link from 'next/link'
import { colors, font, layout } from '@/lib/design'
import { AisleBar, SiteFooter, TopNav } from '@/components/SiteChrome'

// PRIVACY — linked from the global footer (SiteChrome) and the home page, so
// it has been a 404 on every page of the site.
//
// EVERY CLAIM HERE WAS CHECKED IN THE CODE BEFORE IT WAS WRITTEN, because a
// privacy policy that overstates what a site does is a liability of its own
// and the easiest kind of false statement to make by accident. What was
// checked, on 2026-10-24:
//
//   package.json — dependencies are @prisma/adapter-pg, @prisma/client,
//   csv-parse, dotenv, next, react, react-dom, xlsx. NO @vercel/analytics,
//   no @vercel/speed-insights, no gtag, no posthog, no plausible. There is
//   no analytics package in the project at all.
//
//   grep for localStorage / sessionStorage / document.cookie across src/ —
//   one hit only: VisitTrail and BackFromUrl use sessionStorage for the
//   per-tab trail. NOTHING sets a cookie. There is no auth, so there is no
//   session cookie either.
//
//   layout.tsx — the three typefaces come through next/font/google, which
//   downloads them AT BUILD TIME and serves them from our own domain. The
//   visitor's browser makes no request to Google. This is worth stating
//   because "we use Google Fonts" would otherwise imply a data transfer
//   that does not happen.
//
//   next.config.ts — images go through the Next image optimiser with a
//   remotePatterns allowlist, so the browser requests /_next/image from
//   rootify.app. It never contacts Open Food Facts directly.
//
// IF ANY OF THAT CHANGES, THIS PAGE CHANGES IN THE SAME COMMIT. Adding an
// analytics package without editing this file turns an accurate page into a
// false one, which is worse than never having claimed anything.
//
// WHAT IS DELIBERATELY NOT HERE:
//
//   NO RETENTION PERIOD for server logs. We do not configure it — it is
//   Vercel's default — and inventing a number would be a commitment nothing
//   enforces.
//
//   NOTHING ABOUT ACCOUNTS, BILLING OR PHOTO CONTRIBUTION. None of it
//   exists. A policy describing practices a site does not have is false in
//   the direction that matters least to us and most to a reader. The page
//   says instead that it will be updated before any of that ships.
//
//   NO COMPLIANCE CLAIMS. "GDPR compliant" / "CCPA compliant" are legal
//   conclusions, not facts about the code, and this is a draft for the
//   budgeted legal review.

export const metadata = {
  title: 'Privacy',
  description:
    'What Rootify collects, what it deliberately does not, and what stays on your own device. No accounts, no cookies, no analytics.',
}

const LAST_UPDATED = '24 October 2026'

export default function PrivacyPage() {
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
          Privacy
        </h1>

        <p style={{ margin: '14px 0 0', fontSize: 15.5, lineHeight: 1.65, color: colors.ink2 }}>
          The short version: there are no accounts, the site sets no cookies, there is no analytics
          of any kind, and nothing here is sold or shared. You can read Rootify without telling us
          who you are, and we have built it so that you do not have to take our word for that.
        </p>

        <Section title="What the site collects from you">
          <P>
            <strong style={{ color: colors.ink }}>Directly, nothing.</strong> There is no sign-up,
            no login, no form, no newsletter box and no tracking. Nothing on any page asks for your
            name, your email or anything else.
          </P>
          <P>
            <strong style={{ color: colors.ink }}>Indirectly, server logs.</strong> Like any
            website, serving you a page means our host receives the request: your IP address, your
            browser&rsquo;s user-agent string, the page you asked for and the time you asked for
            it. That happens at the network level and is how the site works at all. We do not build
            profiles from it, and we do not configure how long our host keeps it — so rather than
            invent a retention period we do not control, we have said who the host is below.
          </P>
        </Section>

        <Section title="What stays on your device and never reaches us">
          <P>
            As you move between pages, the site remembers the trail of pages you have opened{' '}
            <em>in that tab</em> so it can show you a back link that goes where you actually came
            from. That trail is kept in your browser&rsquo;s <code style={code}>sessionStorage</code>.
          </P>
          <P>
            Three things about it worth knowing: it is per-tab, so a new tab starts empty; your
            browser erases it when you close the tab; and it is never transmitted anywhere, because
            nothing sends it. It was deliberately built on <code style={code}>sessionStorage</code>{' '}
            rather than <code style={code}>localStorage</code> precisely so that it does not
            outlive the session you are in.
          </P>
        </Section>

        <Section title="What we deliberately do not do">
          <Bullets
            rows={[
              [
                'No cookies',
                'The site sets none. There is no login, so there is no session cookie either, and no consent banner because there is nothing to consent to.',
              ],
              [
                'No analytics, no pixels, no advertising',
                'There is no analytics package in the project at all — not Google, not Vercel’s, not a self-hosted one. Nobody is counting you.',
              ],
              [
                'No third-party scripts',
                'Nothing on a Rootify page loads code from another company.',
              ],
              [
                'Fonts are served by us, not by Google',
                'The three typefaces are downloaded when the site is built and served from our own domain. Your browser never makes a request to Google to render this page.',
              ],
              [
                'Product photographs are proxied',
                'The photos come from Open Food Facts contributors, but your browser asks our domain for them and we fetch them. Your browser never contacts Open Food Facts.',
              ],
              [
                'Nothing is sold or shared',
                'There is no data business here, and no arrangement under which anyone else receives anything about you.',
              ],
            ]}
          />
        </Section>

        <Section title="If you email us">
          <P>
            Writing to us is the one place you hand over personal information, and only because you
            chose to: your email address, whatever you put in the message, and anything you attach.
            We keep it so we have a record of what was reported and what we did about it — which is
            the point of a{' '}
            <Link href="/corrections" style={{ color: colors.link }}>
              corrections log
            </Link>
            . We do not add you to anything, and there is nothing to be added to.
          </P>
        </Section>

        <Section title="Who else is involved">
          <P>
            Three companies are necessarily part of running this, and each sees only what its job
            requires:
          </P>
          <Bullets
            rows={[
              [
                'Vercel',
                'Hosts and serves the site. Receives the request logs described above, as part of delivering pages to you.',
              ],
              [
                'Supabase',
                'Hosts the product database — ingredients, recalls, registers, companies. It holds records about products, not about readers.',
              ],
              [
                'Google Workspace',
                'Carries our email. Relevant only if you write to us.',
              ],
            ]}
          />
        </Section>

        <Section title="What will change, and when">
          <P>
            Accounts, a paid tier and an in-app camera for contributing product photographs are all
            planned and none of them exist yet. When any of them ships it will involve information
            this page does not currently describe — an email address, a payment processor, a
            photograph and the barcode it was taken against.
          </P>
          <P>
            <strong style={{ color: colors.ink }}>
              This page will be rewritten before any of that is switched on, not after.
            </strong>{' '}
            Describing data practices we do not yet have would make this page inaccurate today in
            order to save editing it later, which is the wrong trade.
          </P>
        </Section>

        <Section title="Asking what we hold">
          <P>
            If you have emailed us and want to know what we still have, or want it deleted, write
            to{' '}
            <a href="mailto:hello@rootify.app" style={mail}>
              hello@rootify.app
            </a>{' '}
            and we will tell you and do it. For anything you have not sent us, the answer is that
            we do not have it — there is no account to look up.
          </P>
        </Section>

        <p
          style={{
            margin: '34px 0 0',
            fontSize: 13,
            color: colors.ink3,
            borderTop: `1px solid ${colors.line}`,
            paddingTop: 12,
          }}
        >
          Last updated {LAST_UPDATED}. The{' '}
          <Link href="/terms" style={{ color: colors.link }}>
            terms
          </Link>{' '}
          cover what you may do with what you find here, and the{' '}
          <Link href="/disclaimer" style={{ color: colors.link }}>
            disclaimer
          </Link>{' '}
          covers what the records do and do not mean.
        </p>

        <div style={{ height: 44 }} />
      </div>

      <SiteFooter />
    </>
  )
}

const code: React.CSSProperties = {
  fontFamily: font.mono,
  fontSize: 12.5,
  background: '#F1EDE2',
  padding: '1px 5px',
  borderRadius: 3,
}

const mail: React.CSSProperties = {
  color: colors.link,
  fontWeight: 600,
  wordBreak: 'break-word',
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

function Bullets({ rows }: { rows: [string, string][] }) {
  return (
    <ul style={{ margin: '0 0 11px', padding: '0 0 0 20px', maxWidth: '72ch' }}>
      {rows.map(([label, detail]) => (
        <li
          key={label}
          style={{ margin: '0 0 9px', fontSize: 14.5, lineHeight: 1.68, color: colors.ink2 }}
        >
          <strong style={{ color: colors.ink }}>{label}.</strong> {detail}
        </li>
      ))}
    </ul>
  )
}

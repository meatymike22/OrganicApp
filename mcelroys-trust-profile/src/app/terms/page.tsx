import Link from 'next/link'
import { colors, font, layout } from '@/lib/design'
import { AisleBar, SiteFooter, TopNav } from '@/components/SiteChrome'

// TERMS — linked from the global footer (SiteChrome) and the home page, so
// like /privacy it has been a 404 on every page of the site.
//
// THIS IS A DRAFT FOR THE BUDGETED LEGAL REVIEW, not a finished legal
// document, and the two gaps below are the reason it cannot be finished here.
//
//   1. THERE IS NO LEGAL ENTITY YET. The project plan is to form an LLC,
//      ideally in a state with strong anti-SLAPP protection. Until that
//      exists there is nobody for these terms to be an agreement WITH, and
//      the limitation-of-liability section is correspondingly weak — a
//      liability cap protects an entity, and there is none to protect.
//   2. THERE IS THEREFORE NO GOVERNING-LAW OR VENUE CLAUSE. Naming a state
//      before the entity is formed would be worse than naming none: if the
//      LLC is later formed elsewhere, a public document points at the wrong
//      forum. Both clauses go in together, once the entity exists. This is
//      deliberately NOT mentioned on the page — a public ToS announcing that
//      it has no governing law reads as an invitation.
//
// WHY /terms IS A HARD GATE ON THE CAMERA FEATURE. The in-app photo feature
// (committed 2026-10-23) depends on a licence grant from the contributor;
// without one we would be publishing photographs we have no right to publish,
// which is the exact failure the syndication research ruled out buying into.
// So the Contributions section below is written BEFORE the feature, on
// purpose, so no photograph is ever accepted under terms that did not yet
// mention it.
//
//   BUT A FOOTER-LINKED ToS IS NOT ENOUGH FOR THAT GRANT. "By using this site
//   you agree" is browsewrap, and it is thin support for an irrevocable
//   copyright licence in a photograph. When the camera feature is built it
//   must capture EXPLICIT, LOGGED acceptance at the point of contribution —
//   a checkbox with a timestamp and an account against it, not a link in the
//   footer. See the backlog. This section establishes the terms; the feature
//   has to establish the agreement.
//
// WHAT IS DELIBERATELY NOT HERE:
//
//   NO DUPLICATED CAVEATS. Michael, repeatedly: the substantive caveats live
//   on /disclaimer and nowhere else. The warranty disclaimer below is a legal
//   clause rather than UI copy, which is why it is the one exception — and it
//   links /disclaimer instead of restating it.
//
//   NO SOURCE LIST. /sourcing already lists every source and its terms, and
//   two lists drift. This page states the obligations that bind REUSE and
//   points there for the per-source detail.
//
//   NO ARBITRATION CLAUSE, no class-action waiver. Those are decisions with
//   real consequences for readers and they are not mine to make; they belong
//   in the legal review, with the entity.

export const metadata = {
  title: 'Terms',
  description:
    'What Rootify is, what you may do with what you find here, the licences the underlying records carry, and the limits of what any of it claims.',
}

const LAST_UPDATED = '24 October 2026'

export default function TermsPage() {
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
          Terms
        </h1>

        <p style={{ margin: '14px 0 0', fontSize: 15.5, lineHeight: 1.65, color: colors.ink2 }}>
          Rootify is an independent project that collects public records about food products and
          the companies that make them, and shows each one with a link to its source and the date
          it was read. Using the site means accepting what follows.
        </p>

        <Section title="What this site is, and what it is not">
          <P>
            Everything published here is a report of a record: an ingredient list transcribed from a
            package, a recall notice from a government agency, a certification register entry, a
            company filing. We try to say exactly what the record says and no more.
          </P>
          <P>
            It is <strong style={{ color: colors.ink }}>not</strong> a certification, a rating, a
            score, a safety assessment or medical advice, and nothing here should be read as a
            verdict about a company or a product. What the records do and do not mean is set out on
            the{' '}
            <Link href="/disclaimer" style={{ color: colors.link }}>
              disclaimer page
            </Link>
            , which is part of these terms.
          </P>
        </Section>

        <Section title="Using the site">
          <P>You may read, search, link to and quote anything here. Please do not:</P>
          <Bullets
            rows={[
              [
                'Overload it',
                'Automated bulk downloading at a rate that degrades the site for other people. If you want the data in bulk, write to us — most of it comes from public sources you can get directly, and we would rather point you at them than be scraped.',
              ],
              [
                'Present it as something it is not',
                'Do not describe Rootify as having certified, approved, rated or cleared any product or company. We do none of those things.',
              ],
              [
                'Strip the sourcing',
                'Every claim here is tied to a dated source. Republishing a claim without it turns a sourced record into an unsourced allegation, and the sourcing is the only thing that makes it safe to say.',
              ],
            ]}
          />
        </Section>

        <Section title="The records, and the licences they carry">
          <P>
            Rootify is built on other people&rsquo;s data, under licences that travel with it. If
            you reuse anything from this site, these obligations come with it — they are not ours
            to waive.
          </P>
          <P>
            <strong style={{ color: colors.ink }}>Product data from Open Food Facts</strong> is
            licensed under the{' '}
            <Ext href="https://opendatacommons.org/licenses/odbl/1-0/">
              Open Database License (ODbL) 1.0
            </Ext>
            , and the individual contents under the{' '}
            <Ext href="https://opendatacommons.org/licenses/dbcl/1-0/">
              Database Contents License (DbCL) 1.0
            </Ext>
            . In practice that means: you must credit Open Food Facts, you must keep any adapted
            database under the same licence, and if you distribute a version of the database you
            must offer it in an open format.
          </P>
          <P>
            <strong style={{ color: colors.ink }}>Product photographs from Open Food Facts</strong>{' '}
            are a different licence with a stronger obligation —{' '}
            <Ext href="https://creativecommons.org/licenses/by-sa/3.0/">
              Creative Commons Attribution-ShareAlike 3.0
            </Ext>
            . The credit travels with the image wherever the image goes: you must name Open Food
            Facts and its contributors as the author, name the licence, link to it, and release any
            adaptation of the photograph under the same terms. Each photograph on this site carries
            that credit, and a photograph we cannot credit is one we do not show.
          </P>
          <P>
            <strong style={{ color: colors.ink }}>Records from US federal agencies</strong> — the
            FDA, USDA, FSIS, CPSC, SEC and CBP among them — are works of the United States
            government and carry no copyright of their own. Other sources carry their own terms.
            The{' '}
            <Link href="/sourcing" style={{ color: colors.link }}>
              sourcing page
            </Link>{' '}
            lists every source we use.
          </P>
          <P>
            <strong style={{ color: colors.ink }}>Our own writing</strong> — the explanations,
            glossary entries and plain-English summaries — is ours. You may quote it with
            attribution.
          </P>
        </Section>

        <Section title="If you contribute a photograph">
          <P>
            We intend to let people photograph products in the app so that products without a
            picture can get one. That feature is not built yet, and this section is here first on
            purpose: no photograph should ever be accepted under terms that did not already cover
            it.
          </P>
          <P>
            If you submit a photograph, you keep ownership of it and you grant us a worldwide,
            royalty-free, irrevocable, sublicensable licence to store, display, crop, resize and
            publish it as part of Rootify. We do not ask you to sign your copyright over.
          </P>
          <P>By submitting one, you confirm that:</P>
          <Bullets
            rows={[
              [
                'It is yours',
                'You took it. Not a photograph from a retailer’s website, a brand’s marketing material, another app, or anywhere else.',
              ],
              [
                'It shows a product, not a person',
                'No identifiable people in the frame, including you.',
              ],
              [
                'It is the product it says it is',
                'The photograph matches the barcode it was taken against. A picture on the wrong product page is a factual error, which is the one thing this site cannot afford.',
              ],
            ]}
          />
          <P>
            One practical note: some shops do not allow photography on their premises. Whether you
            may take a photograph where you are standing is between you and the shop, and it is
            your call to make — we are asking for photographs, not telling you where to take them.
          </P>
          <P>
            We may decline or remove any submission, and we may stop showing one at any time
            without explanation.
          </P>
        </Section>

        <Section title="Corrections, and what we will not remove">
          <P>
            If something here is wrong about you or your company, tell us and we will fix it. The{' '}
            <Link href="/contact" style={{ color: colors.link }}>
              contact page
            </Link>{' '}
            says what to send, and every correction is listed, dated, with the old wording, in the{' '}
            <Link href="/corrections" style={{ color: colors.link }}>
              corrections log
            </Link>
            .
          </P>
          <P>
            We correct errors. We do not remove accurate records. If a recall notice, a warning
            letter or a register entry genuinely names a company, it stays on the page with its
            source and its date — that is what the site is for, and removing accurate records on
            request would make every other page worth less.
          </P>
          <P>
            We can correct our reading of a public record. We cannot change the record. Where a
            source is itself wrong, the fix has to happen at the source; what we will do is say so
            on the page.
          </P>
        </Section>

        <Section title="No warranty">
          <P>
            The site is provided as it is, without warranties of any kind, express or implied,
            including any implied warranty of merchantability, fitness for a particular purpose or
            non-infringement.
          </P>
          <P>
            Specifically, and not as boilerplate: public records contain errors, registers go out
            of date, packaging changes without notice, and a record about a company is not a record
            about every product it makes. We date everything so you can see how old it is, and we
            say when we have not checked something rather than implying we have. But we do not
            warrant that any particular record is current, complete or correct, and{' '}
            <strong style={{ color: colors.ink }}>
              you should not rely on this site for a decision where being wrong would matter
            </strong>{' '}
            — an allergy, a medical condition, a purchase of consequence. Read the label, and ask
            the maker.
          </P>
        </Section>

        <Section title="Limits on liability">
          <P>
            To the fullest extent the law allows, we are not liable for any indirect, incidental,
            special or consequential loss arising from your use of this site or from anything you
            relied on here, including lost profits or lost data.
          </P>
          <P>
            Nothing in these terms limits any liability that cannot lawfully be limited.
          </P>
        </Section>

        <Section title="Changes to these terms">
          <P>
            We will change these terms as the site grows — accounts, a paid tier and the photograph
            feature all sit ahead of us, and each will need terms this version does not have. When
            we change something that affects what you may do or what we may do with what you give
            us, we will change the date below, and we will not apply a new term retroactively to
            something you contributed under an older one.
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
          Last updated {LAST_UPDATED}. See also{' '}
          <Link href="/privacy" style={{ color: colors.link }}>
            privacy
          </Link>
          ,{' '}
          <Link href="/disclaimer" style={{ color: colors.link }}>
            the disclaimer
          </Link>{' '}
          and{' '}
          <Link href="/sourcing" style={{ color: colors.link }}>
            where every fact comes from
          </Link>
          . Questions about any of this:{' '}
          <a href="mailto:hello@rootify.app" style={mail}>
            hello@rootify.app
          </a>
          .
        </p>

        <div style={{ height: 44 }} />
      </div>

      <SiteFooter />
    </>
  )
}

const mail: React.CSSProperties = {
  color: colors.link,
  fontWeight: 600,
  wordBreak: 'break-word',
}

// External links get rel="noopener" and are not nofollowed: these point at
// the canonical licence deeds, and CC BY-SA asks us to link the licence.
function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: colors.link }}>
      {children}
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

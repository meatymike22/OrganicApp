import Link from 'next/link'
import { colors, font, layout } from '@/lib/design'
import { AisleBar, SiteFooter, TopNav } from '@/components/SiteChrome'

// DISCLAIMER — the one place the caveats live.
//
// WHY IT EXISTS. Michael, 2026-10-08, twice in one review round:
//   "we dont need to disclaim on the actual website. we will have a separate
//    page for disclaimers. please take all disclaimers out everywhere that
//    isnt the specific disclaimer page"
//   "remove this. all disclaimers go to the disclaimer page, not included in
//    the browsing experience"
//
// He is right about the reading experience. Product pages had accumulated a
// caveat under almost every section — "not a finding either way", "not a
// ranking of which products are better", "a shorter list is not
// automatically better" — each one defensible on its own and collectively a
// page that argues with itself before the reader has read anything.
//
// WHAT MOVED HERE, and what did not. The distinction I held to while
// sweeping, because collapsing it would break the project's spine:
//
//   A CAVEAT says what a fact does not mean. "This is not a verdict."
//   Those moved here, all of them.
//
//   A RECORD says what we hold and what we do not. "We hold no study on this
//   ingredient." That is one of the three states — confirmed, nothing on
//   file, could not check — and deleting it does not remove a disclaimer, it
//   converts a gap in our data into a claim about food. Those stayed on the
//   page, shortened.
//
// Two lines are kept on their own pages for a stronger reason than style,
// and both are flagged in the round-15 log: the recall page's "products may
// still have been affected", and the product page's "these name this company
// or its parent, not this product". Remove either and the page states
// something false about a named company. That is not a caveat about our
// opinion; it is which fact is on screen.
//
// The Open Food Facts attribution in the footer is also not a disclaimer. It
// is a licence condition (ODbL for the data, CC-BY-SA for the photographs)
// and it has to travel with the thing it credits, so it cannot be relocated
// to a page. See the note in SiteChrome.tsx.

export const metadata = {
  title: 'Disclaimer',
  description:
    'What Rootify is, what it is not, and the limits of every record on it — including why we publish no scores and no verdicts.',
}

export default function DisclaimerPage() {
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
          Disclaimer
        </h1>

        <p style={{ margin: '14px 0 0', fontSize: 15.5, lineHeight: 1.65, color: colors.ink2 }}>
          Rootify reports public records about food companies and the things they sell. Every line on
          a product page is something a government register, a recall notice, a regulator or a
          package label says, shown with the date we read it. This page collects the limits of that,
          so the rest of the site can show you the records instead of arguing about them.
        </p>

        <Section title="We publish no scores, grades or rankings">
          <P>
            There is no trust score, no letter grade, no traffic light and no number summarising a
            product or a company. This is deliberate and it is not going to change. A score is a
            verdict, a verdict is an opinion, and an opinion about a named company is the one thing
            we are not in a position to defend. Facts with dates and sources are.
          </P>
          <P>
            Where the site shows an order, the order says what is most worth reading about first —
            recalls before open research, open research before records we have not been able to
            check. It is not a judgement about which product is better. Where the site shows a
            percentage of shared ingredients between two products, that is a measure of how much
            two labels coincide, nothing more. A shorter ingredient list is not automatically a
            better one.
          </P>
        </Section>

        <Section title="Three states, and the difference between them">
          <P>
            Every check on this site reports one of three things, and they are not
            interchangeable:
          </P>
          <Three
            rows={[
              ['Confirmed', 'A named source says so, and we link it with the date we read it.'],
              [
                'Nothing on file',
                'We looked and the record does not exist, or we do not hold it. This is a statement about a register or about our database — never a statement about the food.',
              ],
              [
                'Not checked',
                'Nobody has looked yet. A gap in our work, reported as a gap rather than hidden behind a reassuring colour.',
              ],
            ]}
          />
          <P>
            The second and third are the ones that matter here.{' '}
            <strong style={{ color: colors.ink }}>
              &ldquo;Not in the organic register&rdquo; is a fact about a register.
              &ldquo;Not organic&rdquo; is a claim about how food was grown, and we do not make it.
            </strong>{' '}
            The same applies everywhere: no recall on file does not mean a product is safe, no study
            on file does not mean an ingredient has been cleared, and an empty section means we hold
            nothing — not that there is nothing.
          </P>
        </Section>

        <Section title="The research flag is a to-do list">
          <P>
            Some ingredients are marked as worth looking into. That mark is set by a classification
            rule — the ingredient is an additive or a processing ingredient rather than a whole food
            — and not by anybody reading a study. It is not a finding that an ingredient is harmful,
            and most flagged ingredients have no research on file at all. Where we do hold research,
            the ingredient page shows it and cites it.
          </P>
          <P>
            An authority classification and a scientific study are also different grades of
            evidence, and we never merge them.{' '}
            <Link href="/sourcing" style={{ color: colors.link }}>
              How we source
            </Link>{' '}
            sets out which is which.
          </P>
        </Section>

        <Section title="Allergens: read the package">
          <P>
            The allergen filter is derived from the ingredient list we hold. It is not the
            label&rsquo;s own &ldquo;Contains&rdquo; statement, which is the authoritative one and
            which we do not yet store. It cannot see &ldquo;may contain traces of&rdquo; warnings,
            and it cannot see inside a blend such as &ldquo;natural flavor&rdquo;.
          </P>
          <P>
            <strong style={{ color: colors.ink }}>
              If you are avoiding an allergen because it can hurt you, read the package.
            </strong>{' '}
            Do not rely on this filter, or on any filter.
          </P>
        </Section>

        <Section title="Not health advice, and not a substitute for a label">
          <P>
            Nothing here is medical, nutritional or dietary advice, and nothing here is a
            recommendation to buy or avoid anything. We are not a laboratory: we have tested no
            product and analysed no sample. Everything on the site is a record somebody else
            published, quoted and dated.
          </P>
          <P>
            Recipes and formulations change, and a record we read last month may describe a package
            that has since been reformulated. The date beside every line is there so you can judge
            how current it is.
          </P>
        </Section>

        <Section title="Where our data comes from, and where it is wrong">
          <P>
            Product and ingredient data comes largely from Open Food Facts, a public database built
            by contributors who transcribe labels. Certification data comes from the USDA Organic
            Integrity Database, which registers certified <em>operations</em> — companies — and not
            individual products. Recall notices come from the agencies that issued them. The
            attribution for each is in the footer and on each product&rsquo;s sources page.
          </P>
          <P>
            Some of it is wrong. Transcriptions contain errors, the same product sometimes appears
            twice, and company records are matched to brands by name, which occasionally matches the
            wrong company. When we find an error we correct it and keep the correction visible.
          </P>
          <P>
            <strong style={{ color: colors.ink }}>
              If something on this site is wrong about you or your company, tell us and we will fix
              it.
            </strong>{' '}
            Send the page and what is wrong to{' '}
            <Link href="/contact" style={{ color: colors.link }}>
              our contact page
            </Link>
            . A correction to a factual record does not require a lawyer and will not get one.
          </P>
        </Section>

        <Section title="Companies named on this site">
          <P>
            Rootify names real companies and quotes real regulatory records about them. Those
            records are public and we link them. We do not characterise a company&rsquo;s motives,
            describe anyone as dishonest or negligent, or draw conclusions about a business from the
            records we hold about it. Where a record is disputed, we will say that it is disputed
            and link what the company said.
          </P>
          <P>
            Company and brand names appear here to identify the products and records they belong to.
            No company named on Rootify endorses it or is affiliated with it, and brands cannot pay
            to appear, to be removed, or to be presented differently.
          </P>
        </Section>

        <div style={{ height: 44 }} />
      </div>

      <SiteFooter />
    </>
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

// The three states as a labelled list rather than prose, because the whole
// point is that they are distinguishable at a glance.
function Three({ rows }: { rows: [string, string][] }) {
  return (
    <dl style={{ margin: '0 0 13px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      {rows.map(([term, meaning]) => (
        <div
          key={term}
          style={{
            boxSizing: 'border-box',
            padding: '11px 14px',
            background: colors.panel,
            border: `1px solid ${colors.line}`,
            borderRadius: 7,
          }}
        >
          <dt style={{ fontSize: 13.5, fontWeight: 700, color: colors.ink }}>{term}</dt>
          <dd style={{ margin: '3px 0 0', fontSize: 13.5, lineHeight: 1.6, color: colors.ink2 }}>
            {meaning}
          </dd>
        </div>
      ))}
    </dl>
  )
}

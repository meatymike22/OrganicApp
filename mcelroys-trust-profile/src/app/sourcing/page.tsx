import Link from 'next/link'
import { colors, font, layout, status, type StatusKey } from '@/lib/design'
import { AUTHORITIES, type AuthorityKey } from '@/lib/authorities'
import { AisleBar, Breadcrumb, SiteFooter, TopNav } from '@/components/SiteChrome'
import { Collapsible } from '@/components/Collapsible'
import { StatusChip } from '@/components/StatusChip'

// HOW WE SOURCE — the documentation page.
//
// WHY IT EXISTS NOW. Michael, 2026-10-07, asking for the authority
// classifications: "in some documentation on the website or even on a
// clickable link next to the sources, in the documentation we disclaim that
// these aren't studies but are authority classifications... The user doesn't
// care about all of these words, but if they want to use their discretion
// more they can visit the sources / documentation page."
//
// That is exactly the right division of labour, and it is also what this page
// was always for. /sourcing has been linked from the footer of every page
// since the site was built and has been a 404 the whole time.
//
// IT ALSO INHERITED A PARAGRAPH. The method text removed from the search
// start screen in round 8 — "every line is a public record, shown with the
// date we read it; where there is no record it says so; where we could not
// look it says that instead" — belongs here, and opens the page.
//
// THE JOB OF THIS PAGE: make the grades of evidence legible. A product page
// says "Prop 65 — cancer" in four words because four words is all a shopper
// will read. This is where those four words are unpacked, and every authority
// row on every ingredient page links here. If a reader ever cannot tell
// whether a line is an authority's conclusion, one paper's finding, or a
// claim printed on a packet, this page has failed.

export const metadata = {
  title: 'How we source',
  description:
    'Where every line on Rootify comes from, and the difference between an authority classification, a scientific study, and a claim printed on a package.',
}

// THE THREE GRADES, strongest first. This ordering is the argument: a reader
// who takes nothing else away should take away that these are not equivalent.
const GRADES: {
  key: string
  name: string
  state: keyof typeof status
  chip: string
  whatItIs: string
  whatItIsNot: string
  example: string
}[] = [
  {
    key: 'authority',
    name: 'An authority classification',
    state: 'openResearch',
    chip: 'Authority',
    whatItIs:
      'A government or international body reviewed the published evidence on a substance and placed it in one of its own categories, or set a limit it considers safe. The body publishes the category; we copy it across with the date and a link, and translate the category into one plain sentence.',
    whatItIsNot:
      'It is not a finding about any product, and not a measurement of risk at the amounts in food. A category describes how strong a body judged the evidence to be. Two substances in the same category can carry wildly different real-world exposure.',
    example:
      'IARC places a substance in Group 2B. That means its working group found the evidence of cancer risk limited but not negligible — often from animal studies alone. It does not mean a product containing it will harm you.',
  },
  {
    key: 'study',
    name: 'A scientific study',
    state: 'recall',
    chip: 'Study',
    whatItIs:
      'One piece of published research, read and summarised by a person, recorded with its citation, what it found, what kind of study it was, and who paid for it. Funding is recorded as its own field because a conclusion cannot be weighed without it.',
    whatItIsNot:
      'It is not a consensus. A single study is the weakest kind of evidence on this site precisely because it is the most specific — and where studies disagree, we record the disagreement rather than picking a winner.',
    example:
      'A 2019 paper reports an effect in rats at a stated dose. We say so, say who funded it, and link it. We do not conclude anything from it on your behalf.',
  },
  {
    key: 'label',
    name: 'A claim on the package',
    state: 'nothingOnFile',
    chip: 'Label claim',
    whatItIs:
      'Words printed on the packaging — "organic", "non-GMO", "no artificial colors" — as transcribed by a contributor to Open Food Facts. It tells you what the manufacturer chose to put on the box.',
    whatItIsNot:
      'It is not a certification and nobody audited it. Some of these claims sit behind a real third-party programme and some are unregulated marketing. Where we can tell the difference, we say which.',
    example:
      'A packet says "organic". That is a claim. The USDA Organic Integrity Database separately certifies operations — not products — and where we hold such a record we show it as its own, stronger line.',
  },
]

// THE GLOSSARY ENTRIES. One per answer the signal table can print.
//
// Each has a "does not mean" line, and writing them was the useful part: an
// answer whose over-reading you cannot name is an answer that should not be
// on a product page.
const GLOSSARY: {
  question: string
  answer: string
  state: StatusKey
  means: string
  notMeans: string
}[] = [
  {
    question: 'Certified organic',
    answer: 'Maker certified',
    state: 'confirmed',
    means:
      'The company that makes this product appears in the USDA Organic Integrity Database as a certified organic operation, and we hold the certificate record and the date we read it.',
    notMeans:
      'That this item is certified organic. The register certifies operations — farms, handlers, processors — not individual retail products, and a certified handler can also make products that are not organic.',
  },
  {
    question: 'Certified organic',
    answer: 'Not certified',
    state: 'nothingOnFile',
    means:
      'We searched the USDA Organic Integrity Database and found nothing for this product or its maker. US organic certification exists only by being in that register, so this is a definite answer: it is not certified organic.',
    notMeans:
      'That the food is not organically grown, or that anything is wrong with it. A small farm selling unsprayed produce without paying for certification gets this same answer.',
  },
  {
    question: 'Non-GMO verified',
    answer: 'Not verified',
    state: 'nothingOnFile',
    means:
      'No verification programme we check lists this product. Verification is something a maker applies and pays for, so an absence is the complete answer to whether it has been verified.',
    notMeans:
      'That the product contains genetically modified ingredients. Most food has never been submitted for verification either way.',
  },
  {
    question: 'Recalls',
    answer: 'No recalls',
    state: 'nothingOnFile',
    means:
      'No government notice in the records we hold — FDA, FSIS, CPSC and CBP — lists this product\u2019s barcode.',
    notMeans:
      'That the product has never been recalled. We hold what those four agencies publish, going back as far as each one publishes, and a notice that never named a barcode cannot be matched to a product at all.',
  },
  {
    question: 'Open research',
    answer: 'None flagged',
    state: 'confirmed',
    means:
      'No ingredient on this label is one our classifier marks as an additive or processing ingredient.',
    notMeans:
      'That the ingredients are all safe, or that we have researched them. It is a statement about what kind of ingredients they are.',
  },
  {
    question: 'Any question',
    answer: 'Not checked',
    state: 'unchecked',
    means:
      'We have not been able to look. Usually the brand has not been confirmed as a company yet, and every register we use is searched by company name.',
    notMeans:
      'Anything at all about the product. This is the one answer that is purely about us, and it is kept separate from \u201cnot certified\u201d for exactly that reason.',
  },
  {
    question: 'Any question',
    answer: "Doesn't apply",
    state: 'notApplicable',
    means:
      'The question cannot sensibly be asked of this kind of product — organic certification of a baby bottle, for instance.',
    notMeans: 'That we skipped it.',
  },
]

const AUTHORITY_ORDER: AuthorityKey[] = [
  'iarc',
  'oehha_prop65',
  'efsa',
  'jecfa',
  'fda',
  'health_canada',
  'anses',
  'echa',
  'ineris',
]

export default function SourcingPage() {
  return (
    <>
      <TopNav />
      <AisleBar />
      <Breadcrumb trail={[{ label: 'Rootify', href: '/' }, { label: 'How we source' }]} />

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
          How we source
        </h1>

        {/* The paragraph that used to sit on the search start screen. It is
            the three-state rule in plain English and it is the whole argument
            for why this site is not a rating app. */}
        <p style={{ margin: '14px 0 0', fontSize: 16, lineHeight: 1.65, color: colors.ink2, maxWidth: '62ch' }}>
          Every line on a product page is a public record, shown with the date we read it. Where
          there is no record, it says so. Where we have not been able to look, it says that
          instead — <strong style={{ color: colors.ink }}>those are different things</strong>, and
          keeping them apart is the point of the whole site.
        </p>

        <p style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.65, color: colors.ink2, maxWidth: '62ch' }}>
          We do not score products. There is no number, no grade and no verdict anywhere on
          Rootify, because a score is our opinion wearing the clothes of a measurement. What there
          is instead: the record, who published it, and when we read it.
        </p>

        {/* --- THE THREE GRADES --- */}
        <h2
          style={{
            margin: '38px 0 0',
            fontFamily: font.display,
            fontSize: 23,
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}
        >
          Three different kinds of evidence
        </h2>
        <p style={{ margin: '10px 0 0', fontSize: 14.5, lineHeight: 1.6, color: colors.ink2, maxWidth: '62ch' }}>
          A product page is short on purpose. These are the three things those short lines can be,
          and they do not carry the same weight.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
          {GRADES.map((g) => (
            <section
              key={g.key}
              id={g.key}
              style={{
                boxSizing: 'border-box',
                padding: '16px 18px',
                background: colors.card,
                border: `1px solid ${colors.line}`,
                borderLeft: `4px solid ${status[g.state].fg}`,
                borderRadius: layout.radius,
                scrollMarginTop: 18,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <h3
                  style={{
                    margin: 0,
                    fontFamily: font.display,
                    fontSize: 18.5,
                    fontWeight: 600,
                  }}
                >
                  {g.name}
                </h3>
                <StatusChip state={g.state}>{g.chip}</StatusChip>
              </div>

              <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, color: colors.ink2 }}>{g.whatItIs}</p>

              {/* The "is not" line carries more weight than the "is" line.
                  Every over-claim this site has had to fix was somebody
                  reading one grade as another. */}
              <p
                style={{
                  margin: '10px 0 0',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  background: colors.panel,
                  borderRadius: 6,
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  color: colors.ink2,
                }}
              >
                <strong style={{ color: colors.ink }}>What it is not: </strong>
                {g.whatItIsNot}
              </p>

              <p style={{ margin: '9px 0 0', fontSize: 13, lineHeight: 1.6, color: colors.ink3 }}>
                <strong style={{ color: colors.ink2 }}>For example: </strong>
                {g.example}
              </p>
            </section>
          ))}
        </div>

        {/* --- THE AUTHORITIES --- */}
        <h2
          id="authorities"
          style={{
            margin: '40px 0 0',
            fontFamily: font.display,
            fontSize: 23,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            scrollMarginTop: 18,
          }}
        >
          The authorities we read
        </h2>
        <p style={{ margin: '10px 0 0', fontSize: 14.5, lineHeight: 1.6, color: colors.ink2, maxWidth: '62ch' }}>
          Nine bodies, each with its own remit and its own categories. Knowing what kind of body
          published a classification is most of what tells you how to weigh it, so each one gets a
          sentence. Every entry links to where that body publishes its own assessments, so nothing
          here has to be taken on our word.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
          {AUTHORITY_ORDER.map((key) => {
            const a = AUTHORITIES[key]
            return (
              <Collapsible key={a.key} id={`authority-${a.key}`} title={a.name} note={a.short}>
                <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: 1.6, color: colors.ink2 }}>{a.what}</p>
                <p style={{ margin: '10px 0 0', fontSize: 13 }}>
                  <a href={a.homeUrl} target="_blank" rel="noopener noreferrer">
                    Where {a.short} publishes its assessments &rarr;
                  </a>
                </p>
              </Collapsible>
            )
          })}
        </div>

        {/* --- THE GLOSSARY ---
            Michael, 2026-10-07, on the product page's signal table: "this is
            too much. the description text here can go into a document that
            includes a glossary of terms, perhaps, but this description causes
            too much clutter. Add it to anotehr page that is used for users to
            understand more about what we are doing."

            So the long form of every answer the table can print lives here,
            and the table prints one line and links to this anchor. Keeping
            both in one place also stops them drifting: the table used to
            carry a paragraph per row that only I ever read. */}
        <h2
          id="glossary"
          style={{
            margin: '40px 0 0',
            fontFamily: font.display,
            fontSize: 23,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            scrollMarginTop: 16,
          }}
        >
          What each answer means
        </h2>
        <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.65, color: colors.ink2, maxWidth: '62ch' }}>
          Every product page opens with a table of the same six questions. These are the answers it
          can give, and exactly how much each one claims.
        </p>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {GLOSSARY.map((g) => (
            <div
              key={g.answer}
              style={{
                boxSizing: 'border-box',
                padding: '13px 15px',
                background: colors.card,
                border: `1px solid ${colors.line}`,
                borderLeft: `4px solid ${status[g.state].fg}`,
                borderRadius: layout.radius,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <StatusChip state={g.state}>{g.answer}</StatusChip>
                <span style={{ fontSize: 12, color: colors.ink3 }}>{g.question}</span>
              </div>
              <p style={{ margin: '9px 0 0', fontSize: 13.5, lineHeight: 1.6, color: colors.ink2 }}>
                {g.means}
              </p>
              {/* The sentence that stops each answer being read as more than
                  it is. Every glossary entry has one; that is the point of
                  the glossary. */}
              <p style={{ margin: '7px 0 0', fontSize: 12.5, lineHeight: 1.55, color: colors.ink3 }}>
                <strong style={{ color: colors.ink2 }}>It does not mean: </strong>
                {g.notMeans}
              </p>
            </div>
          ))}
        </div>

        {/* --- HOW WE WORD A RECALL ---
            Linked from /recalls/[id], which says "the line before it is our
            plain-English summary — how we word these". That link has to land
            on something, and the rule is worth stating in public anyway: it
            is the only place on the site where we paraphrase an agency. */}
        <h2
          id="recall-wording"
          style={{
            margin: '40px 0 0',
            fontFamily: font.display,
            fontSize: 23,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            scrollMarginTop: 16,
          }}
        >
          How we word a recall
        </h2>
        <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.65, color: colors.ink2, maxWidth: '62ch' }}>
          A recall notice is written for regulators. &ldquo;Product may be contaminated with
          Listeria monocytogenes&rdquo; is precise and most people should not have to decode it. So
          a recall card leads with one plain sentence of ours &mdash; &ldquo;May contain listeria, a
          germ that can cause serious illness&rdquo; &mdash; and three rules govern it:
        </p>
        <ul
          style={{
            margin: '12px 0 0',
            paddingLeft: 20,
            fontSize: 14,
            lineHeight: 1.7,
            color: colors.ink2,
            maxWidth: '62ch',
          }}
        >
          <li>
            <strong style={{ color: colors.ink }}>
              The agency&rsquo;s own sentence is always still there.
            </strong>{' '}
            Our summary is shown beside it, never instead of it. You can check the paraphrase
            against the original without leaving the page, which is the only thing that makes
            paraphrasing defensible.
          </li>
          <li>
            <strong style={{ color: colors.ink }}>It restates, it never adds or softens.</strong>{' '}
            &ldquo;May contain&rdquo; stays &ldquo;may contain&rdquo;. We do not say a product is
            dangerous, do not say anyone was harmed, and do not reassure.
          </li>
          <li>
            <strong style={{ color: colors.ink }}>
              A notice we cannot summarise safely is printed as written.
            </strong>{' '}
            About one in ten. A borrowed summary that happens to be wrong is far worse than a
            technical sentence, so where the wording is unusual we leave it alone.
          </li>
        </ul>
        <p style={{ margin: '11px 0 0', fontSize: 13, lineHeight: 1.6, color: colors.ink3, maxWidth: '62ch' }}>
          These summaries are written by a rule, not drafted by a language model, so every sentence
          the site can produce is fixed in advance and reviewable in one place rather than one
          notice at a time.
        </p>

        {/* --- KNOWN GAPS ---
            Referenced by the ingredient-filter explainers on /search, which
            name the two biggest misses directly. A page about how we source
            that does not admit what we are missing is marketing. */}
        <h2
          id="gaps"
          style={{
            margin: '40px 0 0',
            fontFamily: font.display,
            fontSize: 23,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            scrollMarginTop: 16,
          }}
        >
          What we know we are missing
        </h2>
        <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.65, color: colors.ink2, maxWidth: '62ch' }}>
          Measured against our own database on 7 October 2026. These are gaps we have found and not
          yet closed, listed because a filter that quietly under-reports is worse than no filter.
        </p>
        <ul
          style={{
            margin: '12px 0 0',
            paddingLeft: 20,
            fontSize: 14,
            lineHeight: 1.7,
            color: colors.ink2,
            maxWidth: '62ch',
          }}
        >
          <li>
            <strong style={{ color: colors.ink }}>
              Some common additives are not categorised yet, so the ingredient filters miss them.
            </strong>{' '}
            The clearest cases: soy lecithin (on about 31,000 products), xanthan gum (22,000) and
            guar gum (15,000) are not caught by &ldquo;no emulsifiers&rdquo;; &ldquo;spices&rdquo;
            (36,000) is not caught by &ldquo;no undisclosed flavoring&rdquo;; caramel color
            (13,500) is not caught by &ldquo;no artificial dyes&rdquo;; and plain
            &ldquo;vegetable oil&rdquo; (16,000) is not caught by &ldquo;no seed oils&rdquo;. If you
            are filtering on one of those, read the ingredient list as well.
          </li>
          <li>
            <strong style={{ color: colors.ink }}>Our study corpus is small.</strong> Twenty studies
            across sixteen ingredients. Authority classifications, described above, are how that
            widens — but an ingredient with no classification and no study has simply not been
            researched by us, which the ingredient page says in those words.
          </li>
          <li>
            <strong style={{ color: colors.ink }}>
              The organic register certifies operations, not products.
            </strong>{' '}
            A positive organic row means the maker holds a certificate, which is not the same as
            this item being certified. We say &ldquo;maker certified&rdquo; rather than
            &ldquo;organic&rdquo; for that reason.
          </li>
        </ul>

        {/* --- WHAT WE DO NOT DO --- */}
        <h2
          style={{
            margin: '40px 0 0',
            fontFamily: font.display,
            fontSize: 23,
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}
        >
          What we will not do
        </h2>
        <ul
          style={{
            margin: '12px 0 0',
            paddingLeft: 20,
            fontSize: 14.5,
            lineHeight: 1.7,
            color: colors.ink2,
            maxWidth: '62ch',
          }}
        >
          <li>
            <strong style={{ color: colors.ink }}>Score a product.</strong> No grade, no number, no
            traffic light. Colours on this site say what kind of record exists, never whether
            something is good.
          </li>
          <li>
            <strong style={{ color: colors.ink }}>Treat an absence as a finding.</strong> &ldquo;Not on
            file&rdquo; means we looked and found no record. It is not a clean bill of health, and
            nothing on this site is ever green for an absence.
          </li>
          <li>
            <strong style={{ color: colors.ink }}>Blur a gap into a claim.</strong> If we have not
            checked something, the page says we have not checked, not that there is nothing there.
          </li>
          <li>
            <strong style={{ color: colors.ink }}>Draw the conclusion for you.</strong> Where
            authorities disagree — and they do — we show the disagreement rather than averaging it
            into a single answer.
          </li>
        </ul>

        <p style={{ margin: '28px 0 0', fontSize: 13.5, lineHeight: 1.65, color: colors.ink3, maxWidth: '62ch' }}>
          If a record here is wrong, or has changed since we read it, we would rather hear it than
          not — see <Link href="/corrections">corrections</Link>. Every product also has its own
          page listing each source behind it with the date, reachable from the bottom of any
          product page.
        </p>
      </div>

      <SiteFooter />
    </>
  )
}

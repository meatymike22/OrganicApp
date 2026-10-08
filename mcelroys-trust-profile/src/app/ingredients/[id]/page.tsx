import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { colors, font, layout, status } from '@/lib/design'
import { AisleBar, Breadcrumb, SignalTile, SiteFooter, TopNav } from '@/components/SiteChrome'
import { StatusChip } from '@/components/StatusChip'
// The shared one. This file used to carry its own copy, which drifted: when
// the "not yet checked by a person" line was removed from PageParts it
// stayed here, so the ingredient page kept advertising a review process the
// rest of the site had stopped claiming. One implementation, one wording.
import { Callout, Paragraphs, SectionHead, SourceLine, Tag } from '@/components/PageParts'
// SectionHead, Callout and Tag were local copies here too, and the header
// comment above said they should go the same way. They have.
import { MiniCollapse } from '@/components/Collapsible'
// Where a 1,500-character research record becomes a headline and four rows
// a reader can open. Nothing in it rewrites the stored text.
import {
  clipParagraph,
  framingLead,
  FUNDING_LABEL,
  POSITION_LABEL,
  STUDY_TYPE_LABEL,
  studyOutline,
} from '@/lib/studyOutline'
// Authority classifications are a THIRD kind of record, beside studies and
// country rules: a published decision by a named body, in that body's own
// words. The module holds the plain-English translation of each category and
// nothing else — no judgement of our own. /sourcing explains the distinction.
import { assessmentWeight, authority, classificationMeaning } from '@/lib/authorities'

// ONE INGREDIENT: the studies on file about it, how each country regulates
// it, and which products list it.
//
// Product pages link here from every ingredient on a label. Most ingredients
// (oats, salt, water) have no studies — research is kept for additives and
// processing ingredients (Ingredient.flaggedForResearch) — so this page has
// to read sensibly both with a full research record and with none.
//
// Styling follows the product page exactly: same nav, header, signal tiles,
// section heads and source lines. SourceLine is now IMPORTED from PageParts
// rather than copied here — the copy drifted, which is what copies do: the
// "not yet checked by a person" line was removed from the shared component
// and lived on in this file. SectionHead and Callout below are still local
// copies and should go the same way.


export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ingredient = await prisma.ingredient.findUnique({ where: { id }, select: { name: true } })
  if (!ingredient) return { title: 'Ingredient not found' }
  return { title: capitalize(ingredient.name) }
}

export default async function IngredientPage({ params }: { params: Promise<{ id: string }> }) {
  // In Next.js 15+ the dynamic part of the URL arrives as a Promise.
  const { id } = await params

  const ingredient = await prisma.ingredient.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      category: true,
      flaggedForResearch: true,
      studies: {
        select: {
          id: true,
          citation: true,
          findingSummary: true,
          studyType: true,
          consensusStatus: true,
          evidenceFraming: true,
          regulatoryAction: true,
          fundingBasis: true,
          conflictOfInterestNote: true,
          positionType: true,
          challengesStudyId: true,
          sourceUrl: true,
          dataPulledDate: true,
          reviewDate: true,
        },
      },
      regulatoryStatuses: {
        select: {
          id: true,
          jurisdiction: true,
          status: true,
          limitValue: true,
          notes: true,
          sourceUrl: true,
          dataPulledDate: true,
          reviewDate: true,
        },
      },
      authorityAssessments: {
        select: {
          id: true,
          authority: true,
          assessmentType: true,
          classification: true,
          classificationCode: true,
          substanceName: true,
          casNumber: true,
          assessedDate: true,
          sourceUrl: true,
          sourceTitle: true,
          dataPulledDate: true,
        },
      },
    },
  })
  if (!ingredient) notFound()

  // The count reads only the ingredient index, without checking each
  // product's company, so it can include a few products the site hides.
  //
  // THERE IS NO LONGER A SAMPLE. The page used to list twelve products that
  // contain the ingredient, with photographs. Michael, 2026-10-08: "no need
  // to show products that have it... there are 12000 products. remove this
  // section." He is right about the arithmetic: twelve of twelve thousand is
  // not a sample a reader can do anything with, and the twelve were whichever
  // rows the index happened to reach first. The number stays on the tile,
  // because how many products carry an ingredient is a real fact about our
  // coverage; the twelve arbitrary cards do not survive it.
  const productCount = await prisma.productIngredient.count({ where: { ingredientId: id } })

  // A dissent, critique or replication is shown attached to the study it
  // answers, never as an equal finding beside it (see positionType in the
  // schema). Anything whose target isn't on this ingredient stands alone.
  const ids = new Set(ingredient.studies.map((s) => s.id))
  const responses = new Map<string, Study[]>()
  const findings: Study[] = []
  for (const s of ingredient.studies) {
    if (s.challengesStudyId && ids.has(s.challengesStudyId)) {
      const list = responses.get(s.challengesStudyId) ?? []
      list.push(s)
      responses.set(s.challengesStudyId, list)
    } else {
      findings.push(s)
    }
  }

  // The United States first (the market this site covers), then the rest
  // alphabetically, so the comparison always reads from the same anchor.
  const rules = [...ingredient.regulatoryStatuses].sort((a, b) => {
    const rank = (j: string) =>
      /^united states( \(federal\))?$/i.test(j) ? 0 : /^united states/i.test(j) ? 1 : 2
    return rank(a.jurisdiction) - rank(b.jurisdiction) || a.jurisdiction.localeCompare(b.jurisdiction)
  })

  const studyCount = ingredient.studies.length

  // Strongest statement first, then by the authority's name, so an IARC
  // Group 1 is never printed below an administrative permission. A code we
  // have no description for sorts to the bottom rather than being dropped:
  // the record exists, and hiding it would be the gap-as-claim mistake.
  const assessments = [...ingredient.authorityAssessments].sort(
    (a, b) =>
      assessmentWeight(a.classificationCode) - assessmentWeight(b.classificationCode) ||
      (authority(a.authority)?.short ?? a.authority).localeCompare(
        authority(b.authority)?.short ?? b.authority,
      ),
  )

  return (
    <>
      <TopNav />
      <AisleBar />
      <Breadcrumb
        trail={[
          { label: 'Rootify', href: '/' },
          { label: 'Search', href: '/search' },
          { label: 'Ingredients', href: '/ingredients' },
          { label: capitalize(ingredient.name) },
        ]}
      />

      {/* HEADER */}
      <div style={{ boxSizing: 'border-box', padding: `26px ${layout.gutter}px 0` }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: colors.ink3,
          }}
        >
          <span style={{ padding: '2px 7px', background: '#EFEADD', borderRadius: 3, color: colors.ink2 }}>
            Ingredient
          </span>
          {ingredient.category && <span>{ingredient.category}</span>}
        </div>

        <h1
          style={{
            margin: '7px 0 0',
            fontFamily: font.display,
            fontSize: 34,
            lineHeight: 1.1,
            fontWeight: 600,
            letterSpacing: '-0.015em',
          }}
        >
          {capitalize(ingredient.name)}
        </h1>

        {/* THE FLAG CHIP. Two comments from Michael, 2026-10-07, on the
            soybean oil page, and they are the same comment:
              "how is it that soybean oil has open research but no authority
               rulings, studies on file or rules by country?"
              "a brief hover over description of what open research means"

            He is right and this chip was the round-9 bug surviving on a
            different page. It said "Open research" for all 6,250 flagged
            ingredients while meaning only "our classifier marked this an
            additive or processing ingredient". Soybean oil is on 23,802
            products and we hold nothing on it at all; canola oil, 18,630
            products, the same. Amber plus three empty sections looks like a
            warning and carries no information.

            So the chip now reports WHAT WE HOLD, not what the flag is:
            amber only when there is something to read, neutral grey when
            there is not, and in both cases the hover says what the flag
            actually means. */}
        {ingredient.flaggedForResearch &&
          (() => {
            const onFile = studyCount + rules.length + assessments.length
            return (
              <div style={{ marginTop: 14 }}>
                <StatusChip
                  state={onFile > 0 ? 'openResearch' : 'nothingOnFile'}
                  title={
                    onFile > 0
                      ? 'This is an additive or processing ingredient rather than a whole food, which is why we research it. The records we hold on it are below.'
                      : 'This is an additive or processing ingredient rather than a whole food, which is why it is on our research list. It does not mean anything has been found — we hold no studies, authority rulings or country rules on it yet, and that is a gap in our records.'
                  }
                >
                  {onFile > 0 ? 'On our research list' : 'On our research list — nothing on file yet'}
                </StatusChip>
              </div>
            )
          })()}
      </div>

      {/* SIGNAL ROW */}
      <div
        style={{
          boxSizing: 'border-box',
          padding: `22px ${layout.gutter}px 0`,
          display: 'flex',
          gap: 12,
        }}
      >
        <SignalTile
          label="Studies on file"
          value={studyCount}
          note={studyCount === 0 ? 'None added yet' : 'With who paid for each one'}
          accent={studyCount > 0 ? status.openResearch.fg : undefined}
          href={studyCount > 0 ? '#studies' : undefined}
          mono
        />
        <SignalTile
          label="Authority rulings"
          value={assessments.length}
          note={
            assessments.length === 0
              ? 'None on file'
              : 'Published decisions, not studies'
          }
          accent={assessments.length > 0 ? status.openResearch.fg : undefined}
          href={assessments.length > 0 ? '#authorities' : undefined}
          mono
        />
        <SignalTile
          label="Rules by country"
          value={rules.length}
          note={rules.length === 0 ? 'None recorded yet' : rules.map((r) => r.jurisdiction).join(' · ')}
          href={rules.length > 0 ? '#rules' : undefined}
          mono
        />
        <SignalTile
          label="Products that list it"
          value={productCount.toLocaleString()}
          note="In our database"
          mono
        />
      </div>

      {/* BODY */}
      <div
        style={{
          flexGrow: 1,
          boxSizing: 'border-box',
          padding: `30px ${layout.gutter}px 0`,
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
        }}
      >
        <Studies
          findings={findings}
          responses={responses}
          flagged={ingredient.flaggedForResearch}
          ingredientId={ingredient.id}
        />
        <Authorities assessments={assessments} />
        <Rules rules={rules} />
      </div>

      <SiteFooter />
    </>
  )
}

// ------------------------------------------------------------------ sections

type Study = {
  id: string
  citation: string
  findingSummary: string
  studyType: string
  consensusStatus: string
  evidenceFraming: string
  regulatoryAction: string | null
  fundingBasis: string
  conflictOfInterestNote: string | null
  positionType: string
  challengesStudyId: string | null
  sourceUrl: string
  dataPulledDate: Date
  reviewDate: Date | null
}

// WHAT THE RESEARCH SAYS, CONDENSED.
//
// Michael, 2026-10-08: "this is way too much information for the layman.
// this needs to be seriously condensed and a more fun read. scholars can go
// to another page for more detailed info."
//
// What he was looking at: the sunflower oil page opened with two research
// records printed in full, which is about 4,000 characters of regulatory
// prose, before anything else on the page. Across the 20 records in the
// database findingSummary averages 1,510 characters.
//
// What a card shows now:
//   - two tags: what kind of record it is, and who paid for it.
//   - the record's own one-line conclusion, from the stored evidenceFraming
//     column. Not written here and not derived from the prose.
//   - the opening, cut at a sentence boundary around 340 characters.
//   - one closed row per labelled paragraph, named with the author's own
//     label, and one more for the rest of the opening if it was cut.
//   - the source link.
//
// WHAT IS NOT HERE AND WHY. The full citation, the consensus rating, the
// declared-interests box and the dated source record are on
// /ingredients/[id]/research, linked under the cards. They are the reason
// this site exists, so they do not disappear — but a shopper deciding about
// a tub of yoghurt is not reading an author disclosure, and printing it in
// front of them was costing us the readers who would have read the
// conclusion.
//
// NOTHING IS SUMMARISED. Every character a card shows or hides is the stored
// text. See studyOutline.ts for the reasoning; the short version is that a
// paraphrase would become the version most people read, one step further
// from the source, with nobody checking it.
function Studies({
  findings,
  responses,
  flagged,
  ingredientId,
}: {
  findings: Study[]
  responses: Map<string, Study[]>
  flagged: boolean
  ingredientId: string
}) {
  return (
    <section>
      <SectionHead
        id="studies"
        title="What the research says"
        source="Peer-reviewed literature and regulator findings"
      />
      <div style={{ marginTop: 14 }}>
        {findings.length === 0 ? (
          flagged ? (
            <Callout state="unchecked">
              This ingredient is on our research list. No studies have been added yet.
            </Callout>
          ) : (
            <Callout state="nothingOnFile">
              No studies on file. We research additives and processing ingredients, not every
              whole-food ingredient.
            </Callout>
          )
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {findings.map((s) => (
                <FindingCard key={s.id} study={s} responses={responses.get(s.id) ?? []} />
              ))}
            </div>
            <div style={{ marginTop: 13, fontSize: 13.5, lineHeight: 1.6 }}>
              <Link
                href={`/ingredients/${ingredientId}/research`}
                style={{ color: colors.link, fontWeight: 600 }}
              >
                Read the full research record
              </Link>{' '}
              <span style={{ color: colors.ink3 }}>
                — every paragraph in full, with each citation, who funded it, what the authors
                declared, and the date we read the source.
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function FindingCard({ study, responses }: { study: Study; responses: Study[] }) {
  const headline = framingLead(study)
  const { lead, sections } = studyOutline(study.findingSummary)
  // The opening is clipped as one piece rather than paragraph by paragraph,
  // so a record written as four short paragraphs does not produce four
  // "and the rest" rows.
  const opening = clipParagraph(lead.join('\n\n'))

  // A record with no conclusion sentence and no unlabelled opening would
  // otherwise be a card of closed rows with nothing readable on it, so its
  // first section starts open.
  const nothingVisible = !headline && opening.head.length === 0

  return (
    <div
      style={{
        boxSizing: 'border-box',
        padding: '14px 16px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderLeft: `4px solid ${status.openResearch.fg}`,
        borderRadius: layout.radius,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Tag>{STUDY_TYPE_LABEL[study.studyType] ?? study.studyType}</Tag>
        {/* Who paid is the one tag that stays on the condensed card. It is
            the thing this site was built to show, and it changes how the
            sentence above it should be read. The consensus rating moved to
            the research page: it mostly restates the conclusion line. */}
        <Tag>{FUNDING_LABEL[study.fundingBasis] ?? study.fundingBasis}</Tag>
      </div>

      {headline && (
        <p
          style={{
            margin: '11px 0 0',
            fontFamily: font.display,
            fontSize: 17,
            lineHeight: 1.4,
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}
        >
          {headline}
        </p>
      )}

      {opening.head.length > 0 && (
        <div style={{ marginTop: headline ? 8 : 11 }}>
          <Paragraphs text={opening.head} />
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {opening.rest.length > 0 && (
          <MiniCollapse label="The rest of this record">
            <Paragraphs text={opening.rest} />
          </MiniCollapse>
        )}
        {sections.map((section, i) => (
          <MiniCollapse
            key={section.label}
            label={section.label}
            open={nothingVisible && opening.rest.length === 0 && i === 0}
          >
            <Paragraphs text={section.body} />
          </MiniCollapse>
        ))}
        {/* A dissent, replication or critique stays attached to the finding
            it answers rather than sitting beside it as a second opinion of
            equal weight. There are none in the database today; the row is
            here so the first one that lands is not silently dropped. */}
        {responses.map((r) => (
          <MiniCollapse key={r.id} label={`${POSITION_LABEL[r.positionType] ?? 'Response'}`}>
            <Paragraphs text={r.findingSummary} />
            <div style={{ marginTop: 9, fontSize: 12.5, lineHeight: 1.55, color: colors.ink2 }}>
              {r.citation}
            </div>
            <SourceLine url={r.sourceUrl} label="Source" />
          </MiniCollapse>
        ))}
      </div>

      <SourceLine url={study.sourceUrl} label="Source" />
    </div>
  )
}

type AuthorityAssessment = {
  id: string
  authority: string
  assessmentType: string
  classification: string
  classificationCode: string
  substanceName: string
  casNumber: string | null
  assessedDate: Date | null
  sourceUrl: string
  sourceTitle: string
  dataPulledDate: Date
}

// WHAT AUTHORITIES HAVE CLASSIFIED IT AS.
//
// The third research category. A row here is one named body's published
// decision, quoted as it was published, with our plain-English reading of
// what that category means underneath and a link to the body's own page.
//
// Three rules this section exists to keep:
//   1. It never says "studies". These are classifications; a classification
//      can rest on studies we do not hold, and calling them studies would
//      claim a record we do not have.
//   2. The verbatim string is printed before our translation, so the reader
//      can see the authority's words and ours are plainly ours.
//   3. No row is a verdict. The colour marks what kind of statement it is,
//      never how worried to be, and the heading never adds up to a score.
function Authorities({ assessments }: { assessments: AuthorityAssessment[] }) {
  return (
    <section>
      <SectionHead
        id="authorities"
        title="Authority classifications"
        source="Published authority decisions"
      />
      <div style={{ marginTop: 14 }}>
        {assessments.length === 0 ? (
          <Callout state="nothingOnFile">
            No authority has published a classification for this ingredient that we hold. That is a
            gap in our records, not a finding either way —{' '}
            <Link href="/sourcing" style={{ color: colors.link }}>
              what we check and what we do not
            </Link>
            .
          </Callout>
        ) : (
          <>
            <p
              style={{
                margin: '0 0 13px',
                fontSize: 13,
                lineHeight: 1.6,
                color: colors.ink2,
                maxWidth: 760,
              }}
            >
              These are classifications, not studies. Each one is a decision a named body published
              about the substance — a category it placed the substance in, or a limit it set — and
              the line under it is our plain reading of what that category means.{' '}
              <Link href="/sourcing" style={{ color: colors.link }}>
                How we read each authority
              </Link>
              .
            </p>
            <div
              style={{
                background: colors.card,
                border: `1px solid ${colors.line}`,
                borderRadius: layout.radius,
                overflow: 'hidden',
              }}
            >
              {assessments.map((a, i) => (
                <AssessmentRow key={a.id} a={a} first={i === 0} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function AssessmentRow({ a, first }: { a: AuthorityAssessment; first: boolean }) {
  const body = authority(a.authority)
  const meaning = classificationMeaning(a.classificationCode)
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr',
        gap: 16,
        boxSizing: 'border-box',
        padding: '14px 16px',
        borderTop: first ? undefined : `1px solid ${colors.line}`,
        alignItems: 'baseline',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 600 }}>
          {body?.short ?? a.authority}
        </div>
        {body && (
          <div style={{ fontSize: 12, lineHeight: 1.45, color: colors.ink3, marginTop: 3 }}>
            {body.name}
          </div>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        {/* The authority's own words first, verbatim, so the reader can see
            where the record ends and our reading of it begins. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {meaning && <StatusChip state={meaning.state}>{meaning.label}</StatusChip>}
          <span style={{ fontFamily: font.mono, fontSize: 12.5, color: colors.ink }}>
            {a.classification}
          </span>
        </div>
        {meaning ? (
          <div style={{ fontSize: 13, lineHeight: 1.6, color: colors.ink2, marginTop: 8 }}>
            {meaning.plain}
          </div>
        ) : (
          // A category we hold but have not written a description for. Say
          // that, rather than borrowing a neighbouring category's wording.
          <div style={{ fontSize: 13, lineHeight: 1.6, color: colors.ink3, marginTop: 8 }}>
            We have not written a plain-English reading of this category yet. The authority's own
            wording is above and its page is linked below.
          </div>
        )}
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: colors.ink3,
            marginTop: 7,
          }}
        >
          {`Listed as “${a.substanceName}”`}
          {a.casNumber ? `, CAS ${a.casNumber}` : ''}
          {a.assessedDate
            ? `, classified ${a.assessedDate.toISOString().slice(0, 10)}`
            : ''}
          .
        </div>
        <SourceLine url={a.sourceUrl} label={a.sourceTitle} />
      </div>
    </div>
  )
}

function Rules({ rules }: { rules: Ingredient['regulatoryStatuses'] }) {
  return (
    <section>
      <SectionHead id="rules" title="Global regulation comparison" source="Regulator publications" />
      <div style={{ marginTop: 14 }}>
        {rules.length === 0 ? (
          <Callout state="nothingOnFile">No country rules recorded for this ingredient yet.</Callout>
        ) : (
          <div
            style={{
              background: colors.card,
              border: `1px solid ${colors.line}`,
              borderRadius: layout.radius,
              overflow: 'hidden',
            }}
          >
            {rules.map((r, i) => (
              <div
                key={r.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '200px 210px 1fr',
                  gap: 16,
                  boxSizing: 'border-box',
                  padding: '13px 16px',
                  borderTop: i === 0 ? undefined : `1px solid ${colors.line}`,
                  alignItems: 'baseline',
                }}
              >
                <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 600 }}>{r.jurisdiction}</div>
                <div style={{ fontSize: 13.5, color: colors.ink }}>
                  {RULE_LABEL[r.status] ?? r.status}
                  {r.limitValue && (
                    <div style={{ fontFamily: font.mono, fontSize: 12, color: colors.ink2, marginTop: 3 }}>
                      {r.limitValue}
                    </div>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  {r.notes && <div style={{ fontSize: 13, lineHeight: 1.55, color: colors.ink2 }}>{r.notes}</div>}
                  <SourceLine url={r.sourceUrl} label="Source" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ wording






const RULE_LABEL: Record<string, string> = {
  permitted_no_limit: 'Permitted, no limit set',
  permitted_with_limit: 'Permitted with a limit',
  requires_warning: 'Permitted with a required warning',
  restricted: 'Restricted',
  banned: 'Banned',
  not_assessed: 'Not assessed',
}

// Ingredient names are stored lower-case ("red 40"); headings read better
// with a capital first letter. Only the first letter, so "pH" or "DATEM"
// further in are left as stored.
function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

type Ingredient = {
  regulatoryStatuses: {
    id: string
    jurisdiction: string
    status: string
    limitValue: string | null
    notes: string | null
    sourceUrl: string
    dataPulledDate: Date
    reviewDate: Date | null
  }[]
}

// ------------------------------------------------------------------ pieces
// Same as the product page's helpers, so the two pages look identical.



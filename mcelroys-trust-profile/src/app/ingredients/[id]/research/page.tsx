import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { colors, font, isoDate, layout, status } from '@/lib/design'
import { AisleBar, BackTo, SiteFooter, TopNav } from '@/components/SiteChrome'
import { Callout, Paragraphs, SectionHead, SourceLine, Tag } from '@/components/PageParts'
import {
  CONSENSUS_LABEL,
  framingLead,
  FUNDING_LABEL,
  POSITION_LABEL,
  STUDY_TYPE_LABEL,
} from '@/lib/studyOutline'

// THE FULL RESEARCH RECORD. "Scholars can go to another page."
//
// Michael, on the ingredient page, 2026-10-08: "this is way too much
// information for the layman. this needs to be seriously condensed and a
// more fun read. scholars can go to another page for more detailed info."
//
// This is that page. The ingredient page now shows each finding as a
// conclusion sentence plus a few rows a reader can open; everything that
// came off it is here, in full, nothing collapsed and nothing clipped.
//
// WHAT "IN FULL" MEANS, and it is the point of the page:
//   - every paragraph of findingSummary, as stored;
//   - the citation;
//   - what kind of study it was, and the state of the consensus;
//   - who funded it, and what the authors declared about their interests;
//   - the date we read the source, and the date we last reviewed the record;
//   - any dissent, replication or critique, attached to the finding it
//     answers rather than listed beside it.
//
// Nothing on this page is a summary of anything. There is nothing to
// condense here on purpose: this is the page that proves the short version
// on the ingredient page did not quietly drop something.
//
// It is a separate route rather than an expandable block because that is
// what makes the ingredient page shorter. A 4,000-character record hidden
// behind a toggle is still 4,000 characters of page, and one careless click
// puts a shopper back where they started.

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

const STUDY_FIELDS = {
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
} as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ingredient = await prisma.ingredient.findUnique({ where: { id }, select: { name: true } })
  if (!ingredient) return { title: 'Ingredient not found' }
  return {
    title: `Research record · ${capitalize(ingredient.name)}`,
    description: `Every research record Rootify holds on ${ingredient.name}, in full, with citations, funding and the dates we read each source.`,
  }
}

export default async function IngredientResearchPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const ingredient = await prisma.ingredient.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      category: true,
      flaggedForResearch: true,
      studies: { select: STUDY_FIELDS, orderBy: { dataPulledDate: 'desc' } },
    },
  })
  if (!ingredient) notFound()

  // A response is shown under the finding it answers, exactly as on the
  // ingredient page. Same grouping, written once here rather than twice: a
  // response that lost its parent would otherwise vanish from both pages.
  const findings: Study[] = []
  const responses = new Map<string, Study[]>()
  for (const s of ingredient.studies) {
    if (s.challengesStudyId) {
      const list = responses.get(s.challengesStudyId) ?? []
      list.push(s)
      responses.set(s.challengesStudyId, list)
    } else {
      findings.push(s)
    }
  }
  // An orphan — a response whose parent is not in our records — is still a
  // record, so it is listed as a finding rather than dropped.
  const parents = new Set(findings.map((f) => f.id))
  for (const [challenged, list] of responses) {
    if (!parents.has(challenged)) findings.push(...list)
  }

  return (
    <>
      <TopNav />
      <AisleBar />
      <BackTo href={`/ingredients/${ingredient.id}`} label={capitalize(ingredient.name)} />

      <div style={{ boxSizing: 'border-box', padding: `26px ${layout.gutter}px 0`, maxWidth: 860 }}>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: colors.ink3,
          }}
        >
          The full record
        </div>
        <h1
          style={{
            margin: '7px 0 0',
            fontFamily: font.display,
            fontSize: 32,
            lineHeight: 1.12,
            fontWeight: 600,
            letterSpacing: '-0.015em',
          }}
        >
          Research on {ingredient.name}
        </h1>
        <p style={{ margin: '14px 0 0', fontSize: 15.5, lineHeight: 1.6, color: colors.ink2 }}>
          Every research record we hold on this ingredient, printed in full — the citation, who
          funded the work, what the authors declared, and the date we read the source. The{' '}
          <Link href={`/ingredients/${ingredient.id}`} style={{ color: colors.link, fontWeight: 600 }}>
            ingredient page
          </Link>{' '}
          shows the same records in short.
        </p>
      </div>

      <div
        style={{
          flexGrow: 1,
          boxSizing: 'border-box',
          padding: `30px ${layout.gutter}px 0`,
          maxWidth: 860,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        <section>
          <SectionHead
            title={findings.length === 1 ? '1 record' : `${findings.length} records`}
            source="Peer-reviewed literature and regulator findings"
          />
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {findings.length === 0 ? (
              ingredient.flaggedForResearch ? (
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
              findings.map((s) => (
                <FullRecord key={s.id} study={s} responses={responses.get(s.id) ?? []} />
              ))
            )}
          </div>
        </section>

        <Callout state="nothingOnFile">
          A record on this page is a report of what a named source says, with a link to that
          source. It is not our conclusion about the ingredient, and Rootify does not score
          ingredients —{' '}
          <Link href="/sourcing" style={{ color: colors.link }}>
            what we check and what we do not
          </Link>
          .
        </Callout>
      </div>

      <SiteFooter />
    </>
  )
}

function FullRecord({ study, responses }: { study: Study; responses: Study[] }) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        padding: '16px 18px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderLeft: `4px solid ${status.openResearch.fg}`,
        borderRadius: layout.radius,
      }}
    >
      <RecordBody study={study} />

      {responses.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {responses.map((r) => (
            <div
              key={r.id}
              style={{
                boxSizing: 'border-box',
                padding: '12px 14px',
                background: colors.panel,
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: colors.ink2,
                  marginBottom: 8,
                }}
              >
                {POSITION_LABEL[r.positionType] ?? 'Response'}
              </div>
              <RecordBody study={r} nested />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// nested: drawn inside a response panel, which already uses the panel tint,
// so its tags and boxes switch to white to stay visible.
function RecordBody({ study, nested }: { study: Study; nested?: boolean }) {
  const headline = framingLead(study)
  const pulled = isoDate(study.dataPulledDate)
  const reviewed = isoDate(study.reviewDate)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Tag nested={nested}>{STUDY_TYPE_LABEL[study.studyType] ?? study.studyType}</Tag>
        <Tag nested={nested}>{CONSENSUS_LABEL[study.consensusStatus] ?? study.consensusStatus}</Tag>
        <Tag nested={nested}>{FUNDING_LABEL[study.fundingBasis] ?? study.fundingBasis}</Tag>
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

      {/* The whole summary, every paragraph, nothing collapsed. This is the
          page that exists so the short version has something to be short
          against. */}
      <div style={{ marginTop: headline ? 9 : 11 }}>
        <Paragraphs text={study.findingSummary} />
      </div>

      <div style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.55, color: colors.ink2 }}>
        {study.citation}
      </div>

      {/* Who paid, and what the authors declared. "Could not be determined"
          is printed as such — blank would read as "no conflict". */}
      {study.conflictOfInterestNote && (
        <div
          style={{
            marginTop: 10,
            boxSizing: 'border-box',
            padding: '10px 13px',
            background: nested ? colors.card : colors.panel,
            borderRadius: 6,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: colors.ink2,
          }}
        >
          <strong style={{ color: colors.ink }}>Declared interests: </strong>
          {study.conflictOfInterestNote}
        </div>
      )}

      {/* Both dates, which the ingredient page does not have room for. The
          read date says how current the source was when we took it; the
          review date says when a person last checked our record of it, and
          its absence is stated rather than left blank. */}
      <div style={{ marginTop: 10, fontSize: 12, color: colors.ink3, lineHeight: 1.55 }}>
        {pulled && <>Source read {pulled}. </>}
        {reviewed ? <>Record last reviewed {reviewed}.</> : <>Not yet reviewed by a person.</>}
      </div>

      <SourceLine url={study.sourceUrl} label="Source" />
    </>
  )
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

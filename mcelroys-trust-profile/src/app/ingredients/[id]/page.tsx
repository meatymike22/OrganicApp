import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { colors, font, isoDate, layout, status } from '@/lib/design'
import { VETTED_COMPANIES } from '@/lib/vetting'
import { AisleBar, Breadcrumb, SignalTile, SiteFooter, TopNav } from '@/components/SiteChrome'
import { StatusChip } from '@/components/StatusChip'

// ONE INGREDIENT: the studies on file about it, how each country regulates
// it, and which products list it.
//
// Product pages link here from every ingredient on a label. Most ingredients
// (oats, salt, water) have no studies — research is kept for additives and
// processing ingredients (Ingredient.flaggedForResearch) — so this page has
// to read sensibly both with a full research record and with none.
//
// Styling follows the product page exactly: same nav, header, signal tiles,
// section heads and source lines. The small helpers at the bottom
// (SectionHead, Callout, SourceLine) are copies of the product page's, kept
// identical on purpose.

// How many products to list by name. Some ingredients (natural flavor) are on
// tens of thousands of labels; the count says how many, the list is a sample.
const PRODUCT_SAMPLE = 24

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
    },
  })
  if (!ingredient) notFound()

  // PERFORMANCE: some ingredients are on 80,000+ labels. Sorting those by
  // product name in the database means reading every one of them (~12 s), so
  // the sample is taken unsorted (stops after PRODUCT_SAMPLE rows, ~15 ms) and
  // sorted here. The count reads only the ingredient index, without checking
  // each product's company, so it can include a few products the site hides.
  const [productCount, rawSample] = await Promise.all([
    prisma.productIngredient.count({ where: { ingredientId: id } }),
    prisma.productIngredient.findMany({
      // Only products from confirmed companies are listed by name — the
      // same set the rest of the site shows.
      where: { ingredientId: id, product: { company: VETTED_COMPANIES } },
      take: PRODUCT_SAMPLE,
      select: {
        product: { select: { id: true, name: true, company: { select: { id: true, legalName: true } } } },
      },
    }),
  ])
  const sample = rawSample.map((r) => r.product).sort((a, b) => a.name.localeCompare(b.name))

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

        {ingredient.flaggedForResearch && (
          <div style={{ marginTop: 14 }}>
            <StatusChip state="openResearch">Open research</StatusChip>
          </div>
        )}
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
          href={productCount > 0 ? '#products' : undefined}
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
        />
        <Rules rules={rules} />
        <Products count={productCount} sample={sample} />
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

function Studies({
  findings,
  responses,
  flagged,
}: {
  findings: Study[]
  responses: Map<string, Study[]>
  flagged: boolean
}) {
  return (
    <section>
      <SectionHead id="studies" title="What the studies say" source="Peer-reviewed literature and regulator findings" />
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {findings.map((s) => (
              <StudyCard key={s.id} study={s} responses={responses.get(s.id) ?? []} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function StudyCard({ study, responses }: { study: Study; responses: Study[] }) {
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
      <StudyBody study={study} />

      {/* Responses to this finding, attached to it rather than beside it. */}
      {responses.length > 0 && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {responses.map((r) => (
            <div
              key={r.id}
              style={{
                boxSizing: 'border-box',
                padding: '11px 13px',
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
                  marginBottom: 7,
                }}
              >
                {POSITION_LABEL[r.positionType] ?? 'Response'}
              </div>
              <StudyBody study={r} nested />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// nested: drawn inside a response panel, which already uses the panel tint,
// so its tags and boxes switch to white to stay visible.
function StudyBody({ study, nested }: { study: Study; nested?: boolean }) {
  const lead = framingLead(study)
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Tag nested={nested}>{STUDY_TYPE_LABEL[study.studyType] ?? study.studyType}</Tag>
        <Tag nested={nested}>{CONSENSUS_LABEL[study.consensusStatus] ?? study.consensusStatus}</Tag>
        <Tag nested={nested}>{FUNDING_LABEL[study.fundingBasis] ?? study.fundingBasis}</Tag>
      </div>

      {lead && (
        <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, fontWeight: 600 }}>{lead}</p>
      )}
      <p style={{ margin: lead ? '6px 0 0' : '10px 0 0', fontSize: 14, lineHeight: 1.6 }}>{study.findingSummary}</p>

      <div style={{ marginTop: 9, fontSize: 12.5, lineHeight: 1.55, color: colors.ink2 }}>{study.citation}</div>

      {/* Who paid, and what the authors declared. "Could not be determined"
          is printed as such — blank would read as "no conflict". */}
      {study.conflictOfInterestNote && (
        <div
          style={{
            marginTop: 9,
            boxSizing: 'border-box',
            padding: '9px 12px',
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

      <SourceLine url={study.sourceUrl} label="Source" readAt={study.dataPulledDate} reviewedAt={study.reviewDate} />
    </>
  )
}

function Rules({ rules }: { rules: Ingredient['regulatoryStatuses'] }) {
  return (
    <section>
      <SectionHead id="rules" title="How countries regulate it" source="Regulator publications" />
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
                  <SourceLine url={r.sourceUrl} label="Source" readAt={r.dataPulledDate} reviewedAt={r.reviewDate} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Products({
  count,
  sample,
}: {
  count: number
  sample: { id: string; name: string; company: { id: string; legalName: string } }[]
}) {
  return (
    <section>
      <SectionHead
        id="products"
        title="Products that list it"
        source={count > sample.length ? `${sample.length} of ${count.toLocaleString()} shown` : undefined}
      />
      <div style={{ marginTop: 14 }}>
        {count === 0 ? (
          <Callout state="nothingOnFile">No product in our database lists this ingredient.</Callout>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 9,
            }}
          >
            {sample.map((p) => (
              <Link
                key={p.id}
                href={`/products/${p.id}`}
                style={{
                  display: 'block',
                  boxSizing: 'border-box',
                  padding: '11px 14px',
                  background: colors.card,
                  border: `1px solid ${colors.line}`,
                  borderRadius: layout.radius,
                  textDecoration: 'none',
                  color: 'inherit',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontFamily: font.display,
                    fontSize: 15,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.name}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: colors.ink3,
                    marginTop: 3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.company.legalName}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ wording

// How a finding is phrased depends on evidenceFraming (see the schema): a
// regulator's action is stated as fact; an unproven concern is never worded
// as harm.
function framingLead(s: Study): string | null {
  // A record about a law (e.g. what "natural flavor" lets a label leave out)
  // is not a study, so the study wording would misdescribe it. Its summary
  // speaks for itself unless a regulator acted.
  if (s.studyType === 'regulatory_framework' && s.evidenceFraming !== 'regulator_confirmed') return null
  switch (s.evidenceFraming) {
    case 'regulator_confirmed':
      return s.regulatoryAction ? `Regulator action: ${s.regulatoryAction}` : 'A regulator has taken formal action.'
    case 'potential_concern_unproven':
      return 'Studies raise questions; harm in humans has not been established.'
    case 'generally_recognized_safe':
      return 'Reviewed; no significant concern found.'
    case 'insufficient_research':
      return 'Too little research to draw a conclusion.'
    default:
      return null
  }
}

const STUDY_TYPE_LABEL: Record<string, string> = {
  RCT: 'Randomized trial',
  observational: 'Observational study',
  review: 'Review',
  'meta-analysis': 'Meta-analysis',
  regulatory_framework: 'Regulation',
}

const CONSENSUS_LABEL: Record<string, string> = {
  'well-established': 'Well established',
  'mixed evidence': 'Mixed evidence',
  'limited evidence': 'Limited evidence',
  disputed: 'Disputed',
}

const FUNDING_LABEL: Record<string, string> = {
  independent: 'Independent funding',
  industry_funded: 'Industry funded',
  mixed: 'Mixed funding',
  undetermined: 'Funding could not be determined',
}

const POSITION_LABEL: Record<string, string> = {
  dissenting_view: 'Disputed by',
  replication: 'Replication',
  critique: 'Critique of the methods',
}

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

function SectionHead({ title, source, id }: { title: string; source?: string; id?: string }) {
  return (
    <div
      id={id}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 16,
        borderBottom: `2px solid ${colors.ink}`,
        paddingBottom: 9,
        scrollMarginTop: 16,
      }}
    >
      <h2 style={{ margin: 0, fontFamily: font.display, fontSize: 22, fontWeight: 600 }}>{title}</h2>
      {source && <span style={{ fontSize: 12, color: colors.ink3 }}>{source}</span>}
    </div>
  )
}

function Callout({ state, children }: { state: keyof typeof status; children: React.ReactNode }) {
  const s = status[state]
  return (
    <div
      style={{
        boxSizing: 'border-box',
        padding: '12px 15px',
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 7,
        fontSize: 13,
        lineHeight: 1.6,
        color: colors.ink2,
      }}
    >
      {children}
    </div>
  )
}

// A plain label for a fact about a study (type, consensus, funding). Neutral
// on purpose: these are descriptions, not statuses, so they get no colour.
function Tag({ children, nested }: { children: React.ReactNode; nested?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 8px',
        background: nested ? colors.card : '#EFEADD',
        borderRadius: 5,
        fontSize: 11.5,
        fontWeight: 600,
        color: colors.ink2,
        lineHeight: 1.35,
      }}
    >
      {children}
    </span>
  )
}

function SourceLine({
  url,
  label,
  readAt,
  reviewedAt,
}: {
  url?: string | null
  label: string
  readAt?: Date | string | null
  reviewedAt?: Date | string | null
}) {
  const read = isoDate(readAt)
  const reviewed = isoDate(reviewedAt)
  return (
    <div style={{ fontSize: 11.5, color: colors.ink4, marginTop: 7, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      ) : (
        <span>{label}</span>
      )}
      {read && <span style={{ fontFamily: font.mono }}>read {read}</span>}
      <span>{reviewed ? `checked by a person ${reviewed}` : 'not yet checked by a person'}</span>
    </div>
  )
}

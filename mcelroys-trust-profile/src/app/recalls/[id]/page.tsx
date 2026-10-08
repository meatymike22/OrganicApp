import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { colors, font, isoDate, layout } from '@/lib/design'
import { AisleBar, Breadcrumb, SiteFooter, TopNav } from '@/components/SiteChrome'
import { StatusChip } from '@/components/StatusChip'
import { SourceLine } from '@/components/PageParts'
import { plainReason } from '@/lib/plainRecall'

// ONE GOVERNMENT NOTICE, AS SOMETHING A PERSON CAN READ.
//
// WHY THIS PAGE EXISTS. Michael, 2026-10-07, on the recall card's source
// link: "i dont think people will get any value out of a JSON file. Is there
// a more intelligent way to link this?"
//
// He was right and the numbers are worse than the comment suggests. Of the
// 19,950 notices we hold, 18,674 — every FDA one, 94% of the total — have a
// `sourceUrl` pointing at an api.fda.gov enforcement endpoint, which returns
// JSON. The remaining CPSC and FSIS rows link real press releases.
//
// I checked whether there was a human page to point at instead. There is not:
// FDA publishes no per-recall page keyed by recall number, and its Enforcement
// Report search at accessdata.fda.gov is JavaScript-driven with no linkable
// query. So the readable record has to be one we build, because we are already
// holding every field it needs.
//
// WHAT THIS PAGE IS NOT. It is not a replacement for the government record and
// it never presents itself as one. Everything here is our transcription of a
// public record, the agency's own URL is on the page, and where that URL
// returns JSON the page says so rather than letting someone click into a wall
// of braces. The one thing a reader can do here that they cannot do on
// api.fda.gov is understand what the notice said.

export const revalidate = 3600

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const action = await prisma.regulatoryAction.findUnique({
    where: { id },
    select: { sourceAgency: true, actionDate: true, company: { select: { legalName: true } } },
  })
  if (!action) return { title: 'Notice not found' }
  const when = action.actionDate ? isoDate(action.actionDate) : null
  return {
    title: `${action.sourceAgency} notice · ${action.company.legalName}${when ? ` · ${when}` : ''}`,
    description: `What a ${action.sourceAgency} notice naming ${action.company.legalName} said, and the record it came from.`,
  }
}

// What each agency is, in one line. A reader who does not know what FSIS is
// cannot weigh an FSIS notice, and the acronym alone tells them nothing.
const AGENCIES: Record<string, { name: string; what: string; searchUrl?: string; searchLabel?: string }> = {
  FDA: {
    name: 'US Food and Drug Administration',
    what: 'Regulates most packaged food, drugs and devices. Its recall records are published weekly in the Enforcement Report.',
    searchUrl: 'https://www.accessdata.fda.gov/scripts/ires/index.cfm',
    searchLabel: 'Search the FDA Enforcement Report',
  },
  FSIS: {
    name: 'USDA Food Safety and Inspection Service',
    what: 'Regulates meat, poultry and egg products, which the FDA does not. It publishes each recall as its own press release.',
  },
  CPSC: {
    name: 'US Consumer Product Safety Commission',
    what: 'Regulates consumer goods other than food, drugs and vehicles. It publishes each recall as its own press release.',
  },
  CBP: {
    name: 'US Customs and Border Protection',
    what: 'Issues withhold release orders stopping goods at the border, most often over forced-labour findings in a supply chain.',
  },
}

// FDA recall classes, in the FDA's own terms. These are the agency's
// definitions, not our reading of severity.
const CLASSES: Record<string, string> = {
  'Class I':
    'The FDA’s most serious class: a reasonable probability that using the product will cause serious health consequences or death.',
  'Class II':
    'The FDA’s middle class: use of the product may cause temporary or medically reversible health consequences, and the probability of serious harm is remote.',
  'Class III':
    'The FDA’s least serious class: use of the product is not likely to cause adverse health consequences. Often a labelling or packaging fault.',
}

const ACTION_TYPES: Record<string, string> = {
  recall: 'Recall',
  warning_letter: 'Warning letter',
  withhold_release_order: 'Withhold release order',
}

const RELEVANCE: Record<string, string> = {
  direct: 'This notice concerns the product line itself or how it was produced.',
  supply_chain:
    'This notice concerns a facility or supplier in the supply chain rather than a finished product.',
  unrelated_line:
    'This notice names the same legal entity but a different line of business. It is a true fact about the company and a misleading one about any particular product, which is why it is not shown on product pages.',
  unreviewed:
    'Nobody has yet assessed whether this notice concerns the products we track for this company, so it is not shown on product pages.',
}

export default async function RecallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const action = await prisma.regulatoryAction.findUnique({
    where: { id },
    select: {
      id: true,
      sourceAgency: true,
      actionType: true,
      referenceNumber: true,
      classification: true,
      reason: true,
      productDescription: true,
      status: true,
      actionDate: true,
      terminationDate: true,
      productRelevance: true,
      sourceUrl: true,
      dataPulledDate: true,
      company: { select: { id: true, legalName: true } },
      commodity: { select: { id: true, name: true } },
      // The products in our database this notice was matched to, and HOW each
      // match was made. The method is the whole point: a barcode printed in
      // the notice is a different kind of fact from a brand name appearing in
      // it, and a reader who cannot tell them apart cannot check our work.
      links: {
        select: {
          id: true,
          matchMethod: true,
          matchedText: true,
          product: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!action) notFound()

  const agency = AGENCIES[action.sourceAgency]
  // An api.fda.gov URL returns JSON. Saying so is the difference between a
  // citation and a trap.
  const sourceIsJson = /api\.fda\.gov/i.test(action.sourceUrl)
  const linkedProducts = action.links.filter((l) => l.product !== null)
  // On THIS page the agency's own sentence is the headline — this is the page
  // for someone who wants the numbers and the acronyms. The plain summary
  // sits above it as a one-line orientation, which is the reverse of the
  // product and company cards, where the plain version leads.
  const plain = plainReason(action.reason)

  return (
    <>
      <TopNav />
      <AisleBar />
      <Breadcrumb
        trail={[
          { label: 'Rootify', href: '/' },
          { label: action.company.legalName, href: `/companies/${action.company.id}` },
          { label: `${action.sourceAgency} notice` },
        ]}
      />

      {/* HEADER */}
      <div style={{ boxSizing: 'border-box', padding: `26px ${layout.gutter}px 0`, maxWidth: 860 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <StatusChip state="recall">
            {ACTION_TYPES[action.actionType] ?? action.actionType}
            {action.classification ? ` · ${action.classification}` : ''}
          </StatusChip>
          <span style={{ fontFamily: font.mono, fontSize: 13, color: colors.ink2, fontWeight: 600 }}>
            {action.actionDate ? isoDate(action.actionDate) : 'No date on the record'}
          </span>
          {action.status && <span style={{ fontSize: 13, color: colors.ink3 }}>{action.status}</span>}
        </div>

        {/* IN ONE LINE, FIRST. Michael, 2026-10-07: the technical reader can
            "review all of the numbers, the acronyms" here, but even they
            benefit from knowing what the notice is about before reading it. */}
        {plain && (
          <p
            style={{
              margin: '13px 0 0',
              fontSize: 16,
              lineHeight: 1.5,
              color: colors.ink2,
              fontWeight: 500,
            }}
          >
            {plain.text}
          </p>
        )}

        {/* THE REASON IS THE HEADLINE. It is the sentence the agency wrote
            about why the notice exists, and it is the only thing on this page
            a reader is guaranteed to want. */}
        <h1
          style={{
            margin: '12px 0 0',
            fontFamily: font.display,
            fontSize: 'clamp(22px, 3vw, 30px)',
            lineHeight: 1.18,
            fontWeight: 600,
            letterSpacing: '-0.015em',
          }}
        >
          {action.reason}
        </h1>
        {plain && (
          <p style={{ margin: '8px 0 0', fontSize: 11.5, color: colors.ink4 }}>
            Above, in the agency&rsquo;s own words. The line before it is our
            plain-English summary &mdash;{' '}
            <Link href="/sourcing" style={{ color: colors.link }}>
              how we word these
            </Link>
            .
          </p>
        )}

        <p style={{ margin: '13px 0 0', fontSize: 15, lineHeight: 1.6, color: colors.ink2 }}>
          Issued by the {agency ? agency.name : action.sourceAgency}, naming{' '}
          <Link href={`/companies/${action.company.id}`} style={{ color: colors.link }}>
            {action.company.legalName}
          </Link>
          .
        </p>
      </div>

      {/* BODY */}
      <div
        style={{
          flexGrow: 1,
          boxSizing: 'border-box',
          padding: `26px ${layout.gutter}px 0`,
          maxWidth: 860,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {action.productDescription && (
          <Block title="What the notice covered">
            {/* Verbatim. This is the field that stops a notice about one
                product line reading as a recall of everything the company
                makes, so it is never summarised or trimmed. */}
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: colors.ink }}>
              {action.productDescription}
            </p>
            <p style={{ margin: '9px 0 0', fontSize: 12, lineHeight: 1.55, color: colors.ink3 }}>
              Quoted from the record as published. If a product is not described here, this notice
              does not tell us whether it was affected.
            </p>
          </Block>
        )}

        {action.classification && CLASSES[action.classification] && (
          <Block title={`What ${action.classification} means`}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: colors.ink2 }}>
              {CLASSES[action.classification]}
            </p>
            <p style={{ margin: '9px 0 0', fontSize: 12, lineHeight: 1.55, color: colors.ink3 }}>
              This is the agency&rsquo;s own definition of the class. We do not assign classes and we
              do not rank them against each other.
            </p>
          </Block>
        )}

        <Block title="The record">
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(140px, 180px) 1fr', gap: '8px 16px' }}>
            <Row label="Agency">
              {agency ? `${agency.name} (${action.sourceAgency})` : action.sourceAgency}
            </Row>
            {action.referenceNumber && (
              <Row label="Reference number" mono>
                {action.referenceNumber}
              </Row>
            )}
            <Row label="Kind of action">{ACTION_TYPES[action.actionType] ?? action.actionType}</Row>
            {action.actionDate && <Row label="Dated" mono>{isoDate(action.actionDate)}</Row>}
            {action.terminationDate && (
              <Row label="Terminated" mono>
                {isoDate(action.terminationDate)}
              </Row>
            )}
            {action.status && <Row label="Status on the record">{action.status}</Row>}
            {/* Named, not linked: there is no /commodities route yet, and a
                link to a 404 is worse than plain text. */}
            {action.commodity && <Row label="Commodity named">{action.commodity.name}</Row>}
            <Row label="We read it" mono>
              {isoDate(action.dataPulledDate)}
            </Row>
          </dl>

          {agency && (
            <p style={{ margin: '13px 0 0', fontSize: 12.5, lineHeight: 1.6, color: colors.ink3 }}>
              {agency.what}
            </p>
          )}
        </Block>

        {/* HOW THIS NOTICE REACHED A PRODUCT PAGE, if it did. The match
            method is shown for every link, because "the notice printed this
            barcode" and "the notice mentioned this brand" are not the same
            evidence and a reader is entitled to tell them apart. */}
        <Block title="Products we matched to this notice">
          {linkedProducts.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: colors.ink3 }}>
              We have not matched this notice to any product in our database. That usually means the
              notice named no barcode we hold &mdash; it does not mean no product was affected.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {linkedProducts.map((l) => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <Link href={`/products/${l.product!.id}`} style={{ color: colors.link, fontSize: 14 }}>
                    {l.product!.name}
                  </Link>
                  <span style={{ fontSize: 11.5, color: colors.ink4 }}>
                    {l.matchMethod === 'barcode'
                      ? 'the notice printed this product’s barcode'
                      : l.matchMethod === 'brand_name'
                        ? 'the notice named this brand'
                        : l.matchMethod === 'owner_brand'
                          ? 'the notice named the owner and the brand'
                          : l.matchMethod}
                    {l.matchedText ? `: “${l.matchedText}”` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Block>

        <Block title="How we are treating it">
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: colors.ink2 }}>
            {RELEVANCE[action.productRelevance] ?? RELEVANCE.unreviewed}
          </p>
        </Block>

        {/* THE CITATION. Last, labelled for what it actually returns, and
            never the only readable thing on the page. */}
        <Block title="The government record">
          {sourceIsJson ? (
            <>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: colors.ink2 }}>
                The FDA publishes this notice through its enforcement API, so the link below returns
                raw JSON rather than a readable page. It is the primary record and we cite it as
                such; everything above is our transcription of it.
              </p>
              <div style={{ fontSize: 12, marginTop: 9, wordBreak: 'break-all' }}>
                <a href={action.sourceUrl} target="_blank" rel="noopener noreferrer">
                  {action.sourceUrl}
                </a>
              </div>
              {agency?.searchUrl && (
                <p style={{ margin: '11px 0 0', fontSize: 12.5, lineHeight: 1.6, color: colors.ink3 }}>
                  To see it in the FDA&rsquo;s own words, search the reference number
                  {action.referenceNumber ? (
                    <>
                      {' '}
                      <span style={{ fontFamily: font.mono }}>{action.referenceNumber}</span>
                    </>
                  ) : null}{' '}
                  in the{' '}
                  <a href={agency.searchUrl} target="_blank" rel="noopener noreferrer">
                    {agency.searchLabel}
                  </a>
                  . The FDA publishes no direct link to an individual recall.
                </p>
              )}
            </>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: colors.ink2 }}>
                The agency published this notice as a page of its own. Everything above is our
                transcription of it; the original is the record.
              </p>
              <SourceLine url={action.sourceUrl} label={`${action.sourceAgency} notice`} />
            </>
          )}

          <p style={{ margin: '13px 0 0', fontSize: 12, lineHeight: 1.55, color: colors.ink4 }}>
            <Link href="/sourcing" style={{ color: colors.link }}>
              How we source every record on this site
            </Link>
          </p>
        </Block>
      </div>

      <SiteFooter />
    </>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        boxSizing: 'border-box',
        padding: '15px 17px',
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderRadius: layout.radius,
      }}
    >
      <h2
        style={{
          margin: '0 0 11px',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: colors.ink2,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt style={{ fontSize: 12.5, color: colors.ink3 }}>{label}</dt>
      <dd
        style={{
          margin: 0,
          fontSize: 13.5,
          lineHeight: 1.5,
          color: colors.ink,
          fontFamily: mono ? font.mono : undefined,
          minWidth: 0,
          wordBreak: 'break-word',
        }}
      >
        {children}
      </dd>
    </>
  )
}

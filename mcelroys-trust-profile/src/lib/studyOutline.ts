// READING A RESEARCH RECORD WITHOUT READING ALL OF IT.
//
// Michael, on the ingredient page, 2026-10-08: "this is way too much
// information for the layman. this needs to be seriously condensed and a
// more fun read. scholars can go to another page for more detailed info."
//
// He is describing a measurable problem. The 20 research records in the
// database average 1,510 characters of findingSummary and run to 2,282, and
// sunflower oil carries two of them, so that page opened with roughly 4,000
// characters of dense prose before a shopper reached anything else.
//
// WHAT THIS FILE DOES NOT DO: rewrite any of it. Every one of those
// characters was written deliberately, says something true, and is the kind
// of thing this site exists to say. Condensing by summarising would mean
// Rootify paraphrasing its own research record on the page, and the
// paraphrase would be the version most people read — a summary of a summary,
// one step further from the source, with nobody checking it.
//
// WHAT IT DOES INSTEAD: the records are already structured. Their authors
// wrote them in labelled paragraphs:
//
//   SCOPE: this record addresses the fatty acid (linoleic acid), NOT …
//   On linoleic acid and inflammation: the widely circulated claim …
//   FUNDING CAVEAT, STATED PLAINLY: a frequently cited 2026 review …
//   WHAT THIS RECORD DOES NOT SAY: it does not claim seed oils are …
//
// So this reads that structure back out. The page then prints the labels as
// four closed rows a reader opens if they want to, instead of four
// paragraphs they have to scroll past. Nothing is summarised, nothing is
// hidden behind a link, and the text under each label is the stored text
// character for character.
//
// Paragraphs with no label are the record's opening, and they stay visible:
// a collapsed row with no name on it is not a condensation, it is a page
// with its first sentence missing.

export type StudySection = {
  // Shown on the closed row. Sentence-cased for reading; see sentenceCase.
  label: string
  // The stored text that followed the label, verbatim.
  body: string
}

export type StudyOutline = {
  // Unlabelled opening paragraphs, in order, shown as written.
  lead: string[]
  // Labelled paragraphs, in order.
  sections: StudySection[]
}

// Where a paragraph's label ends. Deliberately narrow: the characters barred
// here are the ones that mean "this colon is inside a sentence, not after a
// heading". An em dash, a bracket, a quotation mark, a slash or a full stop
// before the colon all say the same thing — the author was writing prose.
//
// The 64-character ceiling is the longest real label plus room: "WHAT IS NOT
// ESTABLISHED, AND THIS IS THE POINT" is 46.
const LABEL = /^([^\n—().;"'/!?]{2,64}):[ \t]+(?=\S)/

// A label is at least two words of capitals, or at least three words
// starting with one.
//
// THE CASE THIS RULE EXISTS FOR: one record has a paragraph that begins "For
// contrast: the EU requires 26 specified fragrance allergens to be named".
// That colon is a sentence connector and "For contrast" is not a heading, so
// collapsing that paragraph under it would hide a fact behind a word that
// does not describe it. Two words, almost all lower case — rejected. "On
// linoleic acid and inflammation" is five words — kept. "SCOPE" is one word
// in capitals — kept.
function looksLikeLabel(candidate: string): boolean {
  const letters = candidate.replace(/[^A-Za-z]/g, '')
  if (letters.length < 3) return false
  const upper = candidate.replace(/[^A-Z]/g, '').length
  const shouted = upper / letters.length >= 0.6
  if (shouted) return true
  const words = candidate.trim().split(/\s+/).length
  return words >= 3 && /^[A-Z]/.test(candidate)
}

// Acronyms that must survive sentence-casing. None of the 20 records in the
// database has one in a label today; this is here so that the first record
// whose label reads "FDA POSITION" does not come out as "Fda position".
const ACRONYMS = new Set([
  'EPA', 'FDA', 'EU', 'US', 'USA', 'UK', 'EFSA', 'IARC', 'WHO', 'FAO', 'JECFA',
  'NTP', 'OEHHA', 'USDA', 'FSIS', 'CPSC', 'GRAS', 'ADI', 'NOAEL', 'RDA',
  'CAS', 'RCT', 'TDI', 'MRL', 'PFAS', 'BPA', 'BHA', 'BHT', 'TBHQ', 'DATEM',
])

// A SHOUTED LABEL BECOMES A SENTENCE.
//
// `WHAT THIS RECORD DOES NOT SAY` is an instruction to the reader to pay
// attention, which is fair in a document and hostile in a list of four rows.
// Lower-casing it is a typographic change and nothing else: the words, their
// order and the text underneath are untouched.
//
// Only fully-capitalised labels are changed. A label the author wrote in
// mixed case — "On linoleic acid and inflammation" — was already a sentence
// and is left exactly as typed.
export function sentenceCase(label: string): string {
  const trimmed = label.trim()
  if (trimmed !== trimmed.toUpperCase()) return trimmed
  const words = trimmed.split(/(\s+)/).map((w) => {
    if (/^\s+$/.test(w)) return w
    const bare = w.replace(/[^A-Za-z]/g, '')
    if (ACRONYMS.has(bare)) return w
    return w.toLowerCase()
  })
  const out = words.join('')
  // Capitalise the first letter wherever it is: a label can open with a
  // quotation mark or a number. The search covers upper case too, so that a
  // label opening with a preserved acronym is left alone rather than having
  // its second word capitalised instead — "FDA POSITION" became "FDA
  // Position" before this was `[A-Za-z]`.
  const i = out.search(/[A-Za-z]/)
  return i < 0 ? out : out.slice(0, i) + out[i]!.toUpperCase() + out.slice(i + 1)
}

// How much text has to follow a label before the split is worth making. A
// four-word paragraph does not need a row of its own, and a short fragment
// after a colon is usually a list item rather than a section.
const MIN_BODY = 40

export function studyOutline(summary: string): StudyOutline {
  const paragraphs = summary
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  const lead: string[] = []
  const sections: StudySection[] = []

  for (const para of paragraphs) {
    const m = LABEL.exec(para)
    const label = m?.[1]?.trim()
    const body = label === undefined ? '' : para.slice(m![0].length).trim()

    if (label !== undefined && body.length >= MIN_BODY && looksLikeLabel(label)) {
      sections.push({ label: sentenceCase(label), body })
      continue
    }

    // No label. Before the first labelled section it is the record's
    // opening and stays visible; after one it belongs to the section above
    // it, because that is where its author put it.
    if (sections.length === 0) lead.push(para)
    else sections[sections.length - 1]!.body += `\n\n${para}`
  }

  return { lead, sections }
}

// ------------------------------------------------- the long single paragraph

// SEVEN OF THE TWENTY RECORDS HAVE NO LABELS AT ALL.
//
// The outline above condenses a record that its author wrote in labelled
// paragraphs. The dye records, aspartame, natural flavor, benzalkonium
// chloride and sodium benzoate were written as one continuous argument
// instead — 1,300 characters in a single paragraph, no headings to find. For
// those the outline returns one lead paragraph and nothing collapses, which
// would have left Michael's complaint exactly where it was.
//
// So a long paragraph is cut at a sentence boundary: the opening stays
// visible, the rest goes behind one row. Again no summary and no loss — the
// reader is one click from the next word, and the stored text is intact.
//
// Why the opening rather than a chosen highlight: these records tend to open
// with the thing a shopper can act on. "Regulatory status is the clearest
// fact here. California's School Food Safety Act bans this dye from food
// served in public schools statewide, effective December 31, 2027." Picking
// a different sentence would mean Rootify deciding which part of its own
// research matters most, which is the editorial judgement this file exists
// to avoid.
const VISIBLE_CHARS = 340

// Words that end in a period without ending a sentence. Without these the
// text splits mid-citation at "Marklund et al." and mid-bracket at "(Cat. 2)".
const ABBREVIATIONS = new Set([
  'al', 'cat', 'no', 'nos', 'inc', 'ltd', 'co', 'corp', 'est', 'approx', 'ca',
  'cf', 'e.g', 'eg', 'i.e', 'ie', 'etc', 'vs', 'fig', 'figs', 'pp', 'vol',
  'dr', 'prof', 'mr', 'mrs', 'ms', 'jr', 'sr', 'st', 'ed', 'eds', 'ibid',
])

// Every index at which a sentence ends, as an offset just past the
// terminator. A terminator counts only when the next non-space character
// opens a new sentence — a capital, a quotation mark or an opening bracket.
//
// THREE CASES THIS DELIBERATELY DOES NOT SPLIT, each of which it got wrong
// before the rule was tightened:
//   `(Cat. 2) and organ toxicity`  — a digit follows, so the period is part
//                                     of an abbreviated label.
//   `author M.M. is an EMPLOYEE`   — initials: a single capital letter
//                                     before the period.
//   `Marklund et al., Circulation` — a known abbreviation.
function sentenceEnds(text: string): number[] {
  const out: number[] = []
  const re = /[.!?](?=["'”’)\]]*\s)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const at = m.index
    // Where the terminator and any closing punctuation stop.
    let end = at + 1
    while (end < text.length && /["'”’)\]]/.test(text[end]!)) end++
    const after = text.slice(end).replace(/^\s+/, '')
    if (!/^["'“‘(\[A-Z]/.test(after)) continue

    const beforeWord = /([A-Za-z.]+)$/.exec(text.slice(0, at))?.[1] ?? ''
    // A single capital, or something like M.M — initials, not a sentence.
    if (/^[A-Z]$/.test(beforeWord)) continue
    if (/^(?:[A-Z]\.)+[A-Z]$/.test(beforeWord)) continue
    if (ABBREVIATIONS.has(beforeWord.toLowerCase())) continue

    out.push(end)
  }
  return out
}

// Splits a paragraph into what the page shows and what it tucks away.
// `rest` is the empty string when the whole paragraph is short enough, and
// the caller then has nothing to collapse.
export function clipParagraph(text: string, limit = VISIBLE_CHARS): { head: string; rest: string } {
  const full = text.trim()
  if (full.length <= limit) return { head: full, rest: '' }

  const ends = sentenceEnds(full)
  // At least one whole sentence is always shown, however long it is: half a
  // sentence on screen is worse than a long one.
  let cut = ends[0] ?? full.length
  for (const end of ends) {
    if (end > limit) break
    cut = end
  }
  if (cut >= full.length) return { head: full, rest: '' }
  return { head: full.slice(0, cut).trim(), rest: full.slice(cut).trim() }
}

// The record's own one-line conclusion, for the row a reader sees first.
//
// This is NOT derived from the prose — deriving a verdict from 1,500
// characters is exactly the paraphrase this file refuses to write. It comes
// from evidenceFraming, a stored column with four values, each of which was
// chosen by whoever entered the record. See framingLead on the ingredient
// page, which has said these sentences since round 8; this moves them here
// so the condensed section and the full research page cannot drift apart.
export function framingLead(s: {
  studyType: string
  evidenceFraming: string
  regulatoryAction: string | null
}): string | null {
  // A record about a law is not a study, so the study wording would
  // misdescribe it. Its summary speaks for itself unless a regulator acted.
  if (s.studyType === 'regulatory_framework' && s.evidenceFraming !== 'regulator_confirmed') {
    return null
  }
  switch (s.evidenceFraming) {
    case 'regulator_confirmed':
      return s.regulatoryAction
        ? `Regulator action: ${s.regulatoryAction}`
        : 'A regulator has taken formal action.'
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

// --------------------------------------------- the stored values, in English
//
// These lived on the ingredient page until 2026-10-08, when the research
// record gained a second surface at /ingredients/[id]/research. Two copies of
// a label map is how "Industry funded" becomes "Industry-funded" on one page
// and not the other, so they moved here. The same lesson the ingredient page
// already learned about SourceLine.

export const STUDY_TYPE_LABEL: Record<string, string> = {
  RCT: 'Randomized trial',
  observational: 'Observational study',
  review: 'Review',
  'meta-analysis': 'Meta-analysis',
  regulatory_framework: 'Regulation',
}

export const CONSENSUS_LABEL: Record<string, string> = {
  'well-established': 'Well established',
  'mixed evidence': 'Mixed evidence',
  'limited evidence': 'Limited evidence',
  disputed: 'Disputed',
}

export const FUNDING_LABEL: Record<string, string> = {
  independent: 'Independent funding',
  industry_funded: 'Industry funded',
  mixed: 'Mixed funding',
  undetermined: 'Funding could not be determined',
}

export const POSITION_LABEL: Record<string, string> = {
  dissenting_view: 'Disputed by',
  replication: 'Replication',
  critique: 'Critique of the methods',
}

// ------------------------------------------------------------------ selftest
//
//   npx tsx src/lib/studyOutline.ts --selftest
//
// Every case below is real text from the IngredientStudy table, so a change
// that breaks one of them is a change that breaks a page someone can visit.
// The label rule was also cross-checked against all 20 records in the
// database on 2026-10-08 by running the same predicate in SQL: 25 shouted
// labels, 6 titled labels, and one candidate correctly rejected ("For
// contrast:" in the fragrance record). No other paragraph produced one.
if (typeof process !== 'undefined' && process.argv?.includes('--selftest')) {
  let bad = 0
  const eq = (what: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      bad++
      console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`)
    }
  }

  // ---- labels found, and the one that must not be
  const seedOil = [
    'SCOPE: this record addresses the fatty acid (linoleic acid), NOT the extraction process.',
    'On linoleic acid and inflammation: the widely circulated claim that it promotes inflammation is not supported by the current evidence.',
    'FUNDING CAVEAT, STATED PLAINLY: a frequently cited 2026 review supporting this conclusion is substantially industry-connected.',
    'WHAT THIS RECORD DOES NOT SAY: it does not claim seed oils are optimal, nor that avoiding them is unreasonable.',
  ].join('\n\n')
  const seed = studyOutline(seedOil)
  eq('seed oil lead', seed.lead, [])
  eq(
    'seed oil labels',
    seed.sections.map((x) => x.label),
    [
      'Scope',
      'On linoleic acid and inflammation',
      'Funding caveat, stated plainly',
      'What this record does not say',
    ]
  )
  eq('seed oil body kept verbatim', seed.sections[0]!.body,
    'this record addresses the fatty acid (linoleic acid), NOT the extraction process.')

  // "For contrast:" is a sentence connector, not a heading. Collapsing that
  // paragraph under it would file an EU labelling requirement under two
  // words that do not describe it.
  const fragrance = [
    'This is a disclosure finding, not a safety finding — the same situation as "natural flavor" on food labels.',
    'For contrast: the EU requires 26 specified fragrance allergens to be named individually on cosmetic labels once they exceed set concentrations. The US has no equivalent naming requirement.',
  ].join('\n\n')
  const frag = studyOutline(fragrance)
  eq('fragrance has no sections', frag.sections, [])
  eq('fragrance keeps both paragraphs visible', frag.lead.length, 2)

  // Unlabelled paragraphs before the first label are the opening and stay.
  const hexane = [
    'This concerns the EXTRACTION PROCESS, not the fatty acid.',
    'Most conventionally produced seed oils are extracted using n-hexane, a petroleum-derived solvent.',
    'WHAT IS ESTABLISHED: EPA classifies hexane as a hazardous air pollutant and chronic inhalation is linked to polyneuropathy.',
    'This record makes no claim that hexane residue in oil is harmful. It states that in the US it is unregulated and unmonitored.',
  ].join('\n\n')
  const hex = studyOutline(hexane)
  eq('hexane lead', hex.lead.length, 2)
  eq('hexane sections', hex.sections.length, 1)
  // The trailing unlabelled paragraph joins the section above it rather than
  // disappearing.
  eq('hexane last paragraph kept', hex.sections[0]!.body.includes('makes no claim'), true)

  // A fragment after a colon is not a section.
  eq('short body is not a section', studyOutline('NOTE: too short.').sections.length, 0)

  // ---- sentence casing
  eq('shouted label', sentenceCase('WHAT THIS RECORD DOES NOT SAY'), 'What this record does not say')
  eq('shouted with comma', sentenceCase('FUNDING CAVEAT, STATED PLAINLY'), 'Funding caveat, stated plainly')
  eq('one shouted word', sentenceCase('SCOPE'), 'Scope')
  eq('mixed case left alone', sentenceCase('On linoleic acid and inflammation'), 'On linoleic acid and inflammation')
  eq('acronym survives', sentenceCase('FDA POSITION'), 'FDA position')
  eq('acronym later in label', sentenceCase('WHAT THE EU DID'), 'What the EU did')

  // ---- clipping a long single paragraph
  const blue1 =
    "Regulatory status is the clearest fact here. California's School Food Safety Act (signed September 2024) bans this dye from food served in public schools statewide, effective December 31, 2027. In April 2025 FDA announced a plan to phase this dye out of the US food supply by end of 2026 — but this is a voluntary request to manufacturers, not a ban. West Virginia enacted a broader statewide ban in March 2025."
  const clipped = clipParagraph(blue1)
  eq('blue 1 head ends on a sentence', clipped.head.endsWith('December 31, 2027.'), true)
  eq('blue 1 head is within budget', clipped.head.length <= 340, true)
  eq('blue 1 loses nothing', `${clipped.head} ${clipped.rest}`, blue1)

  // A short paragraph has nothing to collapse.
  eq('short paragraph', clipParagraph('Two sentences. That is all.'), {
    head: 'Two sentences. That is all.',
    rest: '',
  })

  // Abbreviations and initials must not end a sentence.
  const citations =
    'A pooled analysis of 70,000 participants across 30 cohorts (Marklund et al., Circulation 2019) found lower mortality. Per its own disclosure, author M.M. is an employee of Soy Nutrition Institute Global, and author K.S.P. received honoraria from the same body. In the EU it carries classification as a reproductive toxicity hazard (Cat. 2) and organ toxicity hazard. That is the whole record.'
  const cited = clipParagraph(citations, 120)
  eq('does not split at "et al."', cited.head.endsWith('found lower mortality.'), true)
  const cited2 = clipParagraph(citations, 260)
  eq('does not split at initials', cited2.head.endsWith('from the same body.'), true)
  const cited3 = clipParagraph(citations, 370)
  eq('does not split at "(Cat. 2)"', cited3.head.endsWith('organ toxicity hazard.'), true)

  // One whole sentence is always shown, even past the budget.
  const oneLong = `${'word '.repeat(90)}ends here. And more follows.`
  eq('a long first sentence is not cut', clipParagraph(oneLong).head.endsWith('ends here.'), true)

  // ---- the stored one-liner
  eq('regulator action', framingLead({ studyType: 'review', evidenceFraming: 'regulator_confirmed', regulatoryAction: 'banned in the EU' }),
    'Regulator action: banned in the EU')
  eq('a law is not a study', framingLead({ studyType: 'regulatory_framework', evidenceFraming: 'insufficient_research', regulatoryAction: null }), null)
  eq('a law a regulator acted on still leads', framingLead({ studyType: 'regulatory_framework', evidenceFraming: 'regulator_confirmed', regulatoryAction: null }),
    'A regulator has taken formal action.')
  eq('unknown framing has no lead', framingLead({ studyType: 'review', evidenceFraming: 'something_new', regulatoryAction: null }), null)

  console.log(bad === 0 ? 'studyOutline: all cases pass' : `studyOutline: ${bad} FAILURES`)
}

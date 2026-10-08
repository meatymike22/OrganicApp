// WHAT A RECALL NOTICE SAYS, IN PLAIN WORDS.
//
// Michael, 2026-10-07: "for the layman, these recalls and notices need to be
// heavily condensed and explained to a 5 year old (not in baby talk but in
// concise simple terms)... if someone more technical wants to review all of
// the numbers, the acronyms, etc then they can click on the recall and record
// and go to that page."
//
// So this turns an agency's own sentence into one short one. Three rules, and
// the first is the only one that matters:
//
//   1. IT NEVER ADDS AND NEVER SOFTENS. Every sentence below restates the
//      hazard the notice names and nothing else. It does not say a product is
//      dangerous, does not say anyone was harmed, and does not reassure.
//      "May contain" stays "may contain", because that is what a recall for a
//      potential contaminant says.
//
//   2. THE AGENCY'S OWN WORDING IS ALWAYS STILL ON THE PAGE. This is a
//      summary shown ALONGSIDE the verbatim text, never instead of it. The
//      card shows this; the notice's own words sit behind the chevron and on
//      /recalls/[id]. A reader can always check our paraphrase against the
//      original, which is the only reason paraphrasing is defensible at all.
//
//   3. AN UNRECOGNISED REASON RETURNS null. The caller then prints the
//      agency's sentence unchanged. A borrowed summary that happens to be
//      wrong is far worse than a technical sentence — so when in doubt this
//      module says nothing rather than guessing.
//
// This is deliberately rule-based rather than AI-drafted. The project's AI
// plan requires a human review step before anything AI-written is published,
// and 19,950 notices cannot be reviewed one at a time. A rule is reviewable
// once, here, and every sentence it can emit is in this file to be read.
//
// Coverage measured on the live database, 2026-10-07: these rules classify
// about 18,000 of 19,950 notices. The rest fall through to rule 3.

export type PlainReason = {
  // The one short sentence.
  text: string
  // A stable key for the hazard, for grouping or counting later. Not shown.
  kind: string
}

// Ordered, most specific first — a notice naming both listeria and a label
// error is reported as the listeria one, because that is the hazard.
//
// `extract` pulls the specific thing out of the notice (which allergen, which
// material) so the sentence can name it. When it finds nothing, `text` is used
// as written.
const RULES: {
  kind: string
  match: RegExp
  text: string
  extract?: { pattern: RegExp; into: string }
}[] = [
  {
    kind: 'listeria',
    match: /listeria/i,
    text: 'May contain listeria, a germ that can cause serious illness.',
  },
  {
    kind: 'salmonella',
    match: /salmonella/i,
    text: 'May contain salmonella, a germ that causes food poisoning.',
  },
  {
    kind: 'ecoli',
    match: /e\.? ?coli|o157|\bstec\b/i,
    text: 'May contain E. coli, a germ that causes food poisoning.',
  },
  {
    kind: 'botulism',
    match: /botulin|botulism|clostridium/i,
    text: 'Risk of botulism, a rare but serious kind of poisoning.',
  },
  {
    kind: 'hepatitis',
    match: /hepatitis|norovirus|cyclospora/i,
    text: 'May carry a virus or parasite that causes illness.',
  },
  {
    kind: 'allergen',
    // The big one: 4,297 notices. Naming the allergen is the whole value.
    match: /undeclared|undisclosed|not declared|allergen|does not declare|fails to declare/i,
    text: 'Contains something the label does not mention, which matters if you are allergic.',
    extract: {
      pattern:
        /\b(milk|dairy|egg|eggs|peanut|peanuts|tree nut|tree nuts|almond|almonds|cashew|cashews|walnut|walnuts|pecan|pecans|pistachio|pistachios|hazelnut|hazelnuts|macadamia|soy|soya|wheat|gluten|fish|anchovy|anchovies|shellfish|shrimp|crab|lobster|sesame|mustard|sulfite|sulfites|sulphite|sulphites|coconut|lupin|celery)\b/i,
      into: 'Contains {X} without saying so on the label, which matters if you are allergic to it.',
    },
  },
  {
    kind: 'foreign-material',
    match: /foreign (material|matter|object|bod)|\bmetal\b|\bglass\b|plastic|\brubber\b|\bwood\b|\bstones?\b|wire|bone fragment/i,
    text: 'May contain small pieces of something that should not be in food.',
    extract: {
      pattern: /\b(metal|glass|plastic|rubber|wood|stones?|wire|bone)\b/i,
      into: 'May contain small pieces of {X}.',
    },
  },
  {
    kind: 'heavy-metals',
    match: /\blead\b|cadmium|arsenic|mercury|heavy metal/i,
    text: 'May contain too much of a harmful metal.',
    extract: {
      pattern: /\b(lead|cadmium|arsenic|mercury)\b/i,
      into: 'May contain too much {X}.',
    },
  },
  {
    kind: 'temperature',
    match: /temperature|not (kept|held) (cold|refrigerated)|refrigerat|cold chain|thaw/i,
    text: 'Was not kept cold enough before it reached the shop.',
  },
  {
    kind: 'cross-contact',
    match: /same (equipment|line|facility)|cross.?contact|cross.?contaminat/i,
    text: 'Made on equipment used for another food, which may have got into it.',
  },
  {
    kind: 'unsanitary',
    match: /insanitary|unsanitary|sanitation|sanitizer|rodent|insect|\bpest\b|filth/i,
    text: 'Made or stored in conditions that were not clean enough.',
  },
  {
    kind: 'spoilage',
    match: /\bmold\b|\bmould\b|yeast|spoil|ferment|bloat|rancid/i,
    text: 'May have spoiled, fermented or grown mould.',
  },
  {
    kind: 'chemical',
    match: /chloramphenicol|cyclamate|pesticid|sanitiz\w* residue|cleaning (solution|agent|chemical)|caustic|ammonia|impurit|degradation/i,
    text: 'May contain a chemical that should not be in it.',
  },
  {
    kind: 'no-inspection',
    match: /without (the )?benefit of (federal )?inspection|uninspected/i,
    text: 'Sold without the federal inspection the law requires.',
  },
  {
    kind: 'process',
    match: /\bc?gmp\b|good manufacturing|under.?process|processing deviation|not properly (cooked|pasteurized|processed)|pasteuri/i,
    text: 'A step in how it was made did not go to plan.',
  },
  {
    kind: 'mislabelled',
    match: /misbrand|mislabel|incorrect label|wrong label|label(l?ing)? error|not identifying|do(es)? not include ingredients/i,
    text: 'The label was wrong about what is inside.',
  },
  // CPSC hazard labels. These arrive as two or three words rather than a
  // sentence ("Choking", "Fire & Fire-Related Burn", "Fall"), which is why
  // they are matched last: a food notice mentioning a fire at a plant should
  // not be summarised as a fire hazard.
  {
    kind: 'choking',
    match: /^choking|choking hazard/i,
    text: 'Could be a choking hazard, especially for small children.',
  },
  {
    kind: 'fire',
    match: /^fire|fire-related burn|burn hazard|overheat/i,
    text: 'Could overheat, catch fire or cause burns.',
  },
  {
    kind: 'injury',
    match: /^(fall|laceration|impact|entrapment|strangulation|drowning)/i,
    text: 'Could cause injury if it breaks or is used as intended.',
  },
  {
    kind: 'contamination-generic',
    // Last resort among the matches: 201 notices say only "Product
    // Contamination". Vague, but vague-and-true beats the raw phrase.
    match: /contaminat/i,
    text: 'Something may have got into the product that should not be there.',
  },
]

export function plainReason(reason: string | null | undefined): PlainReason | null {
  if (!reason) return null
  const r = reason.trim()
  if (!r) return null

  for (const rule of RULES) {
    if (!rule.match.test(r)) continue
    if (rule.extract) {
      const m = r.match(rule.extract.pattern)
      if (m) {
        // "stones in product" captures "stones"; "pieces of stones" reads
        // badly. Only this one plural needs it, so it is a lookup rather
        // than a general singulariser that would mangle "glass".
        const PLURAL: Record<string, string> = { stones: 'stone', eggs: 'egg', sulfites: 'sulfite', sulphites: 'sulphite' }
        const raw = m[1].toLowerCase()
        const found = PLURAL[raw] ?? raw
        return { kind: rule.kind, text: rule.extract.into.replace('{X}', found) }
      }
    }
    return { kind: rule.kind, text: rule.text }
  }
  return null
}

// --------------------------------------------------------------- self test
// Run with: npx tsx src/lib/plainRecall.ts --selftest
// Cases are real reason strings from the database, plus the traps.

const CASES: { reason: string; expectKind: string | null; expectIn?: string }[] = [
  { reason: 'Product may be contaminated with Listeria monocytogenes', expectKind: 'listeria' },
  { reason: 'Possible Salmonella contamination', expectKind: 'salmonella' },
  { reason: 'Product contains undeclared milk', expectKind: 'allergen', expectIn: 'milk' },
  { reason: 'Undeclared peanuts and tree nuts', expectKind: 'allergen', expectIn: 'peanut' },
  // Allergen with no allergen we recognise: must fall back, not invent one.
  { reason: 'Product contains an undeclared ingredient', expectKind: 'allergen', expectIn: 'does not mention' },
  { reason: 'May contain small metal fragments from wire mesh sifter.', expectKind: 'foreign-material', expectIn: 'metal' },
  { reason: 'Potential presence of food-grade rubber pieces.', expectKind: 'foreign-material', expectIn: 'rubber' },
  { reason: 'Possible presence of stones in product', expectKind: 'foreign-material', expectIn: 'stone' },
  { reason: 'Potential contamination with plastic material', expectKind: 'foreign-material', expectIn: 'plastic' },
  { reason: 'The jewelry can contain high levels of lead.', expectKind: 'heavy-metals', expectIn: 'lead' },
  { reason: 'Products were not held at an appropriate temperature due to a mechanical malfunction', expectKind: 'temperature' },
  { reason: 'Product may have been sliced on the same equipment where the mortadella with pistachios was sliced', expectKind: 'cross-contact' },
  { reason: 'Various vegetable and fruit products are recalled due to inadequate sanitizer in wash water.', expectKind: 'unsanitary' },
  { reason: 'Product Contamination', expectKind: 'contamination-generic' },
  { reason: 'Choking', expectKind: 'choking' },
  { reason: 'Fire & Fire-Related Burn', expectKind: 'fire' },
  { reason: 'Fall', expectKind: 'injury' },
  { reason: 'Frozen desserts do not include ingredients on the labeling.', expectKind: 'mislabelled' },
  { reason: 'Without benefit of federal inspection', expectKind: 'no-inspection' },
  // LISTERIA WINS over the label wording in the same sentence: the hazard is
  // the hazard, and ordering is what guarantees it.
  { reason: 'Undeclared milk and possible Listeria monocytogenes contamination', expectKind: 'listeria' },
  // Unrecognised: must return null so the caller prints the original.
  { reason: 'Firm initiated recall is ongoing at the request of the agency', expectKind: null },
  { reason: '', expectKind: null },
]

function selfTest(): boolean {
  let pass = 0
  for (const c of CASES) {
    const got = plainReason(c.reason)
    const kindOk = (got?.kind ?? null) === c.expectKind
    const textOk = !c.expectIn || (got?.text ?? '').toLowerCase().includes(c.expectIn.toLowerCase())
    const ok = kindOk && textOk
    if (ok) pass++
    const label = `${c.reason.slice(0, 54)}${c.reason.length > 54 ? '…' : ''}`
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${label}\n        -> ${got ? `[${got.kind}] ${got.text}` : '(no summary; original shown)'}`
    )
  }
  console.log(`\n${pass}/${CASES.length} passed.`)
  return pass === CASES.length
}

// GUARDED. This module lives in src/lib and is bundled into the app, so a
// bare process.argv at module scope would throw in any runtime that has no
// process (an edge runtime, a client bundle). The selftest only ever runs
// when the file is invoked directly with npx tsx.
if (typeof process !== 'undefined' && process.argv?.includes('--selftest')) {
  process.exitCode = selfTest() ? 0 : 1
}

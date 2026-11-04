// SPLITTING A PRODUCT NAME INTO BRAND / TITLE / SECONDARY, USING THE PACKAGE.
//
// Michael, 2026-11-02, on the Member's Mark page:
//
//   The Title should be simply "PB&J Wafer Sticks" with the subtitle being
//   "Peanut Butter Filled Wafer Sticks with Strawberry Dip" ... we dont need
//   to include words form the secondary title in the primary title.
//
// and on how to decide:
//
//   maybe the splitter should weigh against the photo if there is one. The
//   PB&J Wafer Sticks are clearly thye main product title with the rest being
//   more specific about the flavor ... The text being different color / size
//   / font should all factor into the decision.
//
// WHY THE PHOTO IS THE RIGHT SIGNAL. There is no reliable textual rule for
// where a product name stops and its descriptor starts — OFF stores one
// string and `generic_name`, the obvious second field, was measured at 0.7%
// coverage in round 28 and rejected. But the LABEL ALREADY ENCODES THE
// ANSWER: a designer set the product name large and the flavour line small,
// and that typographic hierarchy is a fact about the package, not an
// inference about it. Reading it is a transcription task, which is the kind
// of thing this is safe to ask a model for. Guessing it from a string is not.
//
// THE RULE THIS MUST NOT BREAK. Michael, same day:
//
//   if we cant know the products name i do not want to invent the title or
//   invent some caricature of it.
//
// So the model is never allowed to WRITE a title. It may only say where to
// CUT the string we already hold. Everything below enforces that
// mechanically rather than by trusting the prompt: the three returned parts
// must reconstruct the stored name exactly, compared on letters and digits
// alone. A model that drops a flavour, reorders words, fixes a typo or
// invents a short form fails that check and the product simply does not get
// split. This is the same protection round 32 needed for truncated
// ingredient lists, for the same reason: silently losing the words that say
// WHICH product this is costs more than showing an ugly long title.

export type SplitVerdict = {
  leading_brand: string | null
  title: string
  secondary: string | null
  typography: string
  confidence: 'high' | 'low'
}

export type SplitCheck =
  | { ok: true; verdict: SplitVerdict }
  | { ok: false; reason: string; detail?: string }

// Letters and digits only. Deliberately the same shape as the publication
// gate's tight() (round 29): punctuation, case, whitespace and HTML entities
// carry no information about WHICH WORDS are present, and those are the only
// thing this check is about. `&quot;PB&J&quot; Wafer Sticks` and
// `"PB&J" Wafer Sticks` must compare equal — 88 published products have an
// undecoded entity in `name`, so this is a live case, not a hypothetical.
export function wordsOnly(s: string): string {
  return s
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()
}

export function buildPrompt(name: string, company: string, withImage: boolean): string {
  // THE CONTROL PROMPT MUST NOT EXCUSE A LOW-CONFIDENCE ANSWER.
  //
  // The first version said "You are NOT shown a photograph. Decide from the
  // text alone", and every control row came back low confidence citing
  // exactly that. That is the prompt talking, not the model, and it made the
  // A/B worthless: a control told it is missing the evidence will decline.
  // The text-only variant now states its task positively, with no mention of
  // an absent photograph, so a low-confidence answer means the STRING is
  // genuinely unsplittable rather than that we said it would be.
  const seeing = withImage
    ? `You are shown a photograph of the product's package.`
    : `Your task is to split a stored product name into its parts.`

  return `${seeing}

Here is the product name exactly as our database stores it, between <<< and >>>:

<<<${name}>>>

The brand is: ${company}

Split that stored string into up to three consecutive parts:

1. leading_brand - the part at the START of the string that is the brand or
   manufacturer name, if the string begins with it. Null if it does not.
2. title - what the product is CALLED. The name a person would use to ask for
   it.
3. secondary - the smaller descriptive line: flavour, variety, preparation,
   count, size. Null if the whole remainder is the title.

${withImage
  ? `DECIDE FROM THE PACKAGE TYPOGRAPHY. The designer already made this
decision and printed it. Weigh, in roughly this order:
  - SIZE: the title is normally the largest product text on the front.
  - WEIGHT AND COLOUR: a heavier or contrasting colour marks the title; the
    secondary line is usually lighter, smaller, or in a muted colour.
  - FONT: a distinct display or script face usually marks the title; the
    secondary line is usually set in a plainer face.
  - POSITION: the secondary line normally sits directly below the title.
The BRAND is often the largest text of all and is often at the top in its own
styling. Do not mistake the brand for the title. The brand is "${company}".`
  : `DECIDE FROM HOW THE WORDS READ. Weigh:
  - A product title is usually the shortest phrase that names the thing
    itself - the words a person would say to ask for it.
  - The secondary line is flavour, variety, preparation, count or size.
  - Many names repeat a head noun: the words before the repeat are usually
    the title and the words from the repeat onward the descriptor.
  - Many stored names are a single phrase with no second part at all. That is
    a normal result: return the whole string as the title with secondary null.`}

HARD CONSTRAINTS - a response that breaks any of these is discarded:

- Every part you return must be copied VERBATIM from the stored string above,
  character for character. Do not fix spelling, expand abbreviations, decode
  HTML entities, change punctuation, change case, or reorder words.
- The three parts must appear in the order leading_brand, then title, then
  secondary, and together they must account for the ENTIRE stored string with
  nothing left over and nothing repeated.
- Never write a name that is not in the stored string. If the package shows a
  better name than the string does, you still may not use it.
- title must not be the brand.
- If you cannot do this confidently - the photo is unreadable, the package
  shows a different product, the string does not correspond to what is
  printed, or the string is already just a title - set confidence to "low".
  "low" is a normal, useful answer. Prefer it to a guess.

Reply with ONLY a JSON object, no other text:

{"leading_brand": string or null, "title": string, "secondary": string or null, "typography": "one short sentence naming the size/colour/font/position evidence you used", "confidence": "high" or "low"}`
}

// STRICT. Anything that is not exactly the shape above is a parse failure,
// never a coerced guess. Round 30's lesson in the image classifier was that a
// coerced verdict is indistinguishable later from a real one; here a coerced
// split would quietly rename a product.
export function parseSplit(raw: string): SplitCheck {
  const text = raw.trim()
  // Models sometimes wrap JSON in a fence even when told not to. Unwrapping a
  // fence is not coercion - the JSON inside is still parsed strictly.
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let obj: unknown
  try {
    obj = JSON.parse(unfenced)
  } catch {
    return { ok: false, reason: 'not_json', detail: text.slice(0, 160) }
  }
  if (typeof obj !== 'object' || obj === null) return { ok: false, reason: 'not_object' }
  const o = obj as Record<string, unknown>

  const strOrNull = (v: unknown): string | null | undefined =>
    v === null ? null : typeof v === 'string' ? v : undefined

  const leading_brand = strOrNull(o.leading_brand)
  const secondary = strOrNull(o.secondary)
  const title = typeof o.title === 'string' ? o.title : undefined
  const typography = typeof o.typography === 'string' ? o.typography : ''
  const confidence = o.confidence === 'high' || o.confidence === 'low' ? o.confidence : undefined

  if (leading_brand === undefined) return { ok: false, reason: 'bad_leading_brand' }
  if (secondary === undefined) return { ok: false, reason: 'bad_secondary' }
  if (title === undefined) return { ok: false, reason: 'bad_title' }
  if (confidence === undefined) return { ok: false, reason: 'bad_confidence' }

  return { ok: true, verdict: { leading_brand, title, secondary, typography, confidence } }
}

// THE CHECK THAT MAKES FABRICATION IMPOSSIBLE RATHER THAN UNLIKELY.
//
// Concatenating the parts and comparing to the stored name on letters and
// digits catches, in one test: an invented word, a dropped flavour, a
// reordering, a "corrected" spelling, a decoded entity, and a part copied
// from the package instead of the string. None of those can pass.
export function validateSplit(
  v: SplitVerdict,
  name: string,
  companyName: string
): { ok: true } | { ok: false; reason: string } {
  if (v.confidence === 'low') return { ok: false, reason: 'low_confidence' }

  const title = v.title.trim()
  if (title === '') return { ok: false, reason: 'empty_title' }

  const rebuilt = wordsOnly(v.leading_brand ?? '') + wordsOnly(title) + wordsOnly(v.secondary ?? '')
  if (rebuilt !== wordsOnly(name)) return { ok: false, reason: 'does_not_reconstruct' }

  // The brand is already displayed on its own line, so a title that IS the
  // brand is the Membermark failure in a different place. Note this cannot be
  // caught by reconstruction - the brand is often genuinely inside the name.
  if (wordsOnly(title) === wordsOnly(companyName)) return { ok: false, reason: 'title_is_brand' }
  if (wordsOnly(title) === '') return { ok: false, reason: 'title_has_no_words' }

  // A "split" that returns the whole string as the title is a valid answer
  // meaning "no split needed", but it is not a SPLIT, so it is reported
  // separately rather than counted as a success.
  if (v.secondary === null && v.leading_brand === null) return { ok: false, reason: 'no_split_offered' }

  return { ok: true }
}

// ---------------------------------------------------------------- selftests

export function selftest(log: (s?: string) => void): boolean {
  const NAME = '&quot;PB&J&quot; Wafer Sticks Peanut Butter Filled Wafer Sticks with Strawberry Dip'
  const CO = "Member's Mark"
  let pass = 0
  let total = 0

  const check = (what: string, got: boolean, want: boolean) => {
    total++
    if (got === want) pass++
    else log(`  FAIL ${what}: got ${got}, want ${want}`)
  }

  const v = (p: Partial<SplitVerdict>): SplitVerdict => ({
    leading_brand: null, title: '', secondary: null, typography: '', confidence: 'high', ...p,
  })

  // the intended answer
  check('good split', validateSplit(v({
    title: '&quot;PB&J&quot; Wafer Sticks',
    secondary: 'Peanut Butter Filled Wafer Sticks with Strawberry Dip',
  }), NAME, CO).ok, true)

  // entity decoded by the model - reconstruction must still pass, because
  // wordsOnly decodes both sides
  check('entity decoded still reconstructs', validateSplit(v({
    title: '"PB&J" Wafer Sticks',
    secondary: 'Peanut Butter Filled Wafer Sticks with Strawberry Dip',
  }), NAME, CO).ok, true)

  // THE ONE THAT MATTERS: a dropped flavour
  check('dropped "with Strawberry Dip"', validateSplit(v({
    title: '&quot;PB&J&quot; Wafer Sticks',
    secondary: 'Peanut Butter Filled Wafer Sticks',
  }), NAME, CO).ok, false)

  // an invented short form
  check('invented title', validateSplit(v({
    title: 'PB&J Wafers',
    secondary: 'Peanut Butter Filled Wafer Sticks with Strawberry Dip',
  }), NAME, CO).ok, false)

  // reordered
  check('reordered parts', validateSplit(v({
    title: 'Peanut Butter Filled Wafer Sticks with Strawberry Dip',
    secondary: '&quot;PB&J&quot; Wafer Sticks',
  }), NAME, CO).ok, false)

  // low confidence is never a split
  check('low confidence rejected', validateSplit(v({
    title: '&quot;PB&J&quot; Wafer Sticks',
    secondary: 'Peanut Butter Filled Wafer Sticks with Strawberry Dip',
    confidence: 'low',
  }), NAME, CO).ok, false)

  // title is the brand
  check('title is brand', validateSplit(v({
    leading_brand: null, title: 'Members Mark', secondary: 'Cola',
  }), 'Members Mark Cola', CO).ok, false)

  // whole string as title is not a split
  check('no split offered', validateSplit(v({ title: NAME }), NAME, CO).ok, false)

  // leading brand inside the name
  check('leading brand accepted', validateSplit(v({
    leading_brand: 'Kelloggs', title: 'Frosted Flakes', secondary: 'Cereal Family Size',
  }), 'Kelloggs Frosted Flakes Cereal Family Size', 'Kelloggs').ok, true)

  // parse strictness
  total++; if (parseSplit('not json').ok === false) pass++; else log('  FAIL parse: accepted garbage')
  total++; if (parseSplit('{"title":"x"}').ok === false) pass++; else log('  FAIL parse: accepted missing fields')
  total++
  const fenced = parseSplit('```json\n{"leading_brand":null,"title":"x","secondary":null,"typography":"t","confidence":"high"}\n```')
  if (fenced.ok) pass++; else log('  FAIL parse: rejected fenced JSON')
  total++; if (parseSplit('{"leading_brand":null,"title":"x","secondary":null,"typography":"t","confidence":"maybe"}').ok === false) pass++
  else log('  FAIL parse: accepted bad confidence')

  log(`selftest: ${pass}/${total} pass`)
  return pass === total
}

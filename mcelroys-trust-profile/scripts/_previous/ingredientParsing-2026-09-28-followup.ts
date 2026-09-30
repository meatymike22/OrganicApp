// SNAPSHOT of src/lib/ingredientParsing.ts exactly as it was when
// repair-ingredients-followup.ts ran live on 2026-09-28. Used only by
// repair-ingredients-followup2.ts to know what that run did. Delete both
// once the follow-ups are finished.

// Shared ingredient-list parsing, used by BOTH ingest-openfoodfacts.ts and
// ingest-openbeautyfacts.ts. Extracted into one module for the same reason as
// the classification rules: two copies inevitably drift apart.
//
// Every name this returns has been through normalizeIngredientName() (see
// ingredientNormalization.ts), so "Carrots", "carrot*" and "CARROTS" all come
// out as "carrot" and land on the same Ingredient row.
import { normalizeIngredient, normalizeIngredientName } from '@/lib/ingredientNormalization'

export type ParsedIngredient = {
  name: string
  isOrganicSourced: boolean
  // 1-indexed position in the ingredient list. Meaningful because FDA requires
  // descending order of predominance by weight — see ProductIngredient.listPosition
  listPosition: number
  // True when the label explicitly marks this as a minor/trace component
  isTrace: boolean
  // The label's own concentration qualifier, if any ("2% or less", "trace")
  concentrationNote: string | null
}

// Markers that indicate everything FOLLOWING them on the label is a minor
// component. "Contains 2% or less of:" is extremely common on US food labels
// and is an explicit manufacturer statement about concentration.
// Any percentage is accepted ("less than 0.5% of", "1% or less of", "not
// more than 2% of") — the 2026-09-28 review found 941 ingredient names that
// still carried such a phrase because only the 2% wordings were recognised.
const TRACE_SECTION_PATTERNS: { pattern: RegExp; note: (m: RegExpMatchArray) => string }[] = [
  { pattern: /(?:contains\s+)?(\d+(?:\.\d+)?)\s*(?:%|percent)\s+or\s+less\s+of/i, note: (m) => `${m[1]}% or less` },
  { pattern: /(?:contains\s+)?(one|two|three)\s+percent\s+or\s+less\s+of(?:\s+the\s+following)?/i, note: (m) => `${{ one: 1, two: 2, three: 3 }[m[1].toLowerCase() as 'one' | 'two' | 'three']}% or less` },
  { pattern: /(?:contains\s+)?(?:less\s+than|not\s+more\s+than|no\s+more\s+than)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)\s+of/i, note: (m) => `less than ${m[1]}%` },
  { pattern: /\btrace\s+amounts?\s+of/i, note: () => 'trace' },
  { pattern: /\bcontains\s+trace\s+of/i, note: () => 'trace' },
]

// Processing terms that describe how BOTH halves were made:
// "hydrolyzed soy and corn protein" → hydrolyzed corn protein.
// ("disodium" is NOT one: "disodium phosphate and sodium citrate" are two
// different salts. It's only carried onto a single word — see below.)
const PROCESSING_MODIFIERS = ['partially hydrogenated', 'fully hydrogenated', 'hydrogenated', 'hydrolyzed', 'expeller pressed', 'expeller-pressed']

// Modifiers that, in "dehydrated onion and garlic", apply to both halves
// when the second half is a single word — so it becomes "dehydrated garlic".
const SHARED_MODIFIERS = new Set([
  'disodium', 'dehydrated', 'dried', 'pasteurized', 'roasted', 'ground',
  'toasted', 'fresh', 'cultured', 'powdered', 'granulated', 'minced',
  'diced', 'chopped', 'cooked', 'frozen', 'sliced', 'crushed',
])

// Names that contain "and" but are ONE ingredient, never split even when
// both halves exist as ingredients on their own. Normalized form.
const NEVER_SPLIT = new Set([
  // ("natural and artificial flavor" and "fruit and vegetable juice" ARE
  // split: the label says the product contains both, and the 2026-09-28
  // repair stored them that way — natural flavor + artificial flavor.)
  'mono and diglycerides', 'half and half', 'sweet and sour',
  'macaroni and cheese', 'peanut butter and jelly', 'beans and rice',
  'live and active cultures', 'salt and vinegar',
  'sour cream and onion', 'cookies and cream', 'rice and beans',
])

// Words that are the head of an ingredient name. In "canola and/or
// sunflower oil" the "oil" belongs to both; in "corn syrup and/or sugar"
// the first part already has its own head ("syrup"), so nothing is added.
const HEAD_NOUNS = new Set([
  'oil', 'oils', 'syrup', 'flour', 'flours', 'starch', 'gum', 'sugar', 'juice',
  'extract', 'powder', 'lecithin', 'protein', 'fiber', 'meal', 'butter',
  'vinegar', 'salt', 'concentrate', 'solids', 'cheese', 'milk', 'cream',
  'flavor', 'flavors', 'flavoring', 'color', 'acid', 'acids', 'shortening',
])

export type ParseOptions = {
  // When given, a name like "sodium benzoate and potassium sorbate" is split
  // into its two ingredients IF both halves are already known ingredients.
  // (Without a list of known names there's no safe way to tell that apart
  // from a single substance with "and" in its name.) 10,371 such combined
  // rows were found in the 2026-09-28 review.
  isKnownIngredient?: (normalizedName: string) => boolean
}

// Splits one label item that names several ingredients into its parts.
// Returns the item unchanged (as a one-element list) when it's one name.
export function splitCompoundName(name: string, opts: ParseOptions = {}): string[] {
  const s = name.trim().replace(/^(?:includes?|including|include|incl\.?)\s+/i, '')

  // "yellow 5 and 6", "red 40 & red 3", "blue #1 and #2 lake"
  const dyes = s.match(/^(red|yellow|blue|green)\s*#?(\d+)(\s+lake)?\s*(?:,|and\/or|and|&)\s*(?:\1\s*)?#?(\d+)(\s+lake)?$/i)
  if (dyes) {
    const lake = dyes[3] || dyes[5] ? ' lake' : ''
    return [`${dyes[1]} ${dyes[2]}${lake}`, `${dyes[1]} ${dyes[4]}${lake}`]
  }

  // "canola and/or sunflower oil", "palm or soybean oil" — the label
  // declares either may be used, so both are listed. 2,840 rows in review.
  if (/\s(and\s*\/?\s*or|or)\s/i.test(s) && !s.includes('(')) {
    const parts = s.split(/\s*,?\s+(?:and\s*\/?\s*or|or)\s+/i).map((p) => p.trim()).filter(Boolean)
    if (parts.length > 1) {
      // The last part may itself be two ingredients: "peanut and/or
      // cottonseed oil and salt" → last part "cottonseed oil" + "salt". The
      // shared head noun ("oil") comes from its FIRST piece.
      const lastSplit = splitCompoundName(parts[parts.length - 1], opts)
      const lastWords = lastSplit[0].split(/\s+/)
      const headWord = lastWords[lastWords.length - 1]
      const head = headWord.toLowerCase()
      const earlier = parts.slice(0, -1).map((p) => {
        if (lastWords.length < 2 || !HEAD_NOUNS.has(head)) return p
        const pWords = p.toLowerCase().split(/\s+/)
        // "yeast and/or yeast extract": "yeast" is already its own thing
        if (HEAD_NOUNS.has(pWords[pWords.length - 1]) || lastWords.map((w) => w.toLowerCase()).includes(pWords[pWords.length - 1])) return p
        return `${p} ${headWord}`
      })
      // "partially hydrogenated soybean and/or cottonseed oil": the
      // processing term applies to every alternative.
      const lowerFirstPart = earlier[0].toLowerCase()
      const proc = PROCESSING_MODIFIERS.find((mod) => lowerFirstPart.startsWith(mod + ' '))
      const withProc = (x: string) => (proc && !x.toLowerCase().startsWith(proc) ? `${earlier[0].slice(0, proc.length)} ${x}` : x)
      return [
        ...earlier.flatMap((p, i) => splitCompoundName(i === 0 ? p : withProc(p), opts)),
        ...lastSplit.map(withProc),
      ]
    }
  }

  // "sodium benzoate and potassium sorbate" — only when both halves are
  // known ingredients and the whole isn't a single named thing.
  if (opts.isKnownIngredient) {
    const known = (n: string | null) => n !== null && opts.isKnownIngredient!(n)
    const m = s.match(/^(.+?)\s+(?:and|&)\s+(.+)$/i)
    // "vegetable mono and diglycerides", "mono- and diglycerides": one additive
    const isMonoDi = /\bmono-?\s*(?:and|&)\s*di/i.test(s) || /^extractives?\s+of\b/i.test(s)
    const whole = normalizeIngredientName(s)
    if (m && !isMonoDi && whole && !NEVER_SPLIT.has(whole) && !/\s(?:and|&)\s/i.test(m[2])) {
      const first = m[1].trim()
      const second = m[2].trim()
      const fw = first.split(/\s+/)
      const sw = second.split(/\s+/)

      // A leading modifier that applies to both halves: "dehydrated onion
      // and garlic" → dehydrated garlic, "hydrolyzed soy and corn protein"
      // → hydrolyzed corn protein. Processing terms carry over always;
      // plain descriptive ones only onto a single word ("dried cranberries
      // and apple juice" must NOT become "dried apple juice").
      let secondFull = second
      const lowerFirst = first.toLowerCase()
      const processing = PROCESSING_MODIFIERS.find((mod) => lowerFirst.startsWith(mod + ' '))
      const descriptive = SHARED_MODIFIERS.has(fw[0].toLowerCase()) ? fw[0] : null
      const modifier = processing ?? (sw.length === 1 ? descriptive : null)
      if (modifier && fw.length > modifier.split(' ').length && !second.toLowerCase().startsWith(modifier.toLowerCase())) {
        secondFull = `${first.slice(0, modifier.length)} ${second}`
      }
      const secondOk = known(normalizeIngredientName(secondFull)) || known(normalizeIngredientName(second))

      // A shared ending: "onion and garlic powder", "lactic and citric
      // acid", "fruit and vegetable juice concentrate", "natural and
      // artificial flavor". Tried longest ending first ("juice concentrate"
      // before "concentrate") — except when the second half repeats the
      // first ("palm and palm kernel oil" → palm OIL, not palm kernel oil).
      // Used only when "<first half> <ending>" is a known ingredient.
      const lastSecond = sw[sw.length - 1].toLowerCase()
      if (sw.length >= 2 && HEAD_NOUNS.has(lastSecond) && !HEAD_NOUNS.has(fw[fw.length - 1].toLowerCase())) {
        const endings = sw.slice(1).map((_, i) => sw.slice(i + 1).join(' '))
        if (sw[0].toLowerCase() === fw[fw.length - 1].toLowerCase()) endings.reverse()
        for (const ending of endings) {
          if (known(normalizeIngredientName(`${first} ${ending}`)) && secondOk) return [`${first} ${ending}`, secondFull]
        }
        // One bare word before a shared ending that isn't known — can't tell
        // what it attaches to, so it stays one name.
        if (fw.length === 1) return [s]
      }

      if (known(normalizeIngredientName(first)) && secondOk && normalizeIngredientName(first) !== normalizeIngredientName(secondFull)) {
        return [first, secondFull]
      }
    }
  }

  return [s]
}

// Parenthetical phrases that are ANNOTATIONS rather than ingredients or
// synonyms — dropped as ingredient names, though a trace note may be extracted.
const NOTE_PREFIXES = ['contains', 'may contain', 'trace of', 'traces of', 'from', 'as a', 'for ']

// Cleanup applied to the WHOLE declaration before it is split into items.
// These artefacts come from the sources themselves, and were found by
// comparing our Open Food Facts data against USDA FoodData Central:
//   - FDC strings begin "INGREDIENTS:" and we stored that as an ingredient
//   - footnotes and allergen statements get concatenated onto the last item,
//     producing "nutmeg*. *organiccontains: soy"
//   - typographic apostrophes create a second row for the same substance
//     ("confectioner's glaze" vs "confectioner's glaze")
function prepareDeclaration(raw: string): string {
  return raw
    // Normalise quotes/dashes first so later rules and stored names agree
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    // Trademark symbols ("idaho® potato", "senactiv®")
    .replace(/[\u2122\u00ae\u00a9]/g, '')
    // Square and curly brackets are used exactly like parentheses on many labels \u2014
    // "rosemary extract [antioxidant]", "vitamin b1 [thiamin mononitrate]".
    // Only parentheses get synonym/sub-ingredient handling below, so without
    // this the bracket text was stored as part of the ingredient name.
    .replace(/[[{]/g, '(')
    .replace(/[\]}]/g, ')')
    // Semicolons and spaced dashes are used as separators on many labels:
    // "sunflower lecithin; powdered egg", "white icing - sugar, corn syrup".
    // Without this each pair was stored as ONE ingredient. (A hyphen inside a
    // word — "high-oleic", "l-tyrosine" — has no spaces and is untouched.)
    .replace(/\s*;\s*/g, ', ')
    .replace(/\s+[-–—]\s+/g, ', ')
    // Drop a leading "INGREDIENTS:" / "INGREDIENT LIST:" label
    .replace(/^\s*ingredients?(\s+list)?\s*:\s*/i, '')
    // Separate a footnote or allergen statement that was run together with the
    // preceding word, e.g. "*ORGANICCONTAINS: SOY"
    .replace(/(\*\s*organic)(contains)/gi, '$1. $2')
    // Remove trailing organic footnotes entirely; per-item "*" markers already
    // carry that information
    .replace(/\*\s*organic\b\s*\.?/gi, ' ')
    .trim()
}

export function parseIngredientsText(rawInput: string, opts: ParseOptions = {}): ParsedIngredient[] {
  const raw = prepareDeclaration(rawInput)
  const results: Omit<ParsedIngredient, 'listPosition'>[] = []

  // Tracks whether we've passed a "contains 2% or less of:" style marker.
  // Everything after such a marker is a minor component per the label itself.
  let inTraceSection = false
  let traceSectionNote: string | null = null

  function isNote(s: string): boolean {
    const lower = s.trim().toLowerCase()
    return NOTE_PREFIXES.some((prefix) => lower.startsWith(prefix))
  }

  function cleanName(s: string): string {
    return (
      s
        .replace(/^\*+/, '')
        .replace(/\*+$/, '')
        .replace(/^\d+(\.\d+)?%\s*/, '')
        // Strip allergen and regulatory warnings that labels append to the
        // final ingredient without a separating comma, e.g.
        // "blue 1. CONTAINS WHEAT AND SOY INGREDIENTS" or
        // "yellow 6 Phenylketonurics: contains phenylalanine".
        // Left in place these become part of the ingredient NAME, producing
        // rows no filter or study will ever match.
        .replace(/\bcontains\b[\s\S]*$/i, '')
        .replace(/\bphenylketonurics?\b[\s\S]*$/i, '')
        .replace(/\bmay contain\b[\s\S]*$/i, '')
        // Collapse newlines and runs of whitespace
        .replace(/\s+/g, ' ')
        .replace(/^[.\s]+|[.\s]+$/g, '')
        .trim()
        // CANONICAL CASING: ingredient labels use no consistent convention —
        // "WATER", "Water" and "water" all appear across real products. Since
        // Ingredient.name is unique and matched case-sensitively, each variant
        // would otherwise create a SEPARATE row, defeating the point of a
        // shared ingredient table (one row, researched once, reused everywhere).
        // Lowercase is the canonical form; the UI can title-case for display.
        .toLowerCase()
    )
  }

  function isMarkedOrganic(s: string): boolean {
    const trimmed = s.trim()
    return trimmed.startsWith('*') || trimmed.endsWith('*')
  }

  function splitTopLevel(text: string): string[] {
    let depth = 0
    let current = ''
    const items: string[] = []
    for (let idx = 0; idx < text.length; idx++) {
      const char = text[idx]
      if (char === '(' || char === '[') {
        depth++
        current += char
      } else if (char === ')' || char === ']') {
        // Never below zero: a stray ")" (from a label or an earlier bad
        // split) used to hide every comma after it, so "salt), artificial
        // flavor, salt, vinegar" was stored as ONE ingredient.
        depth = Math.max(0, depth - 1)
        current += char
      } else if (char === ',' && depth === 0) {
        items.push(current.trim())
        current = ''
      } else if (char === '.' && depth === 0) {
        // A period at top level usually separates items that the label (or a
        // transcription of it) failed to comma-separate: "BLEACHED WHEAT
        // FLOUR. WHEAT STARCH". Only treat it as a separator when a letter
        // follows within the next couple of characters, so decimals and
        // abbreviations like "1.5 oz" or "Co." are left alone.
        // Do NOT split after a scientific or unit abbreviation. Bacterial
        // names legitimately contain periods — "Lactobacillus delbrueckii
        // subsp. bulgaricus" is ONE organism, and an earlier version of this
        // rule broke it into "…subsp" and "bulgaricus" as separate
        // ingredients. Same for "Schizochytrium sp." and initials like "B.".
        const lastWord = (current.trim().split(/\s+/).pop() ?? '').toLowerCase()
        const ABBREVIATIONS = new Set(['subsp', 'ssp', 'sp', 'spp', 'var', 'cv', 'st', 'no', 'approx', 'inc', 'co', 'ltd'])
        const isAbbrev = ABBREVIATIONS.has(lastWord) || /^[a-z]$/.test(lastWord)
        if (!isAbbrev && /^\s+[A-Za-z]/.test(text.slice(idx + 1))) {
          items.push(current.trim())
          current = ''
        } else {
          current += char
        }
      } else {
        current += char
      }
    }
    if (current.trim()) items.push(current.trim())
    return items
  }

  // Real ingredient names are short. Anything much longer is almost always
  // OCR noise from a photographed label — Open Food Facts contains entire
  // nutrition panels and paragraphs of allergen text scanned in as a single
  // "ingredient". 60 chars clears genuine long names like
  // "probiotic culture bacillus coagulans gbi-30 6086" (48) while rejecting
  // a 429-character nutrition panel.
  const MAX_INGREDIENT_NAME_LENGTH = 60

  // Phrases that mark a string as label boilerplate rather than an ingredient.
  // Words that are labels or footnote residue, never an ingredient on their own
  const BARE_NON_INGREDIENTS = new Set(['organic', 'ingredients', 'ingredient', 'contains', 'and', 'or'])

  const NON_INGREDIENT_MARKERS = [
    'nutrition facts', 'daily value', 'servings per container',
    'serving size', 'amount per serving', 'general nutrition advice',
    'allergene zutaten', 'kann enthalten', // German allergen boilerplate
    'conditionné dans', // French facility statement
  ]

  function isLabelBoilerplate(s: string): boolean {
    const lower = s.toLowerCase()
    return NON_INGREDIENT_MARKERS.some((m) => lower.includes(m))
  }

  function push(name: string, organic: boolean, trace: boolean, note: string | null) {
    const cleaned = cleanName(name)

    // Reject label boilerplate and OCR noise. Storing these as ingredients
    // pollutes the shared Ingredient table with rows no filter or study will
    // ever match, and makes the ingredient count meaningless.
    if (cleaned.length > MAX_INGREDIENT_NAME_LENGTH) return
    if (isLabelBoilerplate(cleaned)) return
    if (BARE_NON_INGREDIENTS.has(cleaned.toLowerCase())) return

    // Canonical spelling (plural/singular, UK/US, footnote marks, "organic"
    // and marketing prefixes) — see ingredientNormalization.ts. Returns null
    // for things that aren't ingredients at all, like a "vitamins:" header.
    // "Organic cane sugar" becomes "cane sugar" with the organic flag set, so
    // the substance shares one row while the sourcing fact is kept.
    // One item can name several ingredients ("yellow 5 and 6", "canola
    // and/or sunflower oil") — each is stored as its own ingredient.
    for (const part of splitCompoundName(cleaned, opts)) {
      const normalized = normalizeIngredient(part)
      if (!normalized) continue
      results.push({
        name: normalized.name,
        isOrganicSourced: organic || normalized.organic,
        isTrace: trace || inTraceSection,
        concentrationNote: note ?? traceSectionNote,
      })
    }
  }

  function processItem(item: string) {
    // Check whether this item opens a trace SECTION (e.g. "Contains 2% or
    // less of: salt"). Only treat it as a section marker when it appears
    // BEFORE any parenthesis — otherwise a parenthetical annotation like
    // "Seed Extract (Contains Trace of X)" would get its marker text stripped
    // mid-string, corrupting the name before paren-parsing runs. Parenthetical
    // trace notes are handled separately in the isNote() branch below.
    // A single item carrying its own limit: "less than 2% silicon dioxide",
    // "not more than 2% calcium silicate" — that one item is trace (unlike
    // "less than 2% OF:", which opens a section for everything after it).
    const own = item.match(/^(?:less\s+than|not\s+more\s+than|no\s+more\s+than)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)\s+(?!of\b)(.+)$/i)
    if (own) {
      push(own[2], isMarkedOrganic(own[2]), true, `less than ${own[1]}%`)
      return
    }

    const firstParen = item.indexOf('(')
    for (const { pattern, note } of TRACE_SECTION_PATTERNS) {
      const match = item.match(pattern)
      if (match && match.index !== undefined && (firstParen === -1 || match.index < firstParen)) {
        inTraceSection = true
        traceSectionNote = note(match)
        item = item.replace(pattern, '').replace(/^[:\s]+/, '').trim()
        if (!item) return
        break
      }
    }

    // GROUP HEADER: "Vitamins: Vitamin A", "Live and Active Cultures:
    // S. Thermophilus". A short label before a colon names the group; what
    // follows is the actual ingredient. The header is pushed too — for
    // cultures it's meaningful, and for "vitamins"/"minerals" the normalizer
    // discards it as a bare header. Limited to a short prefix with no
    // parenthesis so a colon deep inside a long item isn't misread.
    const colon = item.indexOf(':')
    if (colon > 0 && (item.indexOf('(') === -1 || colon < item.indexOf('('))) {
      const header = item.slice(0, colon).trim()
      const rest = item.slice(colon + 1).trim()
      if (rest && header.split(/\s+/).length <= 4) {
        push(header, isMarkedOrganic(header), false, null)
        processItem(rest)
        return
      }
    }

    const organic = isMarkedOrganic(item)
    const parenStart = item.indexOf('(')

    if (parenStart === -1) {
      // A stray closing bracket with more text after it — "lactic acid)
      // water": two items whose separator was lost.
      const close = item.indexOf(')')
      if (close > 0 && item.slice(close + 1).trim()) {
        push(item.slice(0, close), organic, false, null)
        processItem(item.slice(close + 1).replace(/^[\s,.;:]+/, ''))
        return
      }
      push(item, organic, false, null)
      return
    }

    let depth = 0
    let parenEnd = -1
    for (let i = parenStart; i < item.length; i++) {
      if (item[i] === '(') depth++
      else if (item[i] === ')') {
        depth--
        if (depth === 0) {
          parenEnd = i
          break
        }
      }
    }

    if (parenEnd === -1) {
      // Opened but never closed — the list was cut off or split inside the
      // bracket: "milk chocolate {sugar" is "milk chocolate", whose first
      // sub-ingredient is "sugar". (Joining them gave "milk chocolate sugar".)
      const head = item.slice(0, parenStart).trim()
      const tail = item.slice(parenStart + 1).trim()
      if (head && tail) {
        push(head, organic, false, null)
        processItem(tail)
        return
      }
      push(item.replace(/[()]/g, ' '), organic, false, null)
      return
    }

    const before = item.slice(0, parenStart).trim()
    const inside = item.slice(parenStart + 1, parenEnd).trim()
    const after = item.slice(parenEnd + 1).trim()

    // MID-NAME SYNONYM: more name follows the parenthetical, e.g.
    // "Citrus Grandis (Grapefruit) Seed Extract" — one ingredient, not three.
    if (after && !after.startsWith(',')) {
      const joined = `${before} ${after}`.replace(/\s+/g, ' ')
      // The remainder may itself contain another parenthetical that still
      // needs handling, e.g. "Citrus Grandis (Grapefruit) Seed Extract
      // (Contains Trace of Benzalkonium Chloride)" — after dropping the
      // "(Grapefruit)" synonym, the trace annotation is still there.
      // Recursion terminates because `joined` is always strictly shorter
      // than `item` (one parenthetical has been removed).
      if (joined.includes('(')) {
        processItem(joined)
      } else {
        push(joined, organic, false, null)
      }
      return
    }

    // ANNOTATION: e.g. "Seed Extract (Contains Trace of Benzalkonium Chloride)".
    // The parenthetical is not an ingredient name — but if it names a trace
    // substance, that substance IS present, so capture it as a trace entry
    // rather than discarding the information entirely.
    if (isNote(inside)) {
      push(before, organic, false, null)
      for (const { pattern, note } of TRACE_SECTION_PATTERNS) {
        const m = inside.match(pattern)
        if (m) {
          const traceSubstance = inside.replace(pattern, '').replace(/^[:\s]+/, '').trim()
          if (traceSubstance) push(traceSubstance, false, true, note(m))
          break
        }
      }
      return
    }

    // TRAILING SYNONYM: single term in parens, e.g. "Water (Aqua)" -> "Water"
    // ...unless that one term is really several ingredients: "whey protein
    // powder (whey protein isolate and soy lecithin)".
    let insideParts = splitTopLevel(inside)
    if (insideParts.length === 1) {
      const compound = splitCompoundName(cleanName(inside), opts)
      // ("or" inside brackets gives alternative NAMES: "(thiamine or thiamin)")
      if (compound.length > 1 && !/\bor\b/i.test(inside)) insideParts = compound
    }
    if (insideParts.length === 1) {
      push(before, organic, false, null)
      return
    }

    // SUB-INGREDIENT LIST: "chocolate (cocoa, sugar, vanilla)" -> keep all
    push(before, organic, false, null)
    for (const subItem of insideParts) processItem(subItem)
  }

  for (const topLevelItem of splitTopLevel(raw)) {
    processItem(topLevelItem)
  }

  // Dedupe by lowercased name, preferring the entry with more information
  // (organic marker, or a non-trace listing which implies a real position)
  const byName = new Map<string, Omit<ParsedIngredient, 'listPosition'>>()
  for (const r of results) {
    const key = r.name.toLowerCase()
    const existing = byName.get(key)
    if (!existing || (!existing.isOrganicSourced && r.isOrganicSourced)) {
      byName.set(key, r)
    }
  }

  // Assign 1-indexed positions in final order — this is the concentration
  // signal, so it must reflect the order the label actually presented them
  return [...byName.values()].map((r, i) => ({ ...r, listPosition: i + 1 }))
}

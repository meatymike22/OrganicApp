// Turns an Open Food Facts product record into a NutritionFacts row.
//
// Shared by ingest-openfoodfacts.ts (one product at a time, via the API) and
// bulk-import-off.ts (the full data export), so the per-serving conversion
// and its safety rules can't drift between the two.
//
// OFF stores nutrients PER 100 g. We store PER SERVING when OFF gives a
// usable numeric serving weight (serving_quantity), because a per-100g number
// shown next to "1 serving (40 g)" reads as the serving's value. When there
// is no usable serving weight, the numbers stay per-100g and servingSize says
// "100 g" — the label must always describe the numbers next to it.

type OffProduct = Record<string, unknown>

// No single serving of anything is near 500 g. Bigger values are OFF
// recording the whole package as "the serving" (an 800 g tin of infant
// formula once produced a 4,160-calorie "serving").
const MAX_PLAUSIBLE_SERVING_GRAMS = 500

export type OffNutrition = {
  servingSize: string | null
  calories: number | null
  totalFatG: number | null
  saturatedFatG: number | null
  sugarG: number | null
  carbsG: number | null
  sodiumMg: number | null
  proteinG: number | null
  sourceUrl: string
  sourceType: string
  dataPulledDate: Date
  aiDrafted: boolean
}

export type OffNutritionResult = {
  data: OffNutrition | null // null when OFF has no nutrient values at all
  perServing: boolean // false = values are per 100 g
  notes: string[] // things worth logging for review
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

// "56.99999999999999g" → "57g". Some OFF records (old USDA imports) carry
// floating-point noise in the serving text; 3,450 labels looked like this
// before the 2026-09-28 cleanup. Any number with 6+ decimals is rounded to 1.
export function tidyServingLabel(label: string): string {
  return label.replace(/\d+\.\d{6,}/g, (m) => String(Math.round(Number(m) * 10) / 10))
}

// The grams (or ml) a serving label states, e.g. "2 Tbsp (30 g)" → 30.
function labelGrams(label: string): number | null {
  const m = label.match(/(\d+(?:\.\d+)?)\s*(?:g|ml)\b/i)
  const v = m ? Number(m[1]) : NaN
  return Number.isFinite(v) && v > 0 ? v : null
}

export type OffNutritionOptions = {
  // True when salt or sea salt is among the first six parsed ingredients.
  // Used to catch sodium stored 1,000x too small (see the sodium checks).
  saltNearTop?: boolean
}

export function buildNutritionFromOff(p: OffProduct, upc: string, opts: OffNutritionOptions = {}): OffNutritionResult {
  const n = (p.nutriments ?? {}) as Record<string, unknown>
  const notes: string[] = []

  const rawServing = num(p.serving_quantity) ?? (typeof p.serving_quantity === 'string' ? Number(p.serving_quantity) : undefined)
  const servingGrams =
    rawServing && Number.isFinite(rawServing) && rawServing > 0 && rawServing <= MAX_PLAUSIBLE_SERVING_GRAMS ? rawServing : null
  if (rawServing && !servingGrams) {
    notes.push(`serving_quantity ${rawServing} is implausible as one serving (likely the whole package) — stored per 100 g`)
  }
  const factor = servingGrams ? servingGrams / 100 : null

  const scale = (per100: number | undefined): number | null => {
    if (per100 === undefined) return null
    return factor ? Math.round(per100 * factor * 100) / 100 : per100
  }

  // Sodium: OFF gives sodium directly (grams) or only salt (grams).
  // sodium = salt / 2.5
  const salt = num(n.salt_100g)
  let sodiumG100 = num(n.sodium_100g) ?? (salt !== undefined ? salt / 2.5 : undefined)

  // Sodium safety checks, added after the 2026-09-28 data review:
  // - Pure salt is ~39 g sodium per 100 g, so anything above 40 g is
  //   impossible (364 products had values like 420,000 mg per serving).
  // - A product with salt among its first six ingredients can't have under
  //   5 mg sodium per 100 g. ~6,400 products had exactly this: sodium stored
  //   1,000x too small (hot dogs at 0.74 mg), from old USDA imports on OFF.
  // Either way the value is left blank rather than published wrong.
  if (sodiumG100 !== undefined && sodiumG100 > 40) {
    notes.push(`${sodiumG100} g sodium per 100 g is impossible — sodium left blank`)
    sodiumG100 = undefined
  } else if (sodiumG100 !== undefined && opts.saltNearTop && sodiumG100 * 1000 < 5) {
    notes.push(`${Math.round(sodiumG100 * 1000 * 100) / 100} mg sodium per 100 g with salt near the top of the ingredients (likely a unit error) — sodium left blank`)
    sodiumG100 = undefined
  }

  // FIRST, the panel as a whole. 100 g of food can't contain more than 100 g
  // of fat + carbohydrate + protein. Open Food Facts has records that break
  // this badly — e.g. Kroger tortilla chips at 231 g carbohydrate per 100 g,
  // from a 2017 import of old USDA data where per-serving and per-100g
  // values got mixed up. When the composition itself is impossible, every
  // number on the panel is suspect, so NONE of it is stored (5 g of slack
  // allows for rounding on labels).
  const composition = ['fat_100g', 'carbohydrates_100g', 'proteins_100g']
    .map((k) => num(n[k]) ?? 0)
    .reduce((a, b) => a + b, 0)
  const anyOver100 = ['fat_100g', 'carbohydrates_100g', 'proteins_100g', 'sugars_100g', 'saturated-fat_100g']
    .some((k) => (num(n[k]) ?? 0) > 100)
  if (composition > 105 || anyOver100) {
    return {
      data: null,
      perServing: false,
      notes: [...notes, `impossible composition (${Math.round(composition)} g fat+carbs+protein per 100 g) — nutrition not stored`],
    }
  }

  // Nothing can exceed ~900 kcal per 100 g (pure fat is 884). The first dry
  // run found ~10,800 US products above that — mostly kilojoules typed into
  // the kcal field (1 kcal = 4.184 kJ). We can't tell which unit was meant,
  // so an impossible calorie value is DROPPED (null) rather than stored; the
  // product's other nutrients are kept. Publishing "3,690 calories per
  // 100 g" of bacon would be a plainly false statement.
  const kcal100Raw = num(n['energy-kcal_100g'])
  const kcal100 = kcal100Raw !== undefined && kcal100Raw > 950 ? undefined : kcal100Raw
  if (kcal100Raw !== undefined && kcal100 === undefined) {
    notes.push(`${kcal100Raw} kcal per 100 g is impossible (likely kJ) — calories left blank`)
  }

  // Second physical check. Fat (9 kcal/g), protein (4) and sugars (4) always
  // count toward calories in full, so calories can never be much LOWER than
  // those three alone. (Total carbs aren't used: fiber and sugar alcohols
  // legitimately contribute less, which is how sugar-free products get low
  // calories.) In the first trial, 524 of 2,000 products failed this — mostly
  // chocolate listed at ~220 kcal per 100 g while its own fat and sugar
  // values add up to over 500. A calorie figure contradicted by the same
  // label's fat and sugar is left blank, like an impossible one.
  const fat100 = num(n.fat_100g)
  const protein100 = num(n.proteins_100g)
  const sugar100 = num(n.sugars_100g)
  let kcalChecked = kcal100
  if (kcalChecked !== undefined && fat100 !== undefined && sugar100 !== undefined) {
    const floor = 9 * fat100 + 4 * (protein100 ?? 0) + 4 * sugar100
    if (floor > 50 && kcalChecked < 0.75 * floor) {
      notes.push(`${kcalChecked} kcal per 100 g is below what its fat, protein and sugar alone provide (~${Math.round(floor)}) — calories left blank`)
      kcalChecked = undefined
    }
  }

  // A part can't exceed its whole: saturated fat is part of total fat, and
  // sugar is part of total carbohydrate. When a label says otherwise
  // (180 and 312 products in the review), the part is left blank.
  let satFat100 = num(n['saturated-fat_100g'])
  if (satFat100 !== undefined && fat100 !== undefined && satFat100 > fat100 + 0.5) {
    notes.push(`saturated fat (${satFat100} g) exceeds total fat (${fat100} g) — saturated fat left blank`)
    satFat100 = undefined
  }
  let sugarChecked = sugar100
  const carbs100 = num(n.carbohydrates_100g)
  if (sugarChecked !== undefined && carbs100 !== undefined && sugarChecked > carbs100 + 1) {
    notes.push(`sugar (${sugarChecked} g) exceeds total carbohydrate (${carbs100} g) — sugar left blank`)
    sugarChecked = undefined
  }

  const values = {
    calories: scale(kcalChecked),
    totalFatG: scale(num(n.fat_100g)),
    saturatedFatG: scale(satFat100),
    sugarG: scale(sugarChecked),
    carbsG: scale(num(n.carbohydrates_100g)),
    sodiumMg: sodiumG100 !== undefined ? scale(sodiumG100 * 1000) : null,
    proteinG: scale(num(n.proteins_100g)),
  }

  // No values at all isn't a data problem to review — OFF just doesn't have
  // them — so it adds no note.
  if (Object.values(values).every((v) => v === null)) {
    return { data: null, perServing: false, notes }
  }

  // Sanity check: energy should roughly equal 9×fat + 4×carbs + 4×protein.
  // A big mismatch usually means per-serving values typed into per-100g
  // fields (or vice versa) on OFF. Logged for review, not auto-corrected —
  // we can't tell which number is the wrong one.
  const { calories, totalFatG, carbsG, proteinG } = values
  if (calories && calories > 20 && totalFatG !== null && carbsG !== null && proteinG !== null) {
    const fromMacros = 9 * totalFatG + 4 * carbsG + 4 * proteinG
    if (Math.abs(calories - fromMacros) > 0.35 * calories) {
      notes.push(`calories (${calories}) don't match fat/carbs/protein (~${Math.round(fromMacros)}) — check source`)
    }
  }

  // Per-serving numbers always get a label: OFF's serving text if it has
  // one, otherwise the weight the numbers were computed from.
  const servingSize = factor
    ? tidyServingLabel(typeof p.serving_size === 'string' && p.serving_size.trim() ? p.serving_size : `${servingGrams} g`)
    : '100 g'

  // Last physical check, against the weight the LABEL states. A serving
  // can't hold more than ~9 kcal per gram, or more fat + carbs + protein
  // than it weighs. 125 panels in the review broke this (a 16 g drink-mix
  // packet at 900 kcal) — per-100 g numbers shown as one serving. The label
  // and the numbers disagree, so none of it is stored.
  const g = labelGrams(servingSize)
  if (g) {
    const macros = (values.totalFatG ?? 0) + (values.carbsG ?? 0) + (values.proteinG ?? 0)
    if ((values.calories ?? 0) > g * 10 || macros > g * 1.1) {
      return {
        data: null,
        perServing: false,
        notes: [...notes, `values don't fit the stated serving (${servingSize}) — nutrition not stored`],
      }
    }
  }

  return {
    perServing: factor !== null,
    notes,
    data: {
      servingSize,
      ...values,
      sourceUrl: `https://world.openfoodfacts.org/product/${upc}`,
      sourceType: 'crowdsourced',
      dataPulledDate: new Date(),
      aiDrafted: false, // relayed structured data, not AI-interpreted
    },
  }
}

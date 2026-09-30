// Picks the ENGLISH ingredient list from an Open Food Facts / Open Beauty
// Facts product record.
//
// WHY: OFF is worldwide. Its plain `ingredients_text` field is in whatever
// language the product's label was entered in — which is how the database
// ended up with ingredients like "zucker", "salz", "betterave" and "huile de
// colza". Rootify is an English-language app for US shoppers, and a German
// "zucker" row is a separate Ingredient from "sugar": it never matches a
// filter, a study or a classification rule. So only English text is parsed.
//
// OFF provides a per-language field (`ingredients_text_en`) plus the label's
// main language (`lang` / `ingredients_lc`), which is what this checks.

export type IngredientsTextPick =
  | { kind: 'english'; text: string }
  | { kind: 'not_english'; lang: string } // a list exists, just not in English
  | { kind: 'none' } // the record has no ingredient list at all

// Loose type: the OFF product JSON is large and untyped.
type OffProduct = Record<string, unknown>

export function pickEnglishIngredientsText(p: OffProduct): IngredientsTextPick {
  const en = String(p.ingredients_text_en ?? '').trim()
  if (en) return { kind: 'english', text: en }

  const main = String(p.ingredients_text ?? '').trim()
  const lang = String(p.ingredients_lc ?? p.lang ?? '').toLowerCase()
  if (main && lang === 'en') return { kind: 'english', text: main }
  if (main) return { kind: 'not_english', lang: lang || 'unknown' }
  return { kind: 'none' }
}

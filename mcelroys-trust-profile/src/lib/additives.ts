// THE ADDITIVE IDENTITY SPINE.
//
// WHY THIS FILE EXISTS. 154,213 products carry e-numbers and nothing in this
// project could say what any of them were. `Product.additiveENumbers` is a
// bare `String[]` with no join to `Ingredient`, so an e-number could not carry
// a category, a definition, or an authority finding.
//
// WHY IT IS A FILE AND NOT A TABLE. Same reason as `authorities.ts`, which
// `IngredientAuthorityAssessment`'s own comment gives: the canonical list
// lives in code "so a wording correction never requires a re-ingest". This is
// reference data that gets corrected by reading, not by re-running anything.
//
// WHY IT IS SCOPED BY REACH. 452 distinct e-numbers exist in the catalogue.
// The top 100 cover 93.3% of product-additive links and the top 150 cover
// 97.8%, so a few dozen hand-sourced rows do most of the work. Alphabetical
// completeness would cost ten times as much for the last 2%.
//
// WHAT R24 LEARNED THE HARD WAY, AND WHY THIS FILE IS THE ANSWER. Every false
// match in the Prop 65 ingest was a STRING-matching error: `Chromium
// (hexavalent compounds)` reached 47 dietary-chromium ingredients across 919
// product links; styrene reached five copolymers; `Benzophenone` reached
// benzophenone-4. Names compose and strings do not know chemistry. A stable
// identifier per substance is what ends that, which is why `cas` is in this
// shape even though it is not yet populated.

// ---------------------------------------------------------------------------
// SOURCES, PINNED
//
// Functional classes and canonical names: Codex Alimentarius CXG 36-1989,
// "Class Names and the International Numbering System for Food Additives".
// Read from the 2015 amendment text, which states:
//     "Adopted in 1989. Revision: 2008. Amendment: 2015."
//
// A LATER REVISION EXISTS AND COULD NOT BE READ. The FAO committee page lists
// CXG 36-1989 as last modified 2026. Its current PDF sits on
// workspace.fao.org, which refuses automated fetches (robots), and the FAO
// proxy URL returned a server error. So every row below is from the 2015
// amendment and says so. This is recorded rather than smoothed over: the
// difference for mainstream additives is probably nil, and "probably" is not
// a citation. Re-verify against the current revision before this file is used
// to publish a class on a page.
export const CODEX_SOURCE = {
  standard: 'CXG 36-1989',
  title: 'Class Names and the International Numbering System for Food Additives',
  revision: '2015 amendment',
  url: 'https://www.fao.org/input/download/standards/13341/CXG_036e_2015.pdf',
  readOn: '2026-10-20',
  laterRevisionExists: true,
} as const

// Label-name mapping: measured against this catalogue on 2026-10-20. Method
// and evidence in `claude/phase-2-authority-data.md`.
export const LABEL_NAME_SOURCE = { measuredOn: '2026-10-20', catalogueProducts: 416382 } as const

// ---------------------------------------------------------------------------
// FUNCTIONAL CLASSES.
//
// Codex defines 27. Listed here are the ones the sourced rows below actually
// use; the complete set is in the standard. A class is only added when a row
// needs it, so this union never claims more than has been read.
export type FunctionalClass =
  | 'Acidity regulator'
  | 'Anticaking agent'
  | 'Antifoaming agent'
  | 'Antioxidant'
  | 'Bulking agent'
  | 'Carrier'
  | 'Colour'
  | 'Colour retention agent'
  | 'Emulsifier'
  | 'Emulsifying salt'
  | 'Firming agent'
  | 'Flavour enhancer'
  | 'Flour treatment agent'
  | 'Foaming agent'
  | 'Gelling agent'
  | 'Glazing agent'
  | 'Humectant'
  | 'Preservative'
  | 'Raising agent'
  | 'Sequestrant'
  | 'Stabilizer'
  | 'Sweetener'
  | 'Thickener'

// HOW A LABEL NAME WAS ESTABLISHED. The three-state rule, applied to synonyms.
//
//   'codex'    — the Codex name, or a synonym Codex itself prints in
//                parentheses. Authoritative.
//   'measured' — our own catalogue says this name and this code describe the
//                same substance, and Codex does not corroborate the string.
//                US naming conventions are the usual reason: Codex says
//                "Tartrazine", a US label says "yellow 5". Almost certainly
//                right, NOT cited. Needs a citation (21 CFR 74 for colours,
//                EU 231/2012 "Name and synonyms") before it is used to make a
//                claim on a page.
export type NameBasis = 'codex' | 'measured'

export type Additive = {
  /** Our normalised code, matching `Product.additiveENumbers`: 'e330', 'e322i'. */
  code: string
  /** The INS number as Codex prints it: '330', '322(i)'. */
  ins: string
  /** Parent code for a sub-entry, else null. 'e322i' -> 'e322'. */
  parent: string | null
  /**
   * TRUE when Codex gives this number a name but NO functional class of its
   * own, because it is a heading over sub-entries. 322 "Lecithins" and 500
   * "Sodium carbonates" are headings; 322(i) and 500(ii) carry the data.
   *
   * These matter because OFF tags the PARENT on real products: e322 is on
   * 37,430 and e322i on 37,179. A heading gets `functionalClasses: []` rather
   * than the union of its children's classes, because Codex does not say that
   * and inferring it would be our claim wearing the standard's clothes.
   */
  isClassHeading: boolean
  /** Codex "Name of Food Additive", verbatim. */
  name: string
  /** Synonyms Codex itself prints in parentheses in the name field. */
  codexSynonyms: string[]
  /** Codex functional classes. Empty for a class heading — claims nothing. */
  functionalClasses: FunctionalClass[]
  /**
   * CAS Registry Number. NULL EVERYWHERE ON PURPOSE — nobody has looked yet.
   *
   * Not an oversight and not a placeholder for a guess: Codex publishes no CAS
   * numbers (verified in the source), and EU 231/2012 publishes EINECS rather
   * than CAS (also verified). The Prop 65 ingest supplies CAS for 37
   * ingredients already, so the realistic path is to accumulate CAS from the
   * authorities that publish it rather than find one list that has it all.
   *
   * `null` is the third state: not "no CAS exists", but "we have not checked".
   */
  cas: string | null
  /** Names as they appear on labels in this catalogue, with how we know. */
  labelNames: { name: string; basis: NameBasis }[]
}

// ---------------------------------------------------------------------------
// THE TABLE, ordered by product reach within this catalogue.
export const ADDITIVES: Additive[] = [
  { code: 'e330', ins: '330', parent: null, isClassHeading: false,
    name: 'Citric acid', codexSynonyms: [],
    functionalClasses: ['Acidity regulator', 'Antioxidant', 'Colour retention agent', 'Sequestrant'],
    cas: null, labelNames: [{ name: 'citric acid', basis: 'codex' }] },

  { code: 'e322', ins: '322', parent: null, isClassHeading: true,
    name: 'Lecithins', codexSynonyms: [], functionalClasses: [], cas: null, labelNames: [] },

  { code: 'e322i', ins: '322(i)', parent: 'e322', isClassHeading: false,
    name: 'Lecithin', codexSynonyms: [],
    functionalClasses: ['Antioxidant', 'Emulsifier'],
    cas: null, labelNames: [
      { name: 'lecithin', basis: 'codex' },
      { name: 'soy lecithin', basis: 'measured' },
    ] },

  { code: 'e415', ins: '415', parent: null, isClassHeading: false,
    name: 'Xanthan gum', codexSynonyms: [],
    functionalClasses: ['Emulsifier', 'Foaming agent', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [{ name: 'xanthan gum', basis: 'codex' }] },

  { code: 'e500', ins: '500', parent: null, isClassHeading: true,
    name: 'Sodium carbonates', codexSynonyms: [], functionalClasses: [], cas: null, labelNames: [] },

  { code: 'e500ii', ins: '500(ii)', parent: 'e500', isClassHeading: false,
    name: 'Sodium hydrogen carbonate', codexSynonyms: [],
    functionalClasses: ['Acidity regulator', 'Anticaking agent', 'Raising agent', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [{ name: 'baking soda', basis: 'measured' }] },

  { code: 'e129', ins: '129', parent: null, isClassHeading: false,
    name: 'Allura red AC', codexSynonyms: [], functionalClasses: ['Colour'],
    cas: null, labelNames: [
      { name: 'red 40', basis: 'measured' },
      { name: 'red 40 lake', basis: 'measured' },
    ] },

  { code: 'e412', ins: '412', parent: null, isClassHeading: false,
    name: 'Guar gum', codexSynonyms: [],
    functionalClasses: ['Emulsifier', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [{ name: 'guar gum', basis: 'codex' }] },

  { code: 'e471', ins: '471', parent: null, isClassHeading: false,
    name: 'Mono- and di- glycerides of fatty acids', codexSynonyms: [],
    functionalClasses: ['Antifoaming agent', 'Emulsifier', 'Stabilizer'],
    cas: null, labelNames: [
      { name: 'mono and diglycerides', basis: 'codex' },
      { name: 'diglycerides', basis: 'measured' },
    ] },

  { code: 'e150c', ins: '150c', parent: null, isClassHeading: false,
    name: 'Caramel III - ammonia caramel', codexSynonyms: [], functionalClasses: ['Colour'],
    cas: null, labelNames: [{ name: 'caramel color', basis: 'measured' }] },

  { code: 'e202', ins: '202', parent: null, isClassHeading: false,
    name: 'Potassium sorbate', codexSynonyms: [], functionalClasses: ['Preservative'],
    cas: null, labelNames: [{ name: 'potassium sorbate', basis: 'codex' }] },

  { code: 'e102', ins: '102', parent: null, isClassHeading: false,
    name: 'Tartrazine', codexSynonyms: [], functionalClasses: ['Colour'],
    cas: null, labelNames: [
      { name: 'yellow 5', basis: 'measured' },
      { name: 'yellow 5 lake', basis: 'measured' },
    ] },

  { code: 'e133', ins: '133', parent: null, isClassHeading: false,
    name: 'Brilliant blue FCF', codexSynonyms: [], functionalClasses: ['Colour'],
    cas: null, labelNames: [{ name: 'blue 1', basis: 'measured' }] },

  { code: 'e270', ins: '270', parent: null, isClassHeading: false,
    name: 'Lactic acid, L-, D- and DL-', codexSynonyms: [],
    functionalClasses: ['Acidity regulator'],
    cas: null, labelNames: [{ name: 'lactic acid', basis: 'codex' }] },

  { code: 'e407', ins: '407', parent: null, isClassHeading: false,
    name: 'Carrageenan', codexSynonyms: [],
    functionalClasses: ['Bulking agent', 'Carrier', 'Emulsifier', 'Gelling agent', 'Glazing agent', 'Humectant', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [{ name: 'carrageenan', basis: 'codex' }] },

  { code: 'e341', ins: '341', parent: null, isClassHeading: true,
    name: 'Calcium phosphates', codexSynonyms: [], functionalClasses: [], cas: null, labelNames: [] },

  { code: 'e341i', ins: '341(i)', parent: 'e341', isClassHeading: false,
    name: 'Calcium dihydrogen phosphate', codexSynonyms: [],
    functionalClasses: ['Acidity regulator', 'Anticaking agent', 'Emulsifying salt', 'Firming agent', 'Flour treatment agent', 'Humectant', 'Raising agent', 'Sequestrant', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [{ name: 'monocalcium phosphate', basis: 'measured' }] },

  { code: 'e211', ins: '211', parent: null, isClassHeading: false,
    name: 'Sodium benzoate', codexSynonyms: [], functionalClasses: ['Preservative'],
    cas: null, labelNames: [{ name: 'sodium benzoate', basis: 'codex' }] },

  { code: 'e110', ins: '110', parent: null, isClassHeading: false,
    name: 'Sunset yellow FCF', codexSynonyms: [], functionalClasses: ['Colour'],
    cas: null, labelNames: [
      { name: 'yellow 6', basis: 'measured' },
      { name: 'yellow 6 lake', basis: 'measured' },
    ] },

  { code: 'e331', ins: '331', parent: null, isClassHeading: true,
    name: 'Sodium citrates', codexSynonyms: [], functionalClasses: [], cas: null,
    labelNames: [{ name: 'sodium citrate', basis: 'measured' }] },

  { code: 'e450', ins: '450', parent: null, isClassHeading: true,
    name: 'Diphosphates', codexSynonyms: [], functionalClasses: [], cas: null, labelNames: [] },

  { code: 'e450i', ins: '450(i)', parent: 'e450', isClassHeading: false,
    name: 'Disodium diphosphate', codexSynonyms: [],
    functionalClasses: ['Acidity regulator', 'Emulsifier', 'Emulsifying salt', 'Humectant', 'Raising agent', 'Sequestrant', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [{ name: 'sodium acid pyrophosphate', basis: 'measured' }] },

  { code: 'e440', ins: '440', parent: null, isClassHeading: false,
    name: 'Pectins', codexSynonyms: [],
    functionalClasses: ['Emulsifier', 'Gelling agent', 'Glazing agent', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [
      { name: 'pectin', basis: 'codex' },
      { name: 'fruit pectin', basis: 'measured' },
    ] },

  { code: 'e410', ins: '410', parent: null, isClassHeading: false,
    name: 'Carob bean gum', codexSynonyms: [],
    functionalClasses: ['Emulsifier', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [
      { name: 'carob bean gum', basis: 'codex' },
      { name: 'locust bean gum', basis: 'measured' },
    ] },

  { code: 'e955', ins: '955', parent: null, isClassHeading: false,
    name: 'Sucralose (Trichlorogalactosucrose)', codexSynonyms: ['Trichlorogalactosucrose'],
    functionalClasses: ['Sweetener'],
    cas: null, labelNames: [{ name: 'sucralose', basis: 'codex' }] },

  { code: 'e414', ins: '414', parent: null, isClassHeading: false,
    name: 'Gum arabic (Acacia gum)', codexSynonyms: ['Acacia gum'],
    functionalClasses: ['Bulking agent', 'Carrier', 'Emulsifier', 'Glazing agent', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [
      { name: 'gum arabic', basis: 'codex' },
      { name: 'gum acacia', basis: 'codex' },
    ] },

  { code: 'e422', ins: '422', parent: null, isClassHeading: false,
    name: 'Glycerol', codexSynonyms: [], functionalClasses: ['Humectant', 'Thickener'],
    cas: null, labelNames: [
      { name: 'glycerin', basis: 'measured' },
      { name: 'vegetable glycerin', basis: 'measured' },
    ] },

  { code: 'e466', ins: '466', parent: null, isClassHeading: false,
    name: 'Sodium carboxymethyl cellulose (Cellulose gum)', codexSynonyms: ['Cellulose gum'],
    functionalClasses: ['Bulking agent', 'Emulsifier', 'Firming agent', 'Gelling agent', 'Glazing agent', 'Humectant', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [{ name: 'cellulose gum', basis: 'codex' }] },

  { code: 'e296', ins: '296', parent: null, isClassHeading: false,
    name: 'Malic acid, DL-', codexSynonyms: [], functionalClasses: ['Acidity regulator'],
    cas: null, labelNames: [{ name: 'malic acid', basis: 'codex' }] },

  { code: 'e621', ins: '621', parent: null, isClassHeading: false,
    name: 'Monosodium L-glutamate', codexSynonyms: [], functionalClasses: ['Flavour enhancer'],
    cas: null, labelNames: [{ name: 'monosodium glutamate', basis: 'codex' }] },

  { code: 'e428', ins: '428', parent: null, isClassHeading: false,
    name: 'Gelatin', codexSynonyms: [],
    functionalClasses: ['Carrier', 'Emulsifier', 'Gelling agent', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [{ name: 'gelatin', basis: 'codex' }] },

  { code: 'e160b', ins: '160b', parent: null, isClassHeading: true,
    name: 'Annatto extracts', codexSynonyms: [], functionalClasses: [], cas: null,
    labelNames: [{ name: 'annatto', basis: 'measured' }] },

  { code: 'e250', ins: '250', parent: null, isClassHeading: false,
    name: 'Sodium nitrite', codexSynonyms: [],
    functionalClasses: ['Colour retention agent', 'Preservative'],
    cas: null, labelNames: [{ name: 'sodium nitrite', basis: 'codex' }] },

  { code: 'e903', ins: '903', parent: null, isClassHeading: false,
    name: 'Carnauba wax', codexSynonyms: [],
    functionalClasses: ['Acidity regulator', 'Anticaking agent', 'Bulking agent', 'Carrier', 'Glazing agent'],
    cas: null, labelNames: [{ name: 'carnauba wax', basis: 'codex' }] },

  { code: 'e950', ins: '950', parent: null, isClassHeading: false,
    name: 'Acesulfame potassium', codexSynonyms: [],
    functionalClasses: ['Flavour enhancer', 'Sweetener'],
    cas: null, labelNames: [{ name: 'acesulfame potassium', basis: 'codex' }] },

  { code: 'e171', ins: '171', parent: null, isClassHeading: false,
    name: 'Titanium dioxide', codexSynonyms: [], functionalClasses: ['Colour'],
    cas: null, labelNames: [{ name: 'titanium dioxide', basis: 'codex' }] },

  { code: 'e282', ins: '282', parent: null, isClassHeading: false,
    name: 'Calcium propionate', codexSynonyms: [], functionalClasses: ['Preservative'],
    cas: null, labelNames: [{ name: 'calcium propionate', basis: 'codex' }] },

  { code: 'e316', ins: '316', parent: null, isClassHeading: false,
    name: 'Sodium erythorbate (Sodium isoascorbate)', codexSynonyms: ['Sodium isoascorbate'],
    functionalClasses: ['Antioxidant'],
    cas: null, labelNames: [{ name: 'sodium erythorbate', basis: 'codex' }] },

  { code: 'e340', ins: '340', parent: null, isClassHeading: true,
    name: 'Potassium phosphates', codexSynonyms: [], functionalClasses: [], cas: null,
    labelNames: [{ name: 'dipotassium phosphate', basis: 'measured' }] },

  { code: 'e631', ins: '631', parent: null, isClassHeading: false,
    name: "Disodium 5'-inosinate", codexSynonyms: [], functionalClasses: ['Flavour enhancer'],
    cas: null, labelNames: [{ name: 'disodium inosinate', basis: 'codex' }] },

  { code: 'e460', ins: '460', parent: null, isClassHeading: true,
    name: 'Celluloses', codexSynonyms: [], functionalClasses: [], cas: null,
    labelNames: [
      { name: 'cellulose', basis: 'measured' },
      { name: 'powdered cellulose', basis: 'measured' },
    ] },

  { code: 'e460i', ins: '460(i)', parent: 'e460', isClassHeading: false,
    name: 'Microcrystalline cellulose (Cellulose gel)', codexSynonyms: ['Cellulose gel'],
    functionalClasses: ['Anticaking agent', 'Bulking agent', 'Carrier', 'Emulsifier', 'Foaming agent', 'Glazing agent', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [{ name: 'cellulose gel', basis: 'codex' }] },

  { code: 'e200', ins: '200', parent: null, isClassHeading: false,
    name: 'Sorbic acid', codexSynonyms: [], functionalClasses: ['Preservative'],
    cas: null, labelNames: [{ name: 'sorbic acid', basis: 'codex' }] },

  { code: 'e627', ins: '627', parent: null, isClassHeading: false,
    name: "Disodium 5'-guanylate", codexSynonyms: [], functionalClasses: ['Flavour enhancer'],
    cas: null, labelNames: [{ name: 'disodium guanylate', basis: 'codex' }] },

  { code: 'e321', ins: '321', parent: null, isClassHeading: false,
    name: 'Butylated hydroxytoluene', codexSynonyms: [], functionalClasses: ['Antioxidant'],
    cas: null, labelNames: [] },

  { code: 'e262', ins: '262', parent: null, isClassHeading: true,
    name: 'Sodium acetates', codexSynonyms: [], functionalClasses: [], cas: null, labelNames: [] },

  { code: 'e262ii', ins: '262(ii)', parent: 'e262', isClassHeading: false,
    name: 'Sodium diacetate', codexSynonyms: [],
    functionalClasses: ['Acidity regulator', 'Preservative', 'Sequestrant'],
    cas: null, labelNames: [] },

  { code: 'e339ii', ins: '339(ii)', parent: 'e339', isClassHeading: false,
    name: 'Disodium hydrogen phosphate', codexSynonyms: [],
    functionalClasses: ['Acidity regulator', 'Emulsifier', 'Emulsifying salt', 'Humectant', 'Sequestrant', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [] },

  { code: 'e160a', ins: '160a', parent: null, isClassHeading: true,
    name: 'Carotenes', codexSynonyms: [], functionalClasses: [], cas: null, labelNames: [] },

  { code: 'e160ai', ins: '160a(i)', parent: 'e160a', isClassHeading: false,
    name: 'Carotenes, beta-, synthetic', codexSynonyms: [], functionalClasses: ['Colour'],
    cas: null, labelNames: [] },

  { code: 'e385', ins: '385', parent: null, isClassHeading: false,
    name: 'Calcium disodium ethylenediaminetetraacetate', codexSynonyms: [],
    functionalClasses: ['Antioxidant', 'Colour retention agent', 'Preservative', 'Sequestrant'],
    cas: null, labelNames: [] },

  { code: 'e452', ins: '452', parent: null, isClassHeading: true,
    name: 'Polyphosphates', codexSynonyms: [], functionalClasses: [], cas: null, labelNames: [] },

  { code: 'e541', ins: '541', parent: null, isClassHeading: true,
    name: 'Sodium aluminium phosphates', codexSynonyms: [], functionalClasses: [], cas: null, labelNames: [] },

  { code: 'e420', ins: '420', parent: null, isClassHeading: true,
    name: 'Sorbitols', codexSynonyms: [], functionalClasses: [], cas: null, labelNames: [] },

  { code: 'e433', ins: '433', parent: null, isClassHeading: false,
    name: 'Polyoxyethylene (20) sorbitan monooleate', codexSynonyms: [],
    functionalClasses: ['Emulsifier', 'Stabilizer'], cas: null, labelNames: [] },

  { code: 'e435', ins: '435', parent: null, isClassHeading: false,
    name: 'Polyoxyethylene (20) sorbitan monostearate', codexSynonyms: [],
    functionalClasses: ['Emulsifier', 'Stabilizer'], cas: null, labelNames: [] },

  { code: 'e481i', ins: '481(i)', parent: 'e481', isClassHeading: false,
    name: 'Sodium stearoyl lactylate', codexSynonyms: [],
    functionalClasses: ['Emulsifier', 'Flour treatment agent', 'Foaming agent', 'Stabilizer'],
    cas: null, labelNames: [] },

  { code: 'e1400', ins: '1400', parent: null, isClassHeading: false,
    name: 'Dextrins, roasted starch', codexSynonyms: [],
    functionalClasses: ['Carrier', 'Emulsifier', 'Stabilizer', 'Thickener'],
    cas: null, labelNames: [] },
]

// ---------------------------------------------------------------------------
// CODES PRESENT IN THE CATALOGUE BUT ABSENT FROM THE 2015 CODEX TABLE.
//
// Recorded rather than filled in. `160c` (paprika extract, 5,154 products) and
// `306` (tocopherols, 3,640 products) are both real and both heavily used, and
// neither appears in the revision that was read. Either the later revision
// adds them or they are numbered differently; until that is checked they get
// no name and no class rather than a plausible one.
export const NOT_IN_CODEX_2015 = ['e160c', 'e306'] as const

// ---------------------------------------------------------------------------
const BY_CODE = new Map(ADDITIVES.map((a) => [a.code, a]))

/** Look up one additive by the code stored in `Product.additiveENumbers`. */
export function additive(code: string): Additive | null {
  return BY_CODE.get(code.trim().toLowerCase()) ?? null
}

/**
 * The functional classes to show for a code.
 *
 * A class heading has none of its own and does NOT borrow its children's —
 * see `isClassHeading`. Returns an empty array for an unknown code, never a
 * default, for the same reason `classificationMeaning()` in authorities.ts
 * returns null: a row we cannot explain must not borrow a neighbour's
 * explanation.
 */
export function functionalClassesFor(code: string): FunctionalClass[] {
  return additive(code)?.functionalClasses ?? []
}

/**
 * Codex's canonical name for a code, or null when we hold none.
 *
 * Null is a real answer here and must stay distinguishable from a name: 452
 * codes exist in the catalogue and this file covers the reach, not the tail.
 */
export function additiveName(code: string): string | null {
  return additive(code)?.name ?? null
}

/**
 * Codes whose label-name mapping is NOT yet citable.
 *
 * These are the `measured` rows: our catalogue shows the name and the code
 * describe one substance, but no published source we hold says so. They are
 * safe for internal joins and NOT safe for a sentence on a page that implies
 * a standard said it. Resolving them means a citation per name — 21 CFR 74 for
 * the US colour names, EU 231/2012 "Name and synonyms" for the rest.
 */
export function uncitedLabelNames(): { code: string; name: string }[] {
  return ADDITIVES.flatMap((a) =>
    a.labelNames.filter((n) => n.basis === 'measured').map((n) => ({ code: a.code, name: n.name }))
  )
}

// ---------------------------------------------------------------------------
// PARENTS REFERENCED BUT NOT YET SOURCED.
//
// `e339ii` and `e481i` are sub-entries whose parent heading has not been read
// from the standard, because neither parent appears on enough products to have
// reached this file's reach cut. Listed explicitly so the selftest can tell a
// known gap from a typo — a dangling parent is otherwise indistinguishable
// from a misspelled one.
export const UNSOURCED_PARENTS = ['e339', 'e481'] as const

// ------------------------------------------------------------------ selftest
//   npx tsx src/lib/additives.ts --selftest
//
// Every case here is an INVARIANT of the table, not a restatement of its
// contents. A test that asserted "e330 is citric acid" would only prove the
// row had not been edited; these prove the table cannot be internally
// inconsistent, which is the failure mode hand-written reference data has.
if (typeof process !== 'undefined' && process.argv?.includes('--selftest')) {
  let bad = 0
  const fail = (msg: string) => {
    bad++
    console.log(`FAIL ${msg}`)
  }

  // 1. codes are unique. A duplicate silently shadows one row in the Map.
  const seen = new Set<string>()
  for (const a of ADDITIVES) {
    if (seen.has(a.code)) fail(`duplicate code ${a.code}`)
    seen.add(a.code)
  }

  // 2. code shape matches what Product.additiveENumbers actually stores.
  for (const a of ADDITIVES) {
    if (!/^e\d+[a-z]*$/.test(a.code)) fail(`code ${JSON.stringify(a.code)} is not of the form e<number><letters>`)
  }

  // 3. THE INS NUMBER AND THE CODE MUST AGREE. Codex prints '322(i)'; OFF
  //    stores 'e322i'. Stripping punctuation from one must produce the other,
  //    or a row has been transcribed from the wrong line of the standard.
  for (const a of ADDITIVES) {
    const derived = 'e' + a.ins.replace(/[^a-z0-9]/gi, '').toLowerCase()
    if (derived !== a.code) fail(`ins ${JSON.stringify(a.ins)} derives ${derived}, not ${a.code}`)
  }

  // 4. A class heading has no classes, and anything with no classes is either
  //    a heading or an admitted gap. This is the rule that stops a heading
  //    quietly inheriting its children's classes.
  for (const a of ADDITIVES) {
    if (a.isClassHeading && a.functionalClasses.length > 0) {
      fail(`${a.code} is a class heading but carries ${a.functionalClasses.length} classes`)
    }
    if (!a.isClassHeading && a.functionalClasses.length === 0) {
      fail(`${a.code} is not a heading yet has no functional class`)
    }
  }

  // 5. parents resolve, or are an admitted gap.
  for (const a of ADDITIVES) {
    if (a.parent === null) continue
    if (!BY_CODE.has(a.parent) && !(UNSOURCED_PARENTS as readonly string[]).includes(a.parent)) {
      fail(`${a.code} has parent ${a.parent}, which is neither in the table nor in UNSOURCED_PARENTS`)
    }
    if (!a.code.startsWith(a.parent)) fail(`${a.code} does not sit under its parent ${a.parent}`)
  }

  // 6. label names must be in the form our Ingredient.name rows use, or the
  //    join silently finds nothing.
  for (const a of ADDITIVES) {
    for (const n of a.labelNames) {
      if (n.name !== n.name.toLowerCase().trim()) fail(`${a.code} label name ${JSON.stringify(n.name)} is not lowercase/trimmed`)
      if (n.name === '') fail(`${a.code} has an empty label name`)
    }
    const dupes = a.labelNames.map((n) => n.name)
    if (new Set(dupes).size !== dupes.length) fail(`${a.code} repeats a label name`)
  }

  // 7. CAS is null everywhere for now, and if ever set must look like a CAS.
  for (const a of ADDITIVES) {
    if (a.cas !== null && !/^\d{2,7}-\d{2}-\d$/.test(a.cas)) fail(`${a.code} cas ${JSON.stringify(a.cas)} is not a CAS registry format`)
  }

  // 8. a code we admit we have not sourced must not also be in the table.
  for (const c of NOT_IN_CODEX_2015) {
    if (BY_CODE.has(c)) fail(`${c} is listed as absent from Codex 2015 but also present in the table`)
  }

  // 9. lookups: case-insensitive, and an unknown code claims nothing.
  if (additive('E330')?.code !== 'e330') fail('additive() should be case-insensitive')
  if (additive('  e330 ')?.code !== 'e330') fail('additive() should trim')
  if (additive('e9999') !== null) fail('an unknown code must return null, not a default')
  if (additiveName('e9999') !== null) fail('additiveName of an unknown code must be null')
  if (functionalClassesFor('e9999').length !== 0) fail('an unknown code must yield no classes')
  if (functionalClassesFor('e322').length !== 0) fail('a class heading must yield no classes of its own')
  if (functionalClassesFor('e330').length !== 4) fail('e330 should carry its four Codex classes')

  // 10. the uncited list contains only measured names, and nothing codex-backed.
  const uncited = uncitedLabelNames()
  for (const u of uncited) {
    const row = additive(u.code)
    const entry = row?.labelNames.find((n) => n.name === u.name)
    if (entry?.basis !== 'measured') fail(`uncitedLabelNames returned ${u.code}/${u.name}, which is not 'measured'`)
  }
  const measuredTotal = ADDITIVES.reduce(
    (n, a) => n + a.labelNames.filter((x) => x.basis === 'measured').length, 0)
  if (uncited.length !== measuredTotal) fail(`uncitedLabelNames returned ${uncited.length} of ${measuredTotal} measured names`)

  const headings = ADDITIVES.filter((a) => a.isClassHeading).length
  const withNames = ADDITIVES.filter((a) => a.labelNames.length > 0).length
  console.log(
    `additives: ${ADDITIVES.length} codes, ${headings} class headings, ` +
      `${withNames} with label names, ${uncited.length} label names still uncited, ` +
      `${ADDITIVES.filter((a) => a.cas === null).length} without CAS`
  )
  console.log(bad === 0 ? 'additives: all cases pass' : `additives: ${bad} FAILURES`)
}

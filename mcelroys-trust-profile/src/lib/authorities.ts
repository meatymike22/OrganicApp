import type { StatusKey } from '@/lib/design'

// THE AUTHORITIES, AND WHAT THEIR WORDS MEAN.
//
// Michael, 2026-10-07: "i would like to use all of the authority
// classifications that yuka uses, and... in the documentation we disclaim
// that these aren't studies but are authority classifications. They can be
// listed as 'another' research category with a clickable link where the user
// can check the source if they want to."
//
// So this file does three jobs, and the split matters:
//
//   1. Names the nine bodies, with what each one actually IS. A reader who
//      has never heard of JECFA cannot weigh "JECFA set an ADI" without it.
//   2. Turns each body's own classification string into one plain-English
//      line. The verbatim string stays in the database; the translation lives
//      here so a wording correction never requires a re-ingest.
//   3. Fixes the status colour for each code, which is how the page shows
//      severity without ever printing a score.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a classification is not a study and
// is not a verdict. "IARC Group 2B" means a committee reviewed the evidence
// and placed the substance in a category. It does not mean the substance
// harms anyone at the doses in food, and nothing here may imply that it does.
// Every plain-English line below is a translation of what the authority said,
// never a conclusion we drew from it. /sourcing explains this to the reader
// and every row links there.

export type AuthorityKey =
  | 'iarc'
  | 'oehha_prop65'
  | 'efsa'
  | 'echa'
  | 'anses'
  | 'health_canada'
  | 'jecfa'
  | 'fda'
  | 'ineris'

export type Authority = {
  key: AuthorityKey
  // Short name for a chip or a row label.
  short: string
  // Full name, spelled out, because the acronyms are meaningless to a shopper.
  name: string
  // One line on what kind of body it is and what its word is worth. This is
  // the sentence that lets a reader weigh the record.
  what: string
  // Where its published assessments live.
  homeUrl: string
}

// The nine bodies Yuka's own documentation names, in the order a reader is
// most likely to have heard of them.
export const AUTHORITIES: Record<AuthorityKey, Authority> = {
  iarc: {
    key: 'iarc',
    short: 'IARC',
    name: 'International Agency for Research on Cancer',
    what: 'The World Health Organization’s cancer research agency. Its working groups review the published evidence on a substance and place it in one of four categories. The category describes how strong the evidence is, not how dangerous the substance is at the amounts found in food.',
    homeUrl: 'https://monographs.iarc.who.int/list-of-classifications',
  },
  oehha_prop65: {
    key: 'oehha_prop65',
    short: 'Prop 65',
    name: 'California Office of Environmental Health Hazard Assessment',
    what: 'California keeps a legal list of substances the state has determined can cause cancer or reproductive harm. A listing is a regulatory decision by one US state, and it triggers a warning label requirement there. It is not a finding about any particular product.',
    homeUrl: 'https://oehha.ca.gov/proposition-65/proposition-65-list',
  },
  efsa: {
    key: 'efsa',
    short: 'EFSA',
    name: 'European Food Safety Authority',
    what: 'The European Union’s food safety body. It re-evaluates approved additives and publishes an opinion, often including a daily intake it considers safe. Its opinions are advice to EU regulators rather than law.',
    homeUrl: 'https://www.efsa.europa.eu/en/publications',
  },
  echa: {
    key: 'echa',
    short: 'ECHA',
    name: 'European Chemicals Agency',
    what: 'The EU’s chemicals agency. It holds the classification and labelling of chemical substances across all uses, not only food — so a hazard class here may describe industrial handling rather than eating.',
    homeUrl: 'https://echa.europa.eu/information-on-chemicals',
  },
  anses: {
    key: 'anses',
    short: 'ANSES',
    name: 'French Agency for Food, Environmental and Occupational Health & Safety',
    what: 'France’s national food and health safety agency. It publishes its own opinions, which sometimes reach a different conclusion from EFSA on the same substance — a disagreement worth seeing rather than averaging away.',
    homeUrl: 'https://www.anses.fr/en/content/anses-opinions',
  },
  health_canada: {
    key: 'health_canada',
    short: 'Health Canada',
    name: 'Health Canada',
    what: 'Canada’s federal health department. It maintains its own lists of permitted food additives and the conditions on them, which differ in places from the US list.',
    homeUrl: 'https://www.canada.ca/en/health-canada/services/food-nutrition/food-safety/food-additives.html',
  },
  jecfa: {
    key: 'jecfa',
    short: 'JECFA',
    name: 'Joint FAO/WHO Expert Committee on Food Additives',
    what: 'A joint committee of the UN’s Food and Agriculture Organization and the World Health Organization. It is the international reference point for how much of an additive is considered safe to consume daily over a lifetime.',
    homeUrl: 'https://www.who.int/groups/joint-fao-who-expert-committee-on-food-additives-(jecfa)',
  },
  fda: {
    key: 'fda',
    short: 'FDA',
    name: 'US Food and Drug Administration',
    what: 'The US food regulator. Its inventory records which substances may be added to food and on what basis — including the ones permitted as “generally recognized as safe”, a status that does not require FDA review of every use.',
    homeUrl: 'https://www.cfsanappsexternal.fda.gov/scripts/fdcc/?set=FoodSubstances',
  },
  ineris: {
    key: 'ineris',
    short: 'INERIS',
    name: 'French National Institute for Industrial Environment and Risks',
    what: 'A French public research institute on industrial and environmental risk. Its substance assessments are mostly about exposure outside food, so a record here is context rather than a food finding.',
    homeUrl: 'https://substances.ineris.fr/en',
  },
}

// WHAT EACH CLASSIFICATION CODE MEANS.
//
// `plain` is the line a shopper reads. It is a translation of the authority's
// own category and nothing more — it never says "harmful", "safe", "avoid" or
// "fine", because none of those is what a classification states.
//
// `state` is the status colour. Note that NOTHING here is `confirmed` green:
// a hazard classification is never good news and never a clean bill of
// health, so the palette's "the record confirms it" green would be a
// category error in both directions. The strongest classifications take the
// recall clay; the weaker and the purely administrative ones take the amber
// open-research colour or neutral grey.
export type ClassificationMeaning = {
  code: string
  // Short label for a chip.
  label: string
  // One plain line, for the reader who will not read the verbatim string.
  plain: string
  state: StatusKey
}

export const CLASSIFICATIONS: Record<string, ClassificationMeaning> = {
  // --- IARC: four categories, about strength of evidence ---
  group_1: {
    code: 'group_1',
    label: 'IARC Group 1',
    plain: 'IARC concluded there is enough evidence that this causes cancer in people. That is a statement about the strength of the evidence, not about the amounts used in food.',
    state: 'recall',
  },
  group_2a: {
    code: 'group_2a',
    label: 'IARC Group 2A',
    plain: 'IARC considers this probably capable of causing cancer in people, based on limited human evidence and stronger animal evidence.',
    state: 'recall',
  },
  group_2b: {
    code: 'group_2b',
    label: 'IARC Group 2B',
    plain: 'IARC considers this possibly capable of causing cancer in people. This is the weakest of its three positive categories and often rests on animal studies alone.',
    state: 'openResearch',
  },
  group_3: {
    code: 'group_3',
    label: 'IARC Group 3',
    plain: 'IARC reviewed this and found the evidence too limited to classify either way. It is explicitly not a finding of safety.',
    state: 'nothingOnFile',
  },

  // --- California Prop 65: a legal listing, by type of toxicity ---
  cancer: {
    code: 'cancer',
    label: 'Prop 65 — cancer',
    plain: 'California has listed this as a substance the state has determined can cause cancer. A listing requires a warning on products sold in California above a set level.',
    state: 'recall',
  },
  developmental_toxicity: {
    code: 'developmental_toxicity',
    label: 'Prop 65 — developmental',
    plain: 'California has listed this as a substance the state has determined can cause developmental harm, meaning harm to a developing baby.',
    state: 'recall',
  },
  reproductive_toxicity: {
    code: 'reproductive_toxicity',
    label: 'Prop 65 — reproductive',
    plain: 'California has listed this as a substance the state has determined can cause reproductive harm.',
    state: 'recall',
  },

  // --- Intake limits ---
  adi: {
    code: 'adi',
    label: 'Daily intake limit',
    plain: 'An authority has set an amount considered safe to consume every day over a lifetime. A limit existing is normal for an approved additive — it is not a warning.',
    state: 'unchecked',
  },
  adi_withdrawn: {
    code: 'adi_withdrawn',
    label: 'Intake limit withdrawn',
    plain: 'An authority withdrew its previously published safe-intake figure, usually because it decided the evidence no longer supported one.',
    state: 'openResearch',
  },

  // --- Permission / review outcomes ---
  permitted: {
    code: 'permitted',
    label: 'Permitted',
    plain: 'The authority permits this substance in food, under the conditions its own listing sets out.',
    state: 'unchecked',
  },
  banned: {
    code: 'banned',
    label: 'Not permitted',
    plain: 'The authority does not permit this substance in food in its jurisdiction.',
    state: 'recall',
  },
  under_review: {
    code: 'under_review',
    label: 'Under review',
    plain: 'The authority has an open re-evaluation of this substance and has not published a conclusion yet.',
    state: 'openResearch',
  },
  gras: {
    code: 'gras',
    label: 'GRAS listing',
    plain: 'Listed in the US as “generally recognized as safe”. Worth knowing what that means: this status can be self-determined by a manufacturer and does not always involve an FDA review of that specific use.',
    state: 'unchecked',
  },
}

// The meaning for a code, or null for one we have not described. Returning
// null rather than a default matters: a row we cannot explain must not be
// rendered with a borrowed explanation that happens to be wrong.
export function classificationMeaning(code: string): ClassificationMeaning | null {
  return CLASSIFICATIONS[code] ?? null
}

export function authority(key: string): Authority | null {
  return (AUTHORITIES as Record<string, Authority>)[key] ?? null
}

// Sort order for a list of assessments: strongest statement first, then by
// authority name, so a Group 1 never sits below an administrative listing.
const CODE_WEIGHT: Record<string, number> = {
  group_1: 0,
  cancer: 1,
  developmental_toxicity: 1,
  reproductive_toxicity: 1,
  group_2a: 2,
  banned: 2,
  group_2b: 3,
  adi_withdrawn: 4,
  under_review: 5,
  group_3: 6,
  adi: 7,
  gras: 8,
  permitted: 9,
}

export function assessmentWeight(code: string): number {
  return CODE_WEIGHT[code] ?? 50
}

// WHICH OF THE NINE MAJOR ALLERGENS AN INGREDIENT NAME NAMES.
//
// Michael, on the search filter rail, 2026-10-08: "also add allergens to
// this filter list."
//
// READ THIS FIRST, because it is the whole reason the module is written the
// way it is. An allergen filter is not an additive filter. If the "no
// preservatives" filter lets a product through by mistake, a shopper reads a
// label they did not expect to read. If an allergen filter lets a product
// through by mistake, someone can be hurt. So three rules govern everything
// below, and they are not negotiable:
//
//   1. OVER-MATCHING IS THE SAFE DIRECTION. Where the evidence is
//      ambiguous — "natural butter flavor", "artificial crab flavor",
//      "non-dairy creamer" — this module says the allergen is present. The
//      cost is a product wrongly withheld from a filtered list, which is an
//      inconvenience. The cost of the other error is not.
//
//   2. A PRODUCT WITH NO INGREDIENT LIST, OR WITH AN UNCLASSIFIED
//      INGREDIENT ON IT, NEVER PASSES AN ALLERGEN FILTER. This is the
//      opposite of how the additive filters work, deliberately: see the long
//      note in ingredientFilters.ts. An absence in our data is not an
//      absence in the food, and here that difference is a safety matter.
//
//   3. THIS IS NOT THE LABEL'S "CONTAINS" STATEMENT. It is derived from the
//      ingredient list we hold. It cannot see cross-contamination ("may
//      contain traces of peanuts"), it cannot see inside "natural flavor",
//      and a crowdsourced ingredient list can be incomplete. Every surface
//      that uses this has to say so. Nobody should be making a medical
//      decision from our filter instead of the package in their hand.
//
// WHICH NINE. The US major food allergens, as defined by FALCPA (2004) and
// extended by the FASTER Act (2021), which added sesame from 1 January 2023:
// milk, eggs, fish, crustacean shellfish, tree nuts, peanuts, wheat,
// soybeans and sesame.
//
// TWO PLACES THIS DEPARTS FROM THE STATUTORY LIST, both stated on the
// filter itself rather than hidden here:
//   - SHELLFISH covers molluscs (clam, oyster, mussel, scallop, squid) as
//     well as crustaceans. FALCPA names crustaceans only. Someone avoiding
//     shellfish is usually avoiding both, and the honest way to handle the
//     difference is to include them and say so.
//   - TREE NUT includes coconut, because FDA's own tree-nut list for
//     labelling purposes includes it. That decision is FDA's and not ours,
//     which is why it is followed rather than corrected; the filter says it
//     out loud, because coconut allergy is rare and distinct and someone
//     avoiding walnuts will wonder why coconut oil disappeared.

export const ALLERGENS = [
  'milk',
  'egg',
  'fish',
  'shellfish',
  'tree nut',
  'peanut',
  'wheat',
  'soy',
  'sesame',
] as const

export type Allergen = (typeof ALLERGENS)[number]

// Each rule is: the allergen, the strings whose presence names it, and the
// strings that must be neutralised BEFORE the test.
//
// WHY NEUTRALISE RATHER THAN REJECT. "cocoa butter" is not dairy, so a name
// containing it must not match milk on the word "butter". The naive way is
// to reject the whole name when it contains "cocoa butter" — but then an
// ingredient recorded as "cocoa butter, milk" would be classified as
// containing no milk, which is the dangerous error. So the exclusion
// replaces its own text with a separator and the keyword test runs on what
// is left. "cocoa butter, milk" becomes "|, milk" and still matches.
//
// A VETO IS NOT A NEUTRALISATION, and the difference cost two selftest
// failures before it existed. Neutralising a phrase removes that phrase and
// tests what is left, which is right for "cocoa butter" and wrong for
// "gluten free pasta": take out "gluten free" and the word "pasta" is still
// sitting there to match. A veto says this name is not this allergen, full
// stop, whatever else is in it. It is reserved for phrases that are
// dispositive by law or by labelling convention — "gluten free" means under
// 20 ppm by FDA rule, "peanut free" is a claim a manufacturer can be held to
// — because a veto can only cause the dangerous kind of error, and the list
// has to stay short enough to argue for line by line.
//
// `keywords` MATCH ANYWHERE, `wordKeywords` ONLY AT THE START OF A WORD.
//
// Most allergen words have to match anywhere, because food names genuinely
// bury them inside other words: almondmilk, soymilk, buttermilk, catfish,
// whitefish. But a three- or four-letter word matched anywhere will find
// itself inside something unrelated, and an audit of the 858 ingredient
// names on 400 or more products found two live examples:
//
//   "orange peel" and "lemon peel" came back as FISH, because "eel" is
//   inside "p-eel".
//   "annatto", "annatto extract" and "annatto color" came back as SOY,
//   because "natto" is inside "an-natto". Annatto is a colouring from
//   achiote seed and contains no soy at all.
//
// So the short ones live in wordKeywords, where "eel" matches eel and not
// peel. They are all words that appear at the START of a food name or after
// a space, never as the tail of a compound, which is what makes the
// restriction safe for them and wrong for "fish".
//
// `exactWords` IS STRICTER STILL: the whole word, plus an optional trailing
// "s" so one entry covers its plural.
//
// The first dry run over all 127,268 ingredient names, 2026-10-08, showed
// why a word START is not enough for the shortest ones. "cod" at the start
// of a word reaches into "code" — and the catalogue contains "can code",
// "dry place lot code and best by", "please refer to the code on end of
// can", "codium phosphate", "codonopsis root" and "codeage helix liposomal".
// None of them is fish. "sole" reached "soleil", "solero" and "solely inc.
// la jolla"; "carp" reached "carpeting".
//
// The same run found "egg" matching in the middle of words, on about sixty
// names: every "veggie …" (v-egg-ie), every "parmigiano reggiano …"
// (r-egg-iano) and "taleggio cheese". So "egg" is an exact word now too,
// which costs the two names that genuinely bury it — "wholeegg" and
// "cage-freeggs", 3 products between them — and those are picked up by
// EXACT_NAMES instead.
//
// Note "cod" needs no entry for codfish: the `fish` keyword matches it, as
// it does catfish, swordfish, sablefish, rockfish and the rest.
const RULES: {
  allergen: Allergen
  keywords: string[]
  wordKeywords: string[]
  exactWords: string[]
  neutralise: string[]
  veto: string[]
}[] = [
  {
    allergen: 'milk',
    // Counts, read off our own database on 2026-10-08: milk 18,118 products,
    // cream 15,455, whey 15,453, cheese cultures 14,011, butter 9,761.
    keywords: [
      'milk', 'butter', 'cream', 'cheese', 'whey', 'casein', 'caseinate',
      'lactose', 'lactalbumin', 'lactoglobulin', 'lactoferrin',
      'yogurt', 'yoghurt', 'custard', 'kefir', 'dairy',
      'quark', 'ricotta', 'mascarpone', 'paneer', 'half and half',
      // Rennet is an enzyme from a calf's stomach rather than a milk
      // protein, but it appears only in cheese and a label that lists it
      // lists dairy.
      'rennet',
      // NAMED CHEESES AND DAIRY FOODS THAT SAY NO DAIRY WORD AT ALL.
      //
      // The first full dry run, 2026-10-08, showed these coming back with no
      // allergen: romano (105 products), mozzarella (88), asiago (84),
      // creme fraiche (45), monterey jack (44), provolone (40), fresh
      // mozzarella (19), smoked gouda (16), gouda (13), fontina (12), skyr
      // (12), colby (12), queso quesadilla (11), parmigiano reggiano (10),
      // dulce de leche (10) — plus every "low moisture part skim
      // mozzarella" variant.
      //
      // An ingredient list that says "mozzarella" and nothing else is a
      // dairy product reported as dairy-free, which is the failure that
      // matters. The ones with their own cheese-word elsewhere in the name
      // were already caught; these are the bare ones.
      'mozzarella', 'romano', 'asiago', 'provolone', 'gouda', 'fontina',
      'colby', 'monterey jack', 'parmigiano', 'reggiano', 'taleggio',
      'pecorino', 'gorgonzola', 'camembert', 'havarti', 'gruyere',
      'gruy\u00e8re', 'emmental', 'manchego', 'queso', 'cotija', 'burrata',
      'grana padano', 'muenster', 'neufchatel', 'halloumi', 'skyr',
      'creme fraiche', 'cr\u00e8me fra\u00eeche', 'dulce de leche',
    ],
    wordKeywords: ['ghee'],
    // 'edam' as a substring would claim "edamame", which is on 209 products
    // and is soy. 'brie' and 'feta' are short enough to deserve the same
    // caution. All three still match their own plurals.
    exactWords: ['curd', 'edam', 'brie', 'feta'],
    // "cheese cultures" IS kept as milk, on rule 1: the cultures themselves
    // are bacteria, but they are grown on a dairy medium and the only food
    // that lists them is cheese.
    neutralise: [
      // Plant fats and nut butters. cocoa butter alone is on 14,720 products,
      // so without this exclusion a milk filter would hide most chocolate.
      'cocoa butter', 'cacao butter', 'coco butter', 'shea butter',
      'peanut butter', 'almond butter', 'cashew butter', 'pecan butter',
      'walnut butter', 'hazelnut butter', 'pistachio butter', 'nut butter',
      'sunflower butter', 'sunflower seed butter', 'pumpkin seed butter',
      'seed butter', 'soy butter', 'soybean butter', 'coconut butter',
      'mango butter', 'cupuacu butter', 'apple butter', 'pumpkin butter',
      'maple butter', 'honey butter spread',
      // Vegetables and plants that merely contain the letters.
      'butter lettuce', 'butterhead', 'buttercup squash', 'butternut',
      'butterfly pea', 'butterbur', 'milk thistle',
      // Plant milks and creams.
      'coconut milk', 'coconut cream', 'cream of coconut', 'coconutmilk',
      'almond milk', 'almondmilk', 'cashew milk', 'cashewmilk',
      'soy milk', 'soymilk', 'soya milk', 'oat milk', 'oatmilk',
      'rice milk', 'ricemilk', 'hemp milk', 'hempmilk', 'flax milk',
      'pea milk', 'peamilk', 'banana milk', 'walnut milk', 'macadamia milk',
      'pistachio milk', 'sesame milk', 'potato milk', 'quinoa milk',
      'hazelnut milk', 'cashew cream', 'oat cream', 'soy cream',
      // Not dairy at all.
      'cream of tartar', 'creamed honey', 'cream of wheat',
      // "non-dairy cocoa butter" and "non-dairy lactic acid" are real
      // ingredient names in the database. The "dairy" keyword must not
      // catch the word that denies it. Note this does NOT neutralise
      // "non-dairy creamer", which commonly contains sodium caseinate: the
      // word "creamer" still matches, which is rule 1 working as intended.
      'non-dairy', 'non dairy', 'nondairy',
      // Milkfish is a fish. Found in the first dry run: "m-i-l-k-fish".
      'milkfish',
      // 2'-FUCOSYLLACTOSE IS NOT MILK, and this is the one on this list
      // that could have mattered. It is a human-milk oligosaccharide used
      // in infant formula, manufactured by microbial fermentation rather
      // than taken from milk, and FDA does not treat it as a milk allergen.
      // "lactose" sits inside "fucosyl|lactose", so 2'-fucosyllactose (43
      // products) and 3-fucosyllactose (11) were both coming back as dairy
      // — on infant formula, of all things.
      //
      // Note what is NOT here: "lactose free". Lactose-free milk still has
      // the milk PROTEINS in it, and those are the allergen; the lactose is
      // a digestion question and a different one.
      'fucosyllactose',
      // Plant milks written as one word. The spaced forms are above; these
      // are the spellings the catalogue actually uses in places:
      // nutmilk (16 products), flaxmilk (9).
      'nutmilk', 'nut milk', 'flaxmilk', 'seedmilk', 'plantmilk',
      'walnutmilk', 'pistachiomilk', 'macadamiamilk',
      // A romano BEAN is a borlotti bean, not a cheese. Two names, 5
      // products: "romano bean" and "whole romano bean flour". Note that
      // "romano cheese cove water soybean oil" is untouched by this — it
      // matches on "cheese" as well, which is the reason exclusions
      // neutralise a phrase rather than rejecting a whole name.
      'romano bean',
    ],
    veto: ['dairy free', 'dairy-free', 'milk free', 'milk-free'],
  },
  {
    allergen: 'egg',
    keywords: [
      'albumen', 'ovalbumin', 'ovomucoid', 'ovovitellin',
      'lysozyme', 'mayonnaise', 'meringue', 'livetin', 'vitellin', 'eggnog',
      // 'egg' itself is in exactWords below, not here. As a substring it
      // claimed about sixty names in the catalogue that are not egg.
      // 'globulin' was here and is gone: it is a whole class of proteins,
      // not an egg one, and as a substring it claims beta-lactoglobulin,
      // which is a MILK protein. The distinctive egg-white proteins are the
      // ovalbumin/ovomucoid/lysozyme group above.
    ],
    wordKeywords: ['aioli'],
    // 'mayo' as an exact word rather than a prefix: as a prefix it claimed
    // "mayocoba bean" (12 products), which is a bean. Mayonnaise itself is
    // matched by the full word in `keywords`.
    exactWords: ['egg', 'mayo'],
    // "eggplant" is on 168 products and contains no egg. "serum albumin"
    // and "bovine albumin" are not egg white.
    neutralise: ['eggplant', 'egg plant', 'eggshell calcium', 'bovine albumin', 'serum albumin'],
    veto: ['egg free', 'egg-free'],
  },
  {
    allergen: 'fish',
    keywords: [
      'fish', 'anchovy', 'anchovies', 'salmon', 'tuna', 'sardine', 'herring',
      'haddock', 'pollock', 'pollack', 'tilapia', 'trout',
      'catfish', 'mackerel', 'halibut', 'snapper', 'swordfish',
      'bonito', 'katsuobushi', 'surimi', 'caviar', 'whitefish',
      // Worcestershire sauce is made with anchovies and is on 783 products
      // plus 60 as a powder. The name does not say fish anywhere.
      'worcestershire',
    ],
    // The short ones. "eel" inside "orange peel" was a live false positive
    // before this split existed, and "roe" inside "roasted" was being held
    // off by a growing list of neutralisations that a word boundary
    // replaces outright.
    wordKeywords: [],
    exactWords: ['cod', 'eel', 'roe', 'bass', 'mahi', 'sole', 'hake', 'carp'],
    // "fish" inside catfish, swordfish, whitefish, codfish, sablefish,
    // rockfish, goatfish, milkfish, flatfish, lizardfish, cutlassfish and
    // flyingfish is the word we want, so none of those is here.
    //
    // These are NOT fish, and every one of them is a real ingredient name
    // the first dry run classified as one:
    //   shellfish (67 products), crustacean shellfish (37), crustaceans
    //   shellfish, mollusk shellfish — the shellfish rule has them, and a
    //   crustacean is not a fish.
    //   cuttlefish (21 plus extract, powder, ink and flake), crawfish (10),
    //   crayfish — a mollusc and two crustaceans. Also on the shellfish
    //   rule, which is where they belong.
    //   jellyfish (5) — a cnidarian, and not one of the nine at all.
    neutralise: [
      'sole source', 'sole ingredient',
      'shellfish', 'cuttlefish', 'crawfish', 'crayfish', 'jellyfish',
    ],
    veto: ['fish free', 'fish-free'],
  },
  {
    allergen: 'shellfish',
    keywords: [
      'shrimp', 'prawn', 'crab', 'lobster', 'crayfish', 'crawfish', 'krill',
      'langoustine', 'langostino', 'scampi', 'crustacean', 'shellfish',
      // Molluscs. See the header note on why they are in here.
      'oyster', 'mussel', 'scallop', 'squid', 'calamari', 'octopus',
      'abalone', 'whelk', 'periwinkle', 'snail', 'escargot',
      'cuttlefish',
    ],
    wordKeywords: ['conch', 'cockle'],
    // 'clam' as a substring claimed "sodium cyclamate" (9 products), which
    // is an artificial sweetener: cy-clam-ate. As an exact word it still
    // matches clam, clams, clam juice, clam broth, sea clam and baby clam.
    exactWords: ['clam'],
    neutralise: [
      // Real names in the database that contain a mollusc word and are not
      // shellfish: oyster mushroom (26 products), scalloped potatoes.
      'oyster mushroom', 'oyster plant', 'scalloped', 'crabapple', 'crab apple',
      'clamshell', 'snail mucin', 'conchiglie', 'cockle bread',
    ],
    veto: ['shellfish free', 'shellfish-free'],
  },
  {
    allergen: 'tree nut',
    keywords: [
      'almond', 'cashew', 'pecan', 'walnut', 'pistachio', 'macadamia',
      'hazelnut', 'filbert', 'brazil nut', 'pine nut', 'pinon', 'pignoli',
      'chestnut', 'beechnut', 'butternut', 'hickory nut', 'shea nut',
      'ginkgo nut', 'lychee nut', 'praline', 'marzipan', 'nougat',
      'gianduja', 'nutella', 'frangipane',
      // FDA's tree-nut list for labelling includes coconut. Stated on the
      // filter, because it is a surprise.
      'coconut',
      // The literal ingredient names "tree nut" (1,127 products), "other
      // tree nut" (156) and "nut" (239) are all in the database.
      'tree nut', 'mixed nut', 'nut meat', 'nut paste', 'nut butter',
    ],
    wordKeywords: [],
    neutralise: [
      // The "nut" traps, in product-count order: nutmeg 1,338, yeast
      // nutrient 466, nutritional yeast 377, butternut squash 347, water
      // chestnut 264. Peanut is a legume and has its own rule, so it is
      // neutralised here too.
      'nutmeg', 'nutrient', 'nutrition', 'nutritive', 'nutraceutical',
      'butternut squash', 'water chestnut', 'chestnut mushroom',
      'peanut', 'arachis', 'doughnut', 'donut',
      // 'coconut aminos' was neutralised here and is not any more. It is
      // made from coconut sap, so if coconut counts as a tree nut on this
      // filter then coconut aminos does too — and the catalogue stores the
      // singular "coconut amino" (91 products), which was being classified
      // as a tree nut anyway. One answer for both spellings.
      // "walnut" inside "black walnut" is wanted; nothing to exclude there.
    ],
    exactWords: [],
    veto: ['nut free', 'nut-free', 'tree nut free', 'tree-nut-free'],
  },
  {
    allergen: 'peanut',
    // 'ground nut' is NOT here — see EXACT_NAMES below. As a substring it
    // matched "ground nutmeg".
    keywords: ['peanut', 'arachis', 'groundnut', 'beer nut', 'monkey nut'],
    wordKeywords: ['goober'],
    exactWords: [],
    neutralise: [],
    veto: ['peanut free', 'peanut-free'],
  },
  {
    allergen: 'wheat',
    keywords: [
      'wheat', 'semolina', 'durum', 'farina', 'spelt', 'kamut', 'couscous',
      'seitan', 'bulgur', 'bulghur', 'einkorn', 'emmer', 'triticale',
      'freekeh', 'matzo', 'matzah', 'matzoh', 'graham flour',
      'graham cracker', 'graham crumb', 'vital gluten', 'wheatgerm',
      // Foods that are wheat by their US standard of identity and whose
      // names say no grain at all. Counts on 2026-10-08: bread crumb 946
      // products, pasta 700, pretzel 543, enriched macaroni product 501,
      // breadcrumb 364, noodle 229, enriched egg noodle 202, crouton 81,
      // cracker meal 67. Missing these is a wheat filter that passes a
      // packet of spaghetti.
      //
      // 'phyllo' and 'filo' are deliberately absent: neither appears in the
      // catalogue, and 'phyllo' is inside "phylloquinone" — vitamin K1, on
      // 242 products.
      'pasta', 'noodle', 'macaroni', 'pretzel', 'crouton', 'panko',
      'bread crumb', 'breadcrumb', 'cracker meal',
      // A real misspelling in the data: "whet flour", 16 products.
      'whet flour',
    ],
    wordKeywords: [],
    exactWords: [],
    neutralise: [
      // Buckwheat is not wheat and is not even a grass: 463 products plus
      // 240 as flour.
      'buckwheat', 'wheatgrass', 'wheat grass',
      // Pastas and noodles made of something else. "rice noodle" is on 95
      // products; the rest are here because the composite-food keywords
      // above would otherwise claim them. These stay NEUTRALISATIONS rather
      // than vetoes, so a name that lists both a rice pasta and a wheat
      // flour still comes out as wheat.
      'rice noodle', 'rice pasta', 'rice macaroni', 'brown rice pasta',
      'corn pasta', 'chickpea pasta', 'lentil pasta', 'quinoa pasta',
      'legume pasta', 'bean pasta', 'edamame pasta', 'shirataki',
      'konjac', 'glass noodle', 'cellophane noodle', 'mung bean noodle',
      'zucchini noodle', 'vegetable noodle', 'palmini',
      // NOT 'soba'. Most commercial soba is majority wheat flour with
      // buckwheat for flavour, so calling a soba noodle wheat is both the
      // safe answer and usually the true one.
    ],
    veto: ['gluten free', 'gluten-free', 'glutenfree', 'wheat free', 'wheat-free'],
  },
  {
    allergen: 'soy',
    keywords: ['soy', 'soya', 'edamame', 'tofu', 'tempeh', 'tamari'],
    // "natto" is inside "annatto", a seed colouring on several hundred
    // products with no soy in it. "miso" is inside nothing common, but it
    // is four letters and sits here with the rest for the same reason.
    // These stay PREFIXES rather than exact words. "soja" is soy in German,
    // Dutch and Danish and the catalogue has sojabohnen, sojasauce, sojaol,
    // sojameel, sojalecithin, sojaproteincrisps and sojaeiweißkonzentrat.
    // "natto" has to reach nattokinase, which is made from fermented
    // soybeans and is soy.
    wordKeywords: ['soja', 'miso', 'natto', 'okara', 'yuba'],
    exactWords: [],
    veto: ['soy free', 'soy-free', 'soya free'],
    neutralise: [
      // "tamarind" contains "tamari" and is on 1,059 products plus several
      // hundred more as extract, paste, concentrate and gum.
      'tamarind',
      // Highly refined soybean oil and soy lecithin are exempt from FALCPA
      // labelling as allergens, and some authorities consider them safe for
      // most soy-allergic people. They are NOT neutralised here: rule 1,
      // and a shopper who filtered out soy did not ask us to decide which
      // soy derivatives are fine for them.
    ],
  },
  {
    allergen: 'sesame',
    keywords: ['sesame', 'tahini', 'tahina', 'sesamum', 'gingelly', 'benne seed', 'til seed'],
    wordKeywords: ['halvah', 'halva'],
    exactWords: [],
    neutralise: [],
    veto: ['sesame free', 'sesame-free'],
  },
]

// WHEN A BARE "FLOUR" MEANS WHEAT.
//
// Under 21 CFR 137.105 an unqualified "flour" on a US label is wheat flour.
// The database has 7,124 products listing "enriched flour", 4,484 listing
// plain "flour", 2,037 "enriched bleached flour" and so on, none of which
// contains the word wheat. Missing those would be the single biggest hole in
// a wheat filter.
//
// But "rice flour" (7,141 products), "corn flour" (3,048), "soy flour"
// (3,979), "malted barley flour" (9,205), "almond flour", "coconut flour",
// "cauliflower flour", "citrus flour", "gram flour", "konjac flour" and
// "gluten free flour" are all flour and none of them is wheat.
//
// So the test is not a keyword, it is a shape: a name containing "flour"
// where EVERY other word is a word that does not name a grain. Add a grain
// and the name stops qualifying; the rule needs no list of grains to
// exclude, which is what makes it safe to extend. "flour treatment agent"
// fails on "treatment", "gluten free flour" fails on "free", "catalina
// flour" fails on "catalina" — the last of those under-matches 24 products,
// and a brand name we cannot read is a thing to leave alone rather than
// guess at.
const FLOUR_QUALIFIERS = new Set([
  'flour', 'enriched', 'enrich', 'bleached', 'unbleached', 'bromated',
  'unbromated', 'white', 'all', 'purpose', 'all-purpose', 'allpurpose',
  'bread', 'cake', 'pastry', 'self', 'rising', 'raising', 'self-rising',
  'high', 'gluten', 'strong', 'blend', 'blended', 'mix', 'tortilla',
  'whole', 'grain', 'ancient', 'niacin', 'water', 'non-gmo', 'nongmo',
  'organic', 'fortified', 'sifted', 'fine', 'finely', 'milled', 'stone',
  'stoneground', 'ground', 'premium', 'and', 'with', 'or', 'the', 'a',
])

// NAMES THAT ONLY WORK AS WHOLE NAMES.
//
// "nut" is in the database as an ingredient on 239 products and plainly
// means a tree nut, but as a substring it is inside nutmeg, nutrient,
// doughnut and peanut. "ground nut" is a spelling of groundnut, and as a
// substring it is inside "ground nutmeg" — which the selftest caught
// returning `peanut`, for 101 products of ground nutmeg.
//
// Both belong here rather than in the keyword lists: an exact name carries
// no risk of being found inside another one.
const EXACT_NAMES: Record<string, Allergen[]> = {
  nut: ['tree nut'],
  nuts: ['tree nut'],
  'mixed nut': ['tree nut'],
  'mixed nuts': ['tree nut'],
  'ground nut': ['peanut'],
  'ground nuts': ['peanut'],
  // "egg" became an exact word to keep it out of "veggie" and "reggiano".
  // These two are the only names in the catalogue that bury it and mean it.
  wholeegg: ['egg'],
  'cage-freeggs': ['egg'],
}

function isUnqualifiedFlour(name: string): boolean {
  const words = name.split(/[^a-z0-9-]+/).filter(Boolean)
  if (!words.includes('flour')) return false
  return words.every((w) => FLOUR_QUALIFIERS.has(w))
}

// A NEUTRALISATION MATCHES AT THE START OF A WORD, NOT ANYWHERE.
//
// Found by the selftest below, and it is the clearest argument for having
// one: "pasteurized goat milk" came back with no allergen at all, because
// the plant-milk exclusion "oat milk" sits inside "g|oat milk". A dairy
// product reported as dairy-free is the exact failure this module is written
// to prevent.
//
// So an exclusion has to begin where a word begins. The END is left open on
// purpose, so one entry covers its own plurals and suffixes: "nutrient"
// neutralises "nutrients", "peanut" neutralises "peanuts". Keyword matching
// stays plain substring, because the allergen words genuinely appear inside
// other words — "almondmilk", "soymilk", "catfish", "buttermilk".
// True when `phrase` appears in `text` starting at a word boundary. Same
// rule the neutralisation below uses, and for the same reason.
function hasWord(text: string, phrase: string): boolean {
  let i = 0
  for (;;) {
    const at = text.indexOf(phrase, i)
    if (at < 0) return false
    const before = at === 0 ? '' : text[at - 1]!
    if (!/[a-z0-9]/.test(before)) return true
    i = at + 1
  }
}

// True when `phrase` appears in `text` as a WHOLE word, allowing a trailing
// "s" so one entry covers its own plural: "curd" matches "curds and whey",
// "eel" matches "eels", and neither matches "curdled" or "peel".
//
// Only a bare "s" is allowed, not "es". That is what keeps "cod" out of
// "codes" while still matching "cods".
function hasExactWord(text: string, phrase: string): boolean {
  let i = 0
  for (;;) {
    const at = text.indexOf(phrase, i)
    if (at < 0) return false
    i = at + 1
    const before = at === 0 ? '' : text[at - 1]!
    if (/[a-z0-9]/.test(before)) continue
    let end = at + phrase.length
    if (text[end] === 's') end++
    const after = text[end]
    if (after === undefined || !/[a-z0-9]/.test(after)) return true
  }
}

function neutralise(text: string, phrase: string): string {
  let out = ''
  let i = 0
  for (;;) {
    const at = text.indexOf(phrase, i)
    if (at < 0) return out + text.slice(i)
    const before = at === 0 ? '' : text[at - 1]!
    if (/[a-z0-9]/.test(before)) {
      // Inside a longer word. Step past the first character so an
      // overlapping later occurrence is still found.
      out += text.slice(i, at + 1)
      i = at + 1
      continue
    }
    out += `${text.slice(i, at)} | `
    i = at + phrase.length
  }
}

// Lower-cased, with the certification marks the import leaves behind
// stripped. Real names in the database include "cocoa butter*+",
// "cocoa butter++" and "+cocoa butter" — the asterisks and plus signs are
// footnote markers from a label, and they must not break a match.
export function normaliseForAllergens(name: string): string {
  return name
    .toLowerCase()
    .replace(/[*+†‡®™°]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function classifyAllergens(name: string): Allergen[] {
  const normalised = normaliseForAllergens(name)
  const found: Allergen[] = []

  for (const rule of RULES) {
    if (rule.veto.some((phrase) => hasWord(normalised, phrase))) continue

    // Longest neutralisation first, so "sunflower seed butter" is removed as
    // one phrase rather than "seed butter" leaving "sunflower " behind — the
    // result is the same here, but a shorter phrase eating part of a longer
    // one is how this kind of pass goes wrong.
    let text = normalised
    for (const phrase of [...rule.neutralise].sort((a, b) => b.length - a.length)) {
      text = neutralise(text, phrase)
    }
    const hit =
      rule.keywords.some((k) => text.includes(k)) ||
      rule.wordKeywords.some((k) => hasWord(text, k)) ||
      rule.exactWords.some((k) => hasExactWord(text, k))
    if (hit) found.push(rule.allergen)
  }

  for (const a of EXACT_NAMES[normalised] ?? []) {
    if (!found.includes(a)) found.push(a)
  }

  // The bare-flour route has to honour the wheat vetoes too: "gluten free
  // flour" must not become wheat by a different door.
  const wheatRule = RULES.find((r) => r.allergen === 'wheat')!
  const wheatVetoed = wheatRule.veto.some((phrase) => hasWord(normalised, phrase))
  if (!found.includes('wheat') && !wheatVetoed && isUnqualifiedFlour(normalised)) {
    found.push('wheat')
  }

  // Catalogue order, so two ingredients with the same allergens store the
  // same array and a diff of a reclassification run is readable.
  return ALLERGENS.filter((a) => found.includes(a))
}

// How each one is written on screen. Plural, because the filter reads "No
// tree nuts".
export const ALLERGEN_LABEL: Record<Allergen, string> = {
  milk: 'milk',
  egg: 'eggs',
  fish: 'fish',
  shellfish: 'shellfish',
  'tree nut': 'tree nuts',
  peanut: 'peanuts',
  wheat: 'wheat',
  soy: 'soy',
  sesame: 'sesame',
}

// ------------------------------------------------------------------ selftest
//
//   npx tsx src/lib/allergens.ts --selftest
//
// Every name below is a real ingredient name from the database, with its
// product count where that count is the reason the case exists. A regression
// here is a regression in a safety-relevant filter, so this list is meant to
// grow rather than be trimmed.
if (typeof process !== 'undefined' && process.argv?.includes('--selftest')) {
  let bad = 0
  const check = (name: string, want: Allergen[], why?: string) => {
    const got = classifyAllergens(name)
    if (got.join(',') !== want.join(',')) {
      bad++
      console.log(`FAIL ${JSON.stringify(name)}${why ? `  (${why})` : ''}`)
      console.log(`  got  [${got.join(', ')}]`)
      console.log(`  want [${want.join(', ')}]`)
    }
  }

  // ---- milk
  check('milk', ['milk'])
  check('nonfat dry milk', ['milk'])
  check('whey protein concentrate', ['milk'])
  check('sodium caseinate', ['milk'])
  check('cheese cultures', ['milk'], 'only cheese lists them')
  check('buttermilk', ['milk'])
  check('butter', ['milk'])
  check('unsalted butter', ['milk'])
  check('natural butter flavor', ['milk'], 'may be dairy-derived; safe direction')
  check('goat milk', ['milk'], '"oat milk" used to be found inside it')
  check('pasteurized goat milk', ['milk'], '151 products')
  check('cultured pasteurized goat milk', ['milk'])
  check('non-dairy creamer', ['milk'], 'usually sodium caseinate')
  check('cream of tartar', [], '925 products, no dairy')
  check('cocoa butter', [], '14,720 products')
  check('cocoa butter*+', [], 'label footnote marks')
  check('+cocoa butter', [])
  check('non-dairy cocoa butter', [])
  check('non-dairy lactic acid', [])
  check('shea butter', [])
  check('apple butter', [])
  check('sunflower seed butter', [])
  check('butternut squash', [], '347 products')
  check('butter lettuce', [])
  check('milk thistle extract', [])
  check('coconut milk', ['tree nut'], 'coconut is on FDA’s tree-nut list; not dairy')
  check('almond milk', ['tree nut'])
  check('almondmilk', ['tree nut'], '439 products, written as one word')
  check('soymilk', ['soy'])
  check('oat milk', [])
  check('cocoa butter, milk', ['milk'], 'the reason exclusions neutralise rather than reject')

  // ---- egg
  check('egg', ['egg'])
  check('dried egg white', ['egg'])
  check('egg albumen', ['egg'])
  check('mayonnaise', ['egg'])
  check('egg white lysozyme', ['egg'])
  check('enriched egg noodle', ['egg', 'wheat'], 'egg noodles are both')
  check('eggplant', [], '168 products')

  // ---- wheat, including the bare-flour rule
  check('wheat flour', ['wheat'])
  check('enriched wheat flour', ['wheat'])
  check('wheat gluten', ['wheat'])
  check('durum wheat semolina', ['wheat'])
  check('semolina', ['wheat'])
  check('flour', ['wheat'], '4,484 products; 21 CFR 137.105')
  check('enriched flour', ['wheat'], '7,124 products')
  check('enriched bleached flour', ['wheat'])
  check('unbleached enriched flour', ['wheat'])
  check('all purpose flour', ['wheat'])
  check('unbleached unbromated bread flour', ['wheat'])
  check('enriched high gluten flour', ['wheat'])
  check('whole grain flour', ['wheat'])
  check('flour tortilla', ['wheat'])
  check('whet flour', ['wheat'], 'misspelling, 16 products')
  check('rice flour', [], '7,141 products')
  check('corn flour', [])
  check('soy flour', ['soy'])
  check('malted barley flour', [], '9,205 products; barley is not a major allergen')
  check('almond flour', ['tree nut'])
  check('coconut flour', ['tree nut'])
  check('peanut flour', ['peanut'])
  check('gluten free flour', [], 'says so on the tin')
  check('gluten-free flour blend', [])
  check('cauliflower flour', [])
  check('citrus flour', [])
  check('konjac flour', [])
  check('gram flour', [], 'chickpea')
  check('flour treatment agent', [], 'not a flour')
  check('pasta', ['wheat'], '700 products')
  check('enriched pasta', ['wheat'])
  check('enriched macaroni product', ['wheat'], '501 products')
  check('bread crumb', ['wheat'], '946 products')
  check('panko bread crumb', ['wheat'])
  check('pretzel', ['wheat'], '543 products')
  check('crouton', ['wheat'])
  check('cracker meal', ['wheat'])
  check('noodle', ['wheat'], '229 products')
  check('penne pasta', ['wheat'])
  check('matzo meal', ['wheat'])
  check('graham crumb', ['wheat'])
  check('bulgur wheat', ['wheat'])
  check('durum wheat semolina', ['wheat'])
  check('rice noodle', [], '95 products')
  check('gluten free pasta', [], 'a veto, not a neutralisation')
  check('gluten-free flour blend', [], 'the veto covers the bare-flour route too')
  check('dairy free cheese', [], 'a free-from claim is dispositive')
  check('peanut free sunflower butter', [])
  check('brown rice pasta', [])
  check('chickpea pasta', [])
  check('soba noodle', ['wheat'], 'commercial soba is mostly wheat flour')
  check('phylloquinone', [], 'vitamin K1, 242 products — not phyllo pastry')
  check('buckwheat', [], '463 products, not wheat')
  check('buckwheat flour', [], '240 products')
  check('wheatgrass', [])

  // ---- soy
  check('soy lecithin', ['soy'], '30,962 products')
  check('soybean oil', ['soy'], '23,802 products')
  check('soya lecithin', ['soy'])
  check('tamari soy sauce', ['soy'])
  check('tofu', ['soy'])
  check('tamarind', [], '1,059 products; contains "tamari"')
  check('tamarind seed gum', [])

  // ---- peanut and tree nut, which must never be confused
  check('peanut', ['peanut'])
  check('peanut butter', ['peanut'], 'not milk, not a tree nut')
  check('peanut oil', ['peanut'])
  check('partially defatted peanut flour', ['peanut'])
  check('almond', ['tree nut'])
  check('cashew butter', ['tree nut'])
  check('hazelnut paste', ['tree nut'])
  check('brazil nut', ['tree nut'])
  check('pine nut', ['tree nut'])
  check('macadamia nut', ['tree nut'])
  check('filbert', ['tree nut'], 'another name for hazelnut')
  check('tree nut', ['tree nut'], '1,127 products, the literal name')
  check('other tree nut', ['tree nut'])
  check('nutmeg', [], '1,338 products')
  check('ground nutmeg', [], '101 products; "ground nut" used to match inside it')
  check('nut', ['tree nut'], '239 products, the literal name')
  check('mixed nuts', ['tree nut'])
  check('ground nut', ['peanut'])
  check('doughnut', [])
  check('yeast nutrient', [], '466 products')
  check('nutritional yeast', [], '377 products')
  check('water chestnut', [], '264 products')
  check('coconut oil', ['tree nut'], '6,854 products; FDA lists coconut')

  // ---- sesame
  check('sesame seed', ['sesame'])
  check('toasted sesame oil', ['sesame'])
  check('tahini', ['sesame'])
  check('sesame tahini', ['sesame'])

  // ---- fish and shellfish
  check('anchovy', ['fish'])
  check('worcestershire sauce', ['fish'], '783 products, anchovy-based')
  check('alaska pollock', ['fish'])
  check('light tuna', ['fish'])
  check('fish oil', ['fish'])
  check('catfish', ['fish'])
  check('shrimp', ['shellfish'])
  check('crab meat', ['shellfish'])
  check('artificial crab flavor', ['shellfish'], 'safe direction')
  check('oyster sauce', ['shellfish'])
  check('clam juice', ['shellfish'])
  check('scallop', ['shellfish'])
  check('squid', ['shellfish'])
  check('oyster mushroom', [], '26 products')
  check('cocoa powder', [], '"cod" must not match inside "cocoa"')
  check('coconut', ['tree nut'], 'and not fish')
  check('roasted almond', ['tree nut'], '"roe" must not match inside "roasted"')
  check('rosemary', [], '"roe" again')
  check('cod', ['fish'])
  check('carob powder', [], '"roe" is not in here either')
  // The two false positives the catalogue audit found on 2026-10-08.
  check('orange peel', [], '"eel" is inside "peel"')
  check('lemon peel', [])
  check('annatto', [], 'achiote seed colouring; "natto" is inside it')
  check('annatto extract', [])
  check('annatto color', [])
  check('eel', ['fish'], 'the word itself still matches')
  check('eels', ['fish'], 'the optional plural')

  // ---- found by the first full dry run over all 127,268 names, 2026-10-08
  check('parmigiano reggiano cheese', ['milk'], '49 products; r-egg-iano')
  check('parmigiano-reggiano dop', ['milk'])
  check('mozzarella', ['milk'], '88 products, no dairy word in the name')
  check('low moisture part skim mozzarella', ['milk'])
  check('romano', ['milk'], '105 products')
  check('asiago', ['milk'])
  check('provolone', ['milk'])
  check('smoked gouda', ['milk'])
  check('fontina', ['milk'])
  check('colby', ['milk'])
  check('monterey jack', ['milk'])
  check('queso quesadilla', ['milk'])
  check('creme fraiche', ['milk'])
  check('dulce de leche', ['milk'])
  check('skyr', ['milk'])
  check('romano bean', [], 'a borlotti bean, not a cheese')
  check('whole romano bean flour', [], 'bean flour: "romano" and "bean" are not flour qualifiers')
  check('romano cheese cove water soybean oil', ['milk', 'soy'], 'still cheese')
  check('feta', ['milk'])
  check('edam', ['milk'])
  check('edamame', ['soy'], '209 products; "edam" must not reach it')
  check('shelled edamame', ['soy'])
  check('brie', ['milk'])
  check('buttermilk', ['milk'], 'mid-word "milk" that means it')
  check('sweetcream buttermilk', ['milk'])
  check('skimmilk', ['milk'])
  check("2'-fucosyllactose", [], '43 products of infant formula; not milk')
  check('3-fucosyllactose', [], '11 products')
  check('lactose free milk', ['milk'], 'the proteins are the allergen')
  check('nutmilk', [], '16 products; a plant milk')
  check('cultured pasteurized flaxmilk', [])
  check('cashewmilk', ['tree nut'])
  check('coconutmilk', ['tree nut'])
  check('sodium cyclamate', [], '9 products; "clam" is inside cy-clam-ate')
  check('clam juice', ['shellfish'], 'the exact word still matches')
  check('clams and clam juice', ['shellfish'])
  check('sea clam', ['shellfish'])
  check('clamshell', [])
  check('taleggio cheese', ['milk'], 't-al-egg-io')
  check('veggie straw', [], '23 products; v-egg-ie')
  check('veggie blend', [])
  check('orgain organic veggie blend', [])
  check('fruit and veggie juice concentrate', [])
  check('wholeegg', ['egg'], 'buries "egg" and means it')
  check('cage-freeggs', ['egg'], 'a typo that still means eggs')
  check('eggnog', ['egg'], 'exact-word "egg" would miss it')

  check('shellfish', ['shellfish'], '67 products; a crustacean is not a fish')
  check('crustacean shellfish', ['shellfish'], '37 products')
  check('mollusk shellfish', ['shellfish'])
  check('cuttlefish', ['shellfish'], '21 products; a mollusc')
  check('cuttlefish ink', ['shellfish'])
  check('crawfish', ['shellfish'], '10 products; a crustacean')
  check('crayfish tail meat', ['shellfish'])
  check('jellyfish', [], 'a cnidarian, not one of the nine')
  check('milkfish', ['fish'], '2 products; not dairy')
  check('codfish', ['fish'], 'reached by the "fish" keyword, not by "cod"')
  check('codfish powder', ['fish'])
  check('whitefish roe', ['fish'])
  check('sablefish', ['fish'])
  check('lumpfish roe', ['fish'])

  check('can code', [], '"cod" must not reach "code"')
  check('dry place lot code and best by', [])
  check('please refer to the code on end of can', [])
  check('codium phosphate', [], 'a typo for sodium phosphate')
  check('codonopsis root', [], 'a herb')
  check('codeage helix liposomal deliverytmtm', [])
  check('cod fillet', ['fish'], 'the fish itself still matches')
  check('salt cod', ['fish'])
  check('jaune soleil fcf', [], '"sole" must not reach "soleil"')
  check('solely inc. la jolla', [])
  check('solero', [])
  check('dover sole', ['fish'])
  check('carpeting', [], '"carp" must not reach "carpeting"')
  check('sea bass', ['fish'])
  check('mahi mahi', ['fish'])

  check('mayocoba bean', [], '12 products; "mayo" must not reach it')
  check('mayonnaise', ['egg'], 'still matched, by the whole word')
  check('egg free mayonnaise', [], 'the free-from veto')
  check('beta-lactoglobulin', ['milk'], 'a milk protein, and no longer also egg')

  check('sojabohnen', ['soy'], 'German; "soja" stays a prefix')
  check('sojalecithin', ['soy'])
  check('nattokinase', ['soy'], 'made from fermented soybeans')
  check('coconut amino', ['tree nut'], '91 products; made from coconut sap')
  check('coconut aminos', ['tree nut'], 'same answer for both spellings')
  check('curds and whey', ['milk'], 'exact-word "curd" plus its plural')
  check('curdled', [], 'and not its stem')
  check('miso paste', ['soy'])
  check('encoded data', [], '"cod" needs a word boundary')

  // ---- things with no allergen at all
  for (const plain of [
    'water', 'sugar', 'salt', 'citric acid', 'xanthan gum', 'red 40',
    'sunflower oil', 'canola oil', 'palm oil', 'natural flavor', 'cane sugar',
    'corn syrup', 'baking soda', 'potato', 'tomato', 'onion', 'garlic',
    'rice', 'oat', 'whole grain rolled oats', 'molasses', 'honey', 'vanilla',
  ]) {
    check(plain, [])
  }

  console.log(bad === 0 ? 'allergens: all cases pass' : `allergens: ${bad} FAILURES`)
}

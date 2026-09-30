// Guesses a FOOD product's category from its NAME, for products that Open
// Food Facts never categorized (about 118,000 of the bulk import had no OFF
// categories at all). Companion to offCategoryMap.ts, which maps OFF's own
// category tags and is always preferred when a product has them.
//
// HOW IT WORKS — "the last product word wins"
// English product names put the kind of product LAST: "Chocolate Chip
// Cookies" are cookies, "Cookie Dough Ice Cream" is ice cream, "Chicken
// Noodle Soup" is soup. So the name is split into words, every term below
// that appears is found, and the one that ends LATEST wins.
//
// Three refinements make that work on real names:
//   1. THREE TIERS. Strong terms name a kind of product (cookies, yogurt,
//      sauce). Flavor terms are products that are also common flavors
//      ("Peanut Butter" alone is a spread; "Protein Bar Peanut Butter" is a
//      bar). Weak terms are ingredients that are only the product when
//      nothing else is ("Black Beans" vs "Black Bean Burger"). Any strong
//      term beats any flavor term, which beats any weak term. A bare fruit
//      or vegetable name decides nothing unless the name also says frozen,
//      canned, dried or fresh — "Pineapple" is as often a soda as a fruit.
//   2. LONGER TERMS SWALLOW SHORTER ONES they contain: "root beer" is a soft
//      drink, so the "beer" inside it is ignored; "chocolate chips" (baking)
//      swallows "chips" (snack). A few terms exist only to swallow ("beer
//      battered" should not make fish into beer) — those have category null.
//   3. SEGMENTS. OFF names are often "Brand, Product, Flavor" or "Product
//      with X" / "X in Syrup". The name is cut at commas, dashes, brackets
//      and the words with/in/on/for/from; the first segment with a strong
//      term decides, then the first with a flavor term, then a weak one. So "Peaches in Heavy Syrup"
//      is judged on "peaches" and "Meijer, stewed tomatoes" on its second
//      part.
//
// Words are compared after a simple singular form (cookies -> cooky, chips
// -> chip, tomatoes -> tomato) applied to both the name and the terms, so
// each term is written once in its natural form.
//
// UNMATCHED IS FINE: no match means the category stays null for a human, as
// before. A wrong category is worse than none, so terms that are genuinely
// ambiguous ("mix", "cocktail", "bites") are left out on purpose.
//
// ALCOHOL: wine, beer and spirits words give way to food words, since they
// are often ingredients ("Red Wine Salami", "Vodka Sauce", "Beer Mustard").
//
// Checked against the ~191,000 bulk products that DO have an OFF category
// (the categorize script prints this agreement report on every dry run):
// it agrees with OFF on about 76%, and most disagreements are OFF filing
// things differently (salted nuts under snacks, ketchup under sauces).

import { PRODUCT_CATEGORIES_BY_TYPE } from './productTypes'

// Internal markers resolved at the end, once the whole name is known:
// FRUIT / VEG become Fresh Produce, Frozen Fruit/Vegetable, Canned Fruit/
// Vegetable or Snack (dried fruit) depending on words like "frozen".
const FRUIT = '#fruit'
const VEG = '#veg'
// Beans: OFF files canned beans as Canned Vegetable and dry beans as Beans &
// Legumes, so a bean name is resolved by words like "dry" or "frozen".
const LEGUME = '#legume'

type TermList = Record<string, string>

// --- STRONG TERMS: the kind of product ---------------------------------
// Written as 'Category': 'term|term|...'. Order does not matter: position in
// the name and length decide, not order here.
const STRONG: TermList = {
  'Alcoholic Beverage':
    'beer|lager|ale|pale ale|india pale ale|ipa|double ipa|hazy ipa|stout|porter|pilsner|pilsener|hefeweizen|witbier|kolsch|bock|shandy|radler|' +
    'milk stout|oatmeal stout|coffee stout|chocolate stout|imperial stout|cream ale|brown ale|amber ale|red ale|blonde ale|wheat beer|sour ale|barleywine|barley wine|light beer|craft beer|' +
    'hard cider|hard seltzer|hard tea|hard iced tea|hard lemonade|hard kombucha|spiked seltzer|malt beverage|flavored malt beverage|' +
    'wine|red wine|white wine|rose wine|sparkling wine|dessert wine|fortified wine|table wine|champagne|prosecco|' +
    'merlot|cabernet|cabernet sauvignon|sauvignon blanc|chardonnay|pinot noir|pinot grigio|pinot gris|riesling|moscato|zinfandel|malbec|shiraz|syrah|' +
    'sangria|sake|soju|mead|port wine|vermouth|liqueur|schnapps|cognac|absinthe|scotch whisky|' +
    'vodka seltzer|canned cocktail|ready to drink cocktail|wine cocktail|wine spritzer',
  Beverage:
    'soda|soda pop|spritzer|spritzers|soft drink|cola|root beer|ginger beer|birch beer|ginger ale|cream soda|tonic|tonic water|club soda|seltzer|seltzer water|' +
    'sparkling water|mineral water|spring water|drinking water|purified water|alkaline water|water|flavored water|coconut water|' +
    'water enhancer|drink|drink mix|beverage|lemonade|limeade|fruit punch|punch|energy drink|energy shot|sports drink|electrolyte drink|electrolyte|electrolytes|' +
    'hydration|hydration multiplier|kombucha|smoothie|agua fresca|horchata|switchel|shrub|' +
    'iced tea|sweet tea|tea drink|bottled tea|brewed tea|milk tea|bubble tea|iced coffee|cold brew|coffee drink|chilled coffee drink|latte|frappuccino|yerba mate|' +
    'hot cocoa|hot cocoa mix|cocoa mix|hot chocolate|hot chocolate mix|drinking chocolate|' +
    'juice drink|juice cocktail|juice beverage|nectar|' +
    'cocktail mix|margarita mix|mojito mix|bloody mary mix|mixer|cocktail mixer|sour mix|grenadine|' +
    'kola champagne|champagne cola|champagne soda|sangria mix|wine freezer|wine slush|non alcoholic beer|nonalcoholic beer|alcohol free beer|mocktail|mocktails|zero proof|margarita mix|daiquiri mix|pina colada mix|mojito mix',
  Juice: 'juice|orange juice|apple juice|grape juice|cranberry juice|juice blend|100 juice|apple cider|sweet cider|lemon juice|lime juice',
  'Coffee & Tea':
    'ground coffee|whole bean coffee|instant coffee|coffee pod|coffee pods|k cup|k cups|single serve coffee|coffee beans|arabica coffee|roast coffee|' +
    'green tea|black tea|herbal tea|rooibos|oolong|earl grey|chamomile|tea bag|tea bags|loose leaf tea|white tea|tea sachets',
  Dairy:
    'milk|whole milk|skim milk|lowfat milk|low fat milk|reduced fat milk|fat free milk|chocolate milk|strawberry milk|buttermilk|half and half|' +
    'cream|heavy cream|whipping cream|heavy whipping cream|light cream|sour cream|creme fraiche|' +
    'yogurt|yoghurt|greek yogurt|skyr|kefir|lassi|drinkable yogurt|yogurt drink|yogurt smoothie|kefir smoothie|milk smoothie|dairy smoothie|' +
    'salted butter|unsalted butter|sweet cream butter|stick butter|eggnog|egg nog|creamer|coffee creamer|coffee whitener|whipped cream|milkshake|' +
    'evaporated milk|condensed milk|sweetened condensed milk|dry milk|powdered milk|dulce de leche',
  'Dairy Alternative':
    'almond milk|almondmilk|oat milk|oatmilk|soy milk|soymilk|coconut milk beverage|cashew milk|rice milk|pea milk|hemp milk|macadamia milk|flax milk|' +
    'coconut milk|plant based milk|non dairy milk|dairy free milk|non dairy creamer|nondairy creamer|coffee mate|coffeemate|coffee enhancer|plant based creamer|almond creamer|oat creamer|' +
    'non dairy yogurt|dairy free yogurt|plant based yogurt|almond yogurt|oat yogurt|coconut yogurt|cashew yogurt|yogurt alternative|' +
    'vegan cheese|dairy free cheese|plant based cheese|non dairy cheese|vegan butter|plant butter|plant based butter',
  Cheese:
    'cream cheese|cottage cheese|string cheese|cheese stick|cheese slice|sliced cheese|shredded cheese|cheese blend|cheese curd|' +
    'grated parmesan|shredded parmesan|parmigiano|parmigiano reggiano|pecorino|pecorino romano|romano|asiago|gruyere|emmental|manchego|havarti|muenster|provolone|' +
    'fresh mozzarella|shredded mozzarella|mozzarella cheese|burrata|ricotta|mascarpone|feta|goat cheese|chevre|brie|camembert|gouda|edam|blue cheese crumbles|gorgonzola|roquefort|' +
    'colby|colby jack|monterey jack cheese|pepper jack cheese|queso fresco|queso blanco|cotija|oaxaca|paneer|halloumi|neufchatel|fontina|swiss cheese|american cheese|' +
    'cracker cuts|snack cheese|cheese snack|cheese snacks|cheese crumbles|feta crumbles|quesadilla cheese|queso quesadilla|mozzarella sticks|cheese spread|cream cheese spread|cheddar spread|pimento cheese|beer cheese|cheese wedge|babybel|laughing cow|cheese curds',
  Eggs: 'egg|eggs|large egg|brown egg|egg white|liquid egg|hard boiled egg|pasture raised egg|free range egg|cage free egg',
  'Ice Cream':
    'ice cream|icecream|gelato|sorbet|sorbetto|sherbet|frozen yogurt|frozen dessert|ice cream bar|ice cream sandwich|ice cream cone|popsicle|ice pop|ice pops|' +
    'frozen fruit bar|freezer pop|mochi ice cream|non dairy frozen dessert|italian ice|italian ices|granita|push pop|frozen custard|' +
    'frozen dairy dessert|dairy dessert|non dairy dessert|frozen cream dessert|dessert pops|ice cream cake|ice cream roll|ice cream pie|cream bar|cream bars|ice bar|ice bars|fudge bar|fudge bars|dessert bars|frozen dessert bars|slush|waffle cone|waffle cones|sugar cones|cake cones',
  Cookies:
    'cookie|cookies|biscotti|shortbread|sandwich cookie|graham cracker|grahams|animal cracker|snickerdoodle|macaron|macaroon|' +
    'ginger snap|gingersnap|oreo|fig bar|fig newton|lady finger|ladyfinger|stroopwafel|madeleine|butter cookie|sugar cookie|' +
    'wafer rolls|wafer roll|stroop wafels|stroopwafels|wafels|cookie sandwich|cookie sandwiches|sandwich cremes|sandwich creme|creme sandwich|cream sandwich cookies|cookie bar|cookie bars|sugar wafers|vanilla wafers|wafer cookies|creme pie|creme pies|cream pies|oatmeal creme pie|marshmallow pie|biscuit|biscuits|tea biscuits|digestive biscuits',
  'Bread & Bakery':
    'bread|loaf|sourdough|baguette|ciabatta|focaccia|brioche|challah|rye bread|pumpernickel|flatbread|naan|pita|pita bread|lavash|' +
    'dinner roll|dinner rolls|hawaiian rolls|sweet rolls|crescent rolls|kaiser rolls|brioche rolls|potato rolls|bread rolls|hot dog rolls|tartlets|tart shells|bun|buns|hamburger bun|hot dog bun|slider bun|sub roll|hoagie roll|kaiser roll|croissant|bagel|english muffin|' +
    'muffin|muffins|scone|buttermilk biscuits|flaky biscuits|biscuit dough|crumpet|donut|doughnut|donut hole|cruller|danish|pastry|pastries|turnover|strudel|eclair|cream puff|' +
    'cake|cakes|cupcake|pound cake|coffee cake|layer cake|bundt cake|blondie|pie|pies|fruit tart|egg tart|galette|cobbler|' +
    'cinnamon roll|sticky bun|honey bun|pie crust|graham cracker crust|crumb crust|pizza crust|pizza dough|puff pastry|phyllo|crescent roll|croutons|crouton|bread crumbs|breadcrumbs|panko|' +
    'stuffing|stuffing mix|breadstick|breadsticks|cake mix|brownie mix|muffin mix|bread mix|cookie mix|cornbread mix|biscuit mix|pancake mix|waffle mix|pancake and waffle mix|baking mix|' +
    'wrappers|wonton wrappers|egg roll wrappers|dumpling wrappers|gyoza wrappers|' +
    'tortilla|tortillas|flour tortilla|corn tortilla|wrap|wraps|taco shell|tostada|' +
    'sandwich round|sandwich rounds|sandwich thins|sandwich bread|sandwich rolls|waffle|waffles|pancake|pancakes|crepe|crepes|french toast|toast|texas toast|garlic bread|garlic knot|churro|baklava|' +
    'whoopie pie|moon pie|snack cake|twinkie|cake pop|cake pops',
  'Toaster Pastry': 'toaster pastry|toaster pastries|pop tart|pop tarts|toaster strudel',
  Snack:
    'chips|chip|potato chips|tortilla chips|corn chips|kettle chips|pita chips|veggie chips|plantain chips|banana chips|apple chips|cassava chips|pork rinds|chicharrones|' +
    'crisps|puffs|cheese puffs|curls|cheese curls|cheese balls|popcorn|kettle corn|caramel corn|microwave popcorn|pretzel|pretzels|pretzel crisps|melba toast|' +
    'cracker sandwiches|sandwich crackers|crackers|cracker|rice cake|rice cakes|rice crackers|snack mix|party mix|chex mix|trail mix|fruit leather|fruit roll|fruit strips|' +
    'protein bar|granola bar|energy bar|snack bar|cereal bar|nut bar|fruit and nut bar|fruit bar|breakfast bar|keto bar|crisp bar|nutrition bar|oat bar|' +
    'energy bites|protein bites|snack bites|snack|snacks|' +
    'dried fruit|dried mango|dried cranberries|dried apricots|dried cherries|dried blueberries|seaweed snack|roasted seaweed|' +
    'dill chips|dill chops|hamburger dill|hamburger chips|hamburger dill chips|dill spears|dill slices|pork skins|pork cracklins|cracklins|bread and butter pickles|bread and butter chips|bread and butter slices|bread and butter|tortilla rounds|pickle|pickles|dill pickles|pickle chips|pickle spears|gherkin|gherkins|olives|olive|kalamata olives|ripe olives|green olives|' +
    'fruit cup|fruit cups|potato chip|tortilla chip|corn chip|kettle chip|pita chip|veggie chip|plantain chip|banana chip',
  Candy:
    'root beer barrels|root beer barrel|tootsie roll|nut roll|salted nut roll|candy roll|candy rolls|fruit flavored snacks|candy|candies|liquorice|fruit snacks|fruit snack|candy bar|candy bars|chocolate candy|chocolate candies|gummy|gummies|gummy bears|gummy worms|gummi|jelly beans|jelly bean|licorice|taffy|lollipop|lollipops|sucker|suckers|' +
    'hard candy|caramel candies|caramel chews|soft caramels|brittle|peanut brittle|mini marshmallows|jumbo marshmallows|peeps|breath mints|hard mints|peppermint candy|gum|chewing gum|' +
    'nougat|licorice twists|jawbreaker|candy cane|candy canes|cotton candy|rock candy|sour belts|sour straws|gumdrops|jujubes|chews|fruit chews|' +
    'candy corn|peanut butter cups|peanut butter cup|nonpareils|malted milk balls|praline|pralines|turkish delight|halva|halwa|mochi|' +
    'marzipan|sour patch|skittles|starburst|twizzlers|nerds|smarties|jolly rancher|lifesavers|tic tac|altoids',
  Chocolate:
    'espresso beans|chocolate covered espresso beans|m and m|m and ms|assorted chocolates|chocolate bar|chocolate bars|truffle|truffles|bonbon|bonbons|' +
    'chocolate covered|chocolate dipped|chocolate coated|covered in chocolate|dipped in chocolate|chocolate bark|bark|cacao bar|' +
    'chocolate squares|chocolate eggs|chocolate bunny|chocolate truffles|assorted chocolates|chocolate assortment|malted milk balls|' +
    'yogurt covered|yogurt coated|chocolate peanuts|chocolate almonds|chocolate pretzels',
  Cereal:
    'cereal|granola|granola cereal|muesli|oatmeal|instant oatmeal|overnight oats|porridge|hot cereal|cream of wheat|grits|corn flakes|cornflakes|bran flakes|' +
    'rice krispies|cheerios|puffed rice|puffed wheat|shredded wheat|oat cereal|rolled oats|quick oats|steel cut oats|old fashioned oats|oats|' +
    'frosted flakes|granola clusters',
  'Spread':
    'houmous|spread|sunflower butter|sunbutter|seed butter|tahini|hazelnut spread|chocolate spread|hummus|hommus|guacamole|honey butter|' +
    'nutella|cookie butter|biscoff spread|apple butter|pumpkin butter|fruit butter|plum butter|apricot butter|peach butter|fig butter|pear butter|jam|jelly|preserves|preserve|marmalade|fruit spread|lemon curd|' +
    'butter spread|margarine|vegetable oil spread|buttery spread|cheese dip spread|marshmallow creme|marshmallow fluff|fluff',
  Sweetener:
    'sugar|cane sugar|brown sugar|powdered sugar|confectioners sugar|coconut sugar|turbinado|demerara|raw sugar|granulated sugar|sugar cubes|' +
    'raw honey|manuka honey|pure honey|clover honey|wildflower honey|honeycomb|agave|agave nectar|stevia|monk fruit|monkfruit|erythritol|allulose|xylitol|sucralose|sweetener|' +
    'sugar substitute|splenda|truvia|sweet n low|equal|molasses|blackstrap molasses',
  Syrup:
    'syrup|maple syrup|pancake syrup|table syrup|corn syrup|simple syrup|chocolate syrup|caramel syrup|coffee syrup|flavored syrup|' +
    'date syrup|rice syrup|brown rice syrup|golden syrup|sorghum|sorghum syrup|ice cream topping|sundae topping|hot fudge|caramel sauce|dessert sauce',
  'Baking Ingredient':
    'baking powder|baking soda|baking chips|carob chips|butterscotch chips|peanut butter chips|white chocolate chips|semi sweet chips|semisweet chips|dark chocolate chips|milk chocolate chips|chocolate morsels|morsels|butterscotch chips|white chips|' +
    'cocoa powder|baking cocoa|unsweetened cocoa|baking chocolate|yeast|active dry yeast|instant yeast|vanilla extract|extract|pure vanilla|' +
    'almond extract|food coloring|food color|gel color|sprinkles|jimmies|nonpareil|sanding sugar|decorating icing|icing|frosting|glaze|' +
    'fondant|pie filling|cornstarch|corn starch|tapioca starch|potato starch|arrowroot|xanthan gum|gelatin|pectin|cream of tartar|' +
    'shredded coconut|coconut flakes|flaked coconut|sweetened coconut|decorating kit|decoration kit|cupcake decorating kit|cookie decorating kit|' +
    'cake mate|cupcake toppers|cake toppers|cupcake decorations|cake decorations|decorations|baking kit|frosting mix|dessert topping|dessert filling|pastry filling|cake filling|whipped topping|cool whip|evaporated|chocolate wafers|candy melts|melting wafers|pie shell|graham crumbs',
  Flour:
    'flour|all purpose flour|bread flour|cake flour|self rising flour|whole wheat flour|almond flour|coconut flour|rice flour|oat flour|' +
    'cassava flour|chickpea flour|masa|masa harina|cornmeal|corn meal|semolina|gluten free flour|pastry flour|spelt flour|rye flour|' +
    'buckwheat flour|tapioca flour|vital wheat gluten',
  'Prepared Meal':
    'pizza|flatbread pizza|pizza rolls|pizza bites|calzone|stromboli|burrito|burritos|enchilada|enchiladas|taquito|taquitos|quesadilla|tamale|tamales|tamal|' +
    'empanada|empanadas|chimichanga|fajita kit|taco kit|dinner kit|meal kit|' +
    'sandwich|sandwiches|breakfast sandwiches|hoagie|panini|wrap sandwich|sliders|lunchable|lunch kit|' +
    'mac and cheese|macaroni and cheese|mac n cheese|macaroni cheese|mac cheese|lasagna|lasagne|casserole|pot pie|meatloaf|shepherds pie|' +
    'fried rice|stir fry|lo mein|chow mein|pad thai|chicken curry|tikka masala|butter chicken|biryani|risotto|paella|jambalaya|gumbo|' +
    'entree|entrees|dinner|rice bowl|power bowl|burrito bowl|noodle bowl|skillet meal|skillet|' +
    'salad|salad kit|chopped kit|chopped salad|caesar salad|potato salad|pasta salad|chicken salad|egg salad|tuna salad|coleslaw|slaw|' +
    'sausage rolls|sausage roll|egg rolls|egg roll|spring rolls|spring roll|potstickers|potsticker|dumplings|dumpling|gyoza|dim sum|bao|siopao|pierogi|pierogies|' +
    'sushi|california roll|kimbap|onigiri|poke|quiche|frittata|scramble|breakfast sandwich|breakfast burrito|breakfast bowl|' +
    'corn dog|corn dogs|pigs in a blanket|hot pocket|pocket sandwich|stuffed peppers|cabbage rolls|stroganoff|alfredo pasta|' +
    'mashed potatoes|scalloped potatoes|au gratin|au gratin potatoes|hash browns|hashbrowns|tater tots|tots|french fries|fries|potato wedges|' +
    'onion rings|jalapeno poppers|appetizer|appetizers|' +
    'chili con carne|beef chili|turkey chili|chili with beans|chili no beans|beef stew|stew|pozole|falafel',
  Pasta:
    'pasta|spaghetti|penne|penne rigate|rigatoni|fusilli|rotini|farfalle|bow ties|linguine|fettuccine|fettuccini|angel hair|capellini|' +
    'macaroni|elbow macaroni|elbows|shells|pasta shells|orzo|ziti|lasagna noodles|manicotti|cannelloni|tortellini|ravioli|gnocchi|' +
    'orecchiette|pappardelle|tagliatelle|bucatini|vermicelli|cavatappi|campanelle|gemelli|ditalini|acini de pepe|couscous|' +
    'noodle|noodles|egg noodles|ramen|udon|soba|rice noodles|glass noodles|pho noodles|lo mein noodles|yakisoba|instant noodles|cup noodles',
  Soup:
    'soup|soups|condensed soup|noodle soup|chicken noodle soup|tomato soup|bisque|chowder|clam chowder|minestrone|pho|miso soup|ramen soup|' +
    'broth soup|soup mix|consomme|gazpacho|lentil soup|split pea soup|french onion soup|tortilla soup|egg drop soup|wonton soup|hot and sour soup',
  Broth: 'broth|bone broth|stock|chicken stock|beef stock|vegetable stock|bouillon|bouillon cubes|soup base|base|dashi',
  Sauce:
    'franks redhot|redhot sauce|sauce|pasta sauce|marinara sauce|tomato sauce|pizza sauce|alfredo sauce|basil pesto|vodka sauce|bolognese|arrabbiata|' +
    'bbq sauce|barbecue sauce|hot sauce|buffalo sauce|garlic sauce|wing sauce|chili sauce|sweet chili sauce|teriyaki sauce|stir fry sauce|' +
    'enchilada sauce|taco sauce|mole sauce|curry sauce|simmer sauce|cooking sauce|tikka sauce|butter chicken sauce|korma|' +
    'dressing|salad dressing|ranch dressing|vinaigrette|caesar dressing|italian dressing|blue cheese dressing|thousand island|' +
    'gravy|gravy mix|marinade|glaze sauce|dipping sauce|cheese sauce|queso dip|nacho cheese|nacho cheese sauce|salsa verde|chunky salsa|salsa con queso|pico de gallo|' +
    'dip|dips|spinach dip|onion dip|french onion dip|bean dip|artichoke dip|tzatziki|baba ganoush|chimichurri|' +
    'hollandaise|bearnaise|tartar sauce|cocktail sauce|remoulade|aioli|tahini sauce|peanut sauce|hoisin|oyster sauce|fish sauce|' +
    'ponzu|gochujang|harissa|adobo sauce|tomato paste|tomato puree|passata|sofrito|recaito|enchilada|pasta sauce',
  Condiment:
    'ketchup|catsup|mustard|dijon|dijon mustard|yellow mustard|honey mustard|spicy brown mustard|mayonnaise|mayo|vegan mayo|miracle whip|' +
    'relish|sweet relish|pickle relish|prepared horseradish|horseradish sauce|wasabi paste|soy sauce|tamari|coconut aminos|liquid aminos|worcestershire|worcestershire sauce|' +
    'vinegar|apple cider vinegar|balsamic|balsamic vinegar|balsamic glaze|red wine vinegar|white wine vinegar|rice vinegar|cider vinegar|' +
    'vinager|vinegre|distilled vinegar|malt vinegar|cooking wine|mirin|rice wine|shaoxing wine|cooking sherry|capers|chutney|giardiniera|sauerkraut|kimchi|' +
    'pepperoncini|banana peppers|banana pepper rings|sliced jalapenos|jalapeno slices|jalapeno peppers|pickled jalapenos|nacho jalapenos|cherry peppers|pickled onions|pickled okra|pickled vegetables|' +
    'sambal|chili crisp|chili oil|chili paste|curry paste|miso|miso paste|tapenade|bruschetta|olive tapenade|anchovy paste|' +
    'maraschino cherries|cocktail onions|cocktail cherries|liquid smoke|hot honey|steak sauce|a1',
  'Spices & Seasoning':
    'seasoning|seasonings|seasoning mix|seasoning blend|spice|spices|spice blend|spice mix|rub|dry rub|bbq rub|taco seasoning|chili seasoning|' +
    'kosher salt|pink salt|himalayan salt|himalayan pink salt|table salt|iodized salt|garlic salt|onion salt|celery salt|seasoned salt|salt and pepper|' +
    'black pepper|ground black pepper|peppercorns|white pepper|cayenne|paprika|smoked paprika|cumin|turmeric|ground cinnamon|cinnamon sticks|nutmeg|cloves|allspice|' +
    'dried oregano|dried basil|bay leaves|coriander|cardamom|fennel seed|mustard seed|garlic powder|onion powder|' +
    'chili powder|curry powder|garam masala|five spice|italian seasoning|herbes de provence|za atar|zaatar|everything bagel seasoning|' +
    'ground chili|dried chili|dried chilies|chili flakes|chili pods|dried chiles|chile pods|ancho chiles|guajillo|red pepper flakes|crushed red pepper|lemon pepper|old bay|adobo|sazon|bouillon powder|msg|vanilla bean|saffron|sumac|poultry seasoning|' +
    'pumpkin pie spice|apple pie spice|herbs|dried herbs|meat tenderizer|furikake|togarashi|dukkah|ras el hanout|berbere|jerk seasoning|cajun seasoning|' +
    'fajita seasoning|ranch seasoning|popcorn seasoning|grill seasoning|steak seasoning|chicken seasoning|blackening|fish fry|seafood breader|breading|' +
    'coating mix|shake and bake|batter mix|beer batter|tempura batter|fry mix',
  Oil:
    'oil|olive oil|extra virgin olive oil|evoo|vegetable oil|canola oil|avocado oil|coconut oil|sesame oil|peanut oil|sunflower oil|safflower oil|' +
    'grapeseed oil|corn oil|walnut oil|truffle oil|mct oil|cooking oil|frying oil|cooking spray|olive oil spray|avocado oil spray|flaxseed oil|' +
    'rice bran oil|palm oil|infused oil|chili infused oil',
  'Cooking Fat': 'ghee|lard|shortening|vegetable shortening|tallow|beef tallow|duck fat|bacon grease|schmaltz|clarified butter',
  Meat:
    'thick cut bacon|sliced bacon|turkey bacon|bacon bits|sliced ham|honey ham|spiral ham|smoked ham|black forest ham|pancetta|guanciale|salame|genoa salami|hard salami|pepperoni slices|soppressata|chorizo|' +
    'capicola|coppa|mortadella|bologna|pastrami|corned beef|roast beef|deli meat|lunch meat|luncheon meat|cold cuts|charcuterie|' +
    'italian sausage|pork sausage|breakfast sausage|smoked sausage|summer sausage|kielbasa|bratwurst|brats|beer brats|andouille|' +
    'hot dog|hot dogs|franks|frankfurter|wieners|wiener|links|sausage links|sausage patties|patty|patties|burger|burgers|beef patties|' +
    'ground beef|ground turkey|ground pork|ground chicken|ground bison|ground lamb|steak|steaks|ribeye|sirloin|filet mignon|tenderloin|' +
    'brisket|roast|pot roast|chuck roast|short ribs|ribs|baby back ribs|pork chops|chops|pork loin|pork belly|pork shoulder|pulled pork|carnitas|' +
    'chicken breast|chicken breasts|chicken thighs|chicken thigh|drumsticks|chicken drumsticks|chicken tenders|chicken strips|jerky|beef jerky|turkey jerky|meat stick|meat sticks|beef stick|beef sticks|snack sticks|' +
    'chicken nuggets|nuggets|chicken patties|chicken fillets|rotisserie chicken|whole chicken|chicken wings|wings|chicken wing|meatballs|meatball|' +
    'turkey breast|sliced turkey|smoked turkey|deli turkey|oven roasted turkey|lamb|veal|venison|bison|duck|goose|quail|cornish hen|' +
    'rotisserie|carne asada|al pastor|barbacoa|birria|chicharron|pulled chicken|shredded chicken|grilled chicken|fajita chicken|chicken fajita|' +
    'pate|liver|foie gras|scrapple|souse|head cheese|jamon|serrano ham|biltong',
  'Canned Meat': 'chunk white chicken|chunk chicken|premium chunk chicken|white chicken meat|canned chicken breast|spam|vienna sausage|vienna sausages|potted meat|canned chicken|chunk chicken|chunk chicken breast|corned beef hash|deviled ham|canned ham|chicken in water',
  Seafood:
    'fish|salmon|smoked salmon|tuna|chunk light tuna|albacore|tuna steak|cod|tilapia|halibut|haddock|pollock|catfish|trout|mahi mahi|mahi|swordfish|' +
    'sardines|sardine|anchovies|anchovy|mackerel|herring|kippers|sea bass|snapper|flounder|sole|perch|walleye|branzino|' +
    'shrimp|prawns|prawn|scallops|scallop|crab|crab meat|crabmeat|imitation crab|surimi|lobster|lobster tail|crawfish|crayfish|' +
    'clams|clam|mussels|oysters|oyster|octopus|squid|calamari|caviar|roe|fish sticks|fish fillets|fish fillet|fillets|fillet|filet|' +
    'fish cakes|crab cakes|salmon burger|tuna pouch|seafood|shrimp cocktail|poke bowl|lox|gravlax|bacalao|salt cod',
  'Meat Alternative':
    'plant based burger|veggie burger|veggie burgers|meatless|meat free|vegan burger|beyond burger|impossible burger|plant based sausage|' +
    'vegan sausage|veggie sausage|plant based chicken|vegan chicken|meatless crumbles|veggie crumbles|plant based meatballs|vegan meatballs|' +
    'plant based nuggets|vegan nuggets|tofu|extra firm tofu|firm tofu|silken tofu|tempeh|seitan|textured vegetable protein|tvp|jackfruit|' +
    'veggie patties|vegan jerky|plant based jerky|mushroom jerky|meat alternative|meat substitute|vegan deli slices|tofurky|field roast|' +
    'bean curd|fried bean curd|veggie dogs|vegan hot dogs|plant based hot dogs|chik n|chikn|vegan bacon',
  'Nuts & Seeds':
    'mixed nuts|deluxe mixed nuts|nut mix|roasted nuts|salted nuts|roasted almonds|raw almonds|whole almonds|sliced almonds|slivered almonds|' +
    'roasted cashews|whole cashews|cashew halves|cashew pieces|roasted peanuts|salted peanuts|dry roasted peanuts|honey roasted peanuts|in shell peanuts|' +
    'boiled peanuts|cocktail peanuts|spanish peanuts|pecan halves|pecan pieces|chopped pecans|walnut halves|walnut pieces|chopped walnuts|english walnuts|' +
    'pistachios in shell|shelled pistachios|roasted pistachios|macadamia nuts|brazil nuts|pine nuts|marcona almonds|nut clusters|' +
    'sunflower seeds|pumpkin seeds|pepitas|chia seeds|flax seeds|flaxseed|ground flaxseed|golden flaxseed|hemp seeds|hemp hearts|sesame seeds|' +
    'poppy seeds|sunflower kernels|seed mix|corn nuts|beer nuts|roasted chickpeas',
  'Beans & Legumes':
    'lentils|lentil|red lentils|green lentils|split peas|mung beans|adzuki beans|dal|dhal|dried beans|dry beans|edamame|soybeans|lupini|lupini beans|' +
    'bean soup mix|15 bean|16 bean|13 bean',
  'Grains & Rice':
    'rice|white rice|brown rice|jasmine rice|basmati rice|wild rice|arborio|sushi rice|long grain rice|instant rice|rice pilaf|pilaf|spanish rice|' +
    'mexican rice|yellow rice|rice mix|quinoa|farro|barley|pearl barley|bulgur|freekeh|millet|amaranth|teff|sorghum grain|buckwheat|kasha|' +
    'polenta|hominy|wheat berries|grain blend|ancient grains|rice blend|cauliflower rice|riced cauliflower|risotto rice',
  'Supplement':
    'supplement|dietary supplement|protein powder|whey protein|whey|whey isolate|protein isolate|isolate|casein|plant protein|pea protein|' +
    'collagen|collagen peptides|peptides|creatine|creatine monohydrate|pre workout|pre work out|preworkout|bcaa|bcaas|eaa|eaas|amino|aminos|amino acids|' +
    'mass gainer|gainer|meal replacement|protein shake|protein drink|nutrition shake|nutritional drink|nutritional shake|' +
    'multivitamin|vitamin|vitamins|vitamin c|vitamin d|vitamin d3|vitamin b12|b12|magnesium|zinc|iron supplement|calcium supplement|' +
    'probiotic|probiotics|prebiotic|fiber supplement|psyllium|omega 3|fish oil|krill oil|cod liver oil|melatonin|ashwagandha|elderberry|' +
    'greens powder|superfood powder|super greens|spirulina|chlorella|maca|capsules|capsule|softgels|softgel|tablets|tablet|caplets|lozenges|' +
    'gummy vitamins|vitamin gummies|kids vitamins|electrolyte powder|energy gel|energy gels|glucose tablets|protein water|recovery drink|' +
    'fat burner|thermogenic|test booster|nootropic|glutamine|beta alanine|l carnitine|biotin|turmeric curcumin|curcumin|apple cider vinegar gummies',
  'Dessert':
    'pudding|pudding snack|pudding cups|applesauce|apple sauce|apple sauce cups|rice pudding|bread pudding|tapioca pudding|custard|flan|creme brulee|panna cotta|mousse|tiramisu|parfait|jello|gelatin dessert|' +
    'trifle|dessert|desserts|dessert cups|cannoli|eclairs|cream puffs|churros|fruit crisp|apple crumble|fruit crumble|apple crisp|mochi dessert|' +
    'arroz con leche|tres leches|cajeta',
  'Canned Fruit':
    'fruit cocktail|mandarin oranges|mandarin orange|pineapple chunks|pineapple tidbits|crushed pineapple|pineapple slices|sliced peaches|' +
    'peach halves|pear halves|diced peaches|diced pears|mixed fruit|fruit in juice|fruit in syrup|cherry pie filling|apple pie filling|' +
    'cranberry sauce|jellied cranberry sauce|whole berry cranberry sauce',
  'Canned Vegetable':
    'crushed tomatoes|diced tomatoes|stewed tomatoes|whole tomatoes|peeled tomatoes|whole peeled tomatoes|petite diced tomatoes|fire roasted tomatoes|' +
    'cut green beans|french style green beans|whole kernel corn|cream style corn|creamed corn|sliced carrots|sliced beets|pickled beets|' +
    'sliced potatoes|whole potatoes|new potatoes|mixed vegetables|peas and carrots|sweet peas|early peas|leaf spinach|cut spinach|' +
    'artichoke hearts|hearts of palm|water chestnuts|bamboo shoots|bean sprouts|diced green chiles|green chiles|chopped green chiles|' +
    'pumpkin puree|pure pumpkin|canned pumpkin|sweet potatoes in syrup|yams|cut yams|candied yams|succotash|mushroom pieces|pieces and stems|' +
    'sliced mushrooms|whole mushrooms|diced jalapenos|roasted red peppers|pimientos|pimentos|chipotle peppers|chipotle in adobo|nopalitos|' +
    'tomatillos|fire roasted green chiles|whole baby carrots canned|stir fry vegetables canned',
  'Frozen Vegetable': 'california blend|normandy blend|winter blend|stir fry blend|frozen vegetables|frozen veggies|steamers|steam in bag|steamfresh|vegetable medley|veggie medley|stir fry vegetables|broccoli florets',
  'Fresh Produce': 'salad mix|spring mix|mixed greens|baby greens|salad blend|lettuce|romaine|romaine hearts|iceberg|butter lettuce|arugula|baby spinach|baby kale|microgreens|sprouts',
  'Baby Food':
    'baby food|baby cereal|baby puree|baby snack|baby puffs|toddler snack|teething wafers|teething biscuits|stage 1|stage 2|stage 3|' +
    'first foods|little bites|yogurt melts|yogurt bites baby|puffs baby|pouch baby|infant cereal|rice cereal baby',
  'Infant Formula': 'infant formula|baby formula|toddler formula|toddler drink|follow on formula|toddler milk drink|growing up milk',
}

// --- FLAVOR TERMS: products that are also common flavors ----------------
// "Peanut Butter" alone is a spread, but "Protein Bar Peanut Butter" is a
// bar and "Chocolate Peanut Butter Cookies" are cookies. These decide only
// when no strong term is present, and beat weak terms.
const FLAVOR: TermList = {
  Spread: 'peanut butter|almond butter|cashew butter|nut butter|nut butters|creamy peanut butter|crunchy peanut butter|roasted peanut butter|hazelnut butter|' +
    'pecan butter|walnut butter|pistachio butter|macadamia butter|coconut butter|pumpkin seed butter|sunflower seed butter|mixed nut butter|peanut powder|powdered peanut butter',
  'Nuts & Seeds': 'nuts|nut|almonds|almond|cashews|cashew|peanuts|peanut|pecans|pecan|walnuts|walnut|pistachios|pistachio|macadamias|macadamia|' +
    'hazelnuts|hazelnut|filberts|chestnuts|seeds|seed|chia|pecan pieces',
  Chocolate: 'chocolate|dark chocolate|milk chocolate|white chocolate|semisweet chocolate|bittersweet chocolate|chocolate covered|chocolate dipped|chocolate coated',
  Candy: 'salted caramel|sea salt caramel|caramel|toffee|fudge|marshmallow|mint|peppermint|bubble gum|cotton candy|butterscotch',
  Sweetener: 'honey|agave nectar',
  'Bread & Bakery': 'roll|rolls|birthday cake|key lime pie|apple pie|pumpkin pie|pecan pie|cherry pie|blueberry pie|cookie dough|cheesecake|brownie|brownies|cinnamon roll|banana bread|pound cake|carrot cake|red velvet|churro',
  'Coffee & Tea': 'mocha|espresso|coffee|tea|chai|chai tea|matcha|cappuccino|macchiato',
  'Spices & Seasoning': 'masala|cinnamon|sea salt|salt|pumpkin spice|oregano|basil|thyme|rosemary|sage|parsley|cilantro|dill|dill weed|chives|mint leaves',
  Condiment: 'horseradish|wasabi|hot peppers|mustard',
  Sauce: 'curry|ranch|buffalo|sriracha|teriyaki|pesto|alfredo|salsa|queso|chipotle|marinara',
  Cheese: 'cheese|cheeses|cheddar cheese|parmesan|mozzarella|four cheese|three cheese|blue cheese|pepper jack|monterey jack',
  Meat: 'bacon|pepperoni|sausage|ham|salami|prosciutto',
  Dairy: 'butter',
  Beverage: 'lemonade|cola|root beer|fruit punch',
  Cookies: 'wafer|wafers|cookies and cream|cookies and creme',
}

// --- WEAK TERMS: ingredients -------------------------------------------
// Only decide the category when nothing stronger is present in any segment.
const WEAK: TermList = {
  // Spirits are weak: "Bourbon Chicken", "Vodka Sauce", "Rum Cake" are food
  'Alcoholic Beverage': 'vodka|gin|rum|whiskey|whisky|bourbon|scotch|tequila|mezcal|brandy',
  // "Cider" alone is usually apple cider (juice) in the US; a strength on
  // the label ("6% vol") makes it alcoholic — see ALCOHOL_STRENGTH
  Juice: 'cider',
  [FRUIT]:
    'apple|apples|banana|bananas|orange|oranges|mandarins|clementines|tangerines|lemon|lemons|lime|limes|grapefruit|grapes|grape|' +
    'strawberry|strawberries|blueberry|blueberries|raspberry|raspberries|blackberry|blackberries|cranberries|cherries|cherry|berries|berry|mixed berries|' +
    'peach|peaches|pear|pears|plum|plums|apricot|apricots|nectarines|mango|mangos|mangoes|mango chunks|pineapple|papaya|kiwi|kiwis|melon|cantaloupe|' +
    'honeydew|watermelon|pomegranate|pomegranate arils|figs|dates|medjool dates|avocado|avocados|coconut|guava|passion fruit|dragon fruit|' +
    'lychee|persimmon|plantain|plantains|acai|goji berries|mulberries|fruit|fruits|fruit mix|fruit blend|fruit medley|' +
    'raisins|golden raisins|prunes|craisins|cranberry',
  [VEG]:
    'tomato|tomatoes|potato|potatoes|sweet potato|sweet potatoes|russet potatoes|red potatoes|gold potatoes|onion|onions|garlic|carrot|carrots|' +
    'baby carrots|celery|broccoli|cauliflower|spinach|kale|cabbage|brussels sprouts|green beans|string beans|corn|sweet corn|corn on the cob|peas|' +
    'green peas|snap peas|snow peas|asparagus|zucchini|squash|butternut squash|spaghetti squash|pumpkin|cucumber|cucumbers|bell pepper|bell peppers|' +
    'peppers|mini sweet peppers|jalapeno|jalapenos|mushroom|mushrooms|beets|beet|radish|radishes|turnips|parsnips|leeks|shallots|scallions|' +
    'oyster mushrooms|shiitake|shiitake mushrooms|shitake mushrooms|portobello|green onions|artichoke|artichokes|eggplant|okra|collard greens|collards|mustard greens|turnip greens|greens|bok choy|chard|' +
    'vegetables|vegetable|veggies|veggie|mixed vegetables|vegetable blend|stir fry blend|yuca|cassava|jicama|taro|ginger root|fresh herbs',
  [LEGUME]:
    'beans|bean|black beans|pinto beans|kidney beans|navy beans|cannellini beans|great northern beans|garbanzo beans|chickpeas|chickpea|' +
    'chick peas|black eyed peas|blackeye peas|lima beans|butter beans|fava beans|refried beans|baked beans|pork and beans|chili beans|ranch style beans|' +
    'mayocoba|peruano beans|cranberry beans|bean medley|three bean salad',
  Meat: 'chicken|beef|pork|turkey|angus|wagyu',
  Seafood: 'shellfish',
  Cheese: 'cheddar|sharp cheddar|mild cheddar|white cheddar|swiss|jack|gouda',
  Chocolate: 'cacao|cocoa|cacao nibs|chocolat|choco',
  'Coffee & Tea': 'espresso roast|dark roast|medium roast|light roast|french roast|breakfast blend|house blend|decaf|pods|hibiscus|peppermint tea',
  Dairy: 'lactose free|a2|grass fed milk',
  Sweetener: 'maple',
  Candy: 'chewy candy|gummies|gummy',
  Sauce: 'enchilada|tomato basil|arrabbiata|puttanesca',
  'Prepared Meal': 'chili|bowl',
  Beverage: 'tropical punch',
  Snack: 'chip|chips',
}

// Terms that only exist to SWALLOW shorter terms inside them, so those
// don't decide. Never a result on their own.
const NEUTRAL = [
  'beer battered', 'beer batter', 'beer bread', 'wine gums', 'wine gum', 'rum raisin', 'bourbon vanilla', 'cheese flavored', 'cheese flavor',
  'water product', 'and water', 'with chocolate', 'chocolate flavored', 'chocolate flavor', 'milk chocolate flavored', 'strawberry flavored', 'flavored',
  'no sugar added', 'sugar free', 'zero sugar', 'reduced sugar', 'low sugar', 'less sugar', 'no salt added', 'low sodium', 'lightly salted', 'sea salted', 'unsalted',
  'dairy free', 'milk free', 'egg free', 'gluten free', 'nut free', 'peanut free', 'soy free', 'wheat free',
  'grass fed', 'cage free', 'free range', 'plant based', 'made with real', 'made with', 'real fruit', 'fruit flavored', 'fruit juice sweetened',
  'from concentrate', 'not from concentrate', 'with pulp', 'no pulp', 'pulp free', 'water added', 'packed in water', 'in water', 'in oil', 'in olive oil',
  'honey roasted', 'honey baked', 'honey glazed', 'maple glazed', 'brown sugar glazed', 'hickory smoked', 'applewood smoked', 'smoked',
  'buttermilk ranch', 'butter pecan', 'butter toffee', 'butter flavored', 'butter flavor', 'caramel apple',
  'peanut butter flavored', 'cookie dough flavored',
  'cake batter', 'cake batter flavored',
  'cheesecake flavored', 'strawberry cheesecake', 'smores', 's mores', 'cinnamon roll flavored', 'french toast flavored', 'banana bread flavored',
  'iced tea flavored', 'lemonade flavored', 'root beer flavored', 'cola flavored', 'coffee flavored', 'mocha flavored', 'tea flavored',
  'mint chocolate chip', 'chocolate chip cookie dough', 'fudge brownie', 'brownie batter', 'vanilla bean', 'french vanilla',
  'protein', 'high protein', 'keto', 'organic', 'natural', 'original', 'classic', 'family size', 'party size', 'snack size', 'fun size', 'value pack', 'variety pack',
  'hot dog chili', 'chili lime', 'chili cheese', 'chili garlic', 'sweet chili', 'lime chili', 'chile lime', 'nacho cheese flavored', 'sour cream and onion',
  'salt and vinegar', 'sea salt and vinegar', 'salt vinegar', 'bbq flavored', 'barbecue flavored', 'ranch flavored', 'buffalo style', 'jalapeno cheddar',
  'ginger snap', 'lemon pepper', 'garlic parmesan', 'honey mustard flavored', 'honey bbq', 'honey barbecue', 'teriyaki flavored', 'mango habanero',
  'milk and cookies', 'cream cheese frosting', 'with cream cheese', 'toasted coconut', 'coconut cream pie', 'pina colada flavored',
]

// Words where the name is cut into segments (see the header).
const SPLIT_WORDS = new Set(['with', 'in', 'on', 'for', 'from', 'featuring', 'w'])

// Whole-name markers resolved after the head noun is chosen.
// "6% vol", "5.2% ABV", "40% alc" — checked on the raw name, before % is stripped
const ALCOHOL_STRENGTH = /\b\d{1,2}([.,]\d)?\s?%\s?(vol|abv|alc)\b|\b(abv|alc\.? ?\d)/i
const NON_ALCOHOLIC = /\b(non ?alch?oholic|non alcohol|alkoholfrei|alcoholfrei|alcohol ?free|alcohol free|alcohol removed|dealcoholi[sz]ed|zero alcohol|zero proof|0 0|0 alcohol|no alcohol|na|n a|near beer|non alc|mocktails?)\b/
const FROZEN = /\b(frozen|steamers?|steamable|steam in bag|freezer|steamfresh|iqf)\b/
const DRIED = /\b(dried|dehydrated|freeze ?dried|sun ?dried|dried fruit|raisins?|prunes?|craisins?)\b/
const CANNED_FRUIT = /\b(in (heavy |light |extra light |natural )?syrup|in (100 )?(fruit )?juices?|in pear juice|canned|fruit cups?|halves|tidbits|fruit cocktail)\b/
const CANNED_VEG = /\b(canned|diced|stems? and pieces|pieces and stems|stewed|crushed tomatoes|diced tomatoes|whole kernel|cream style|french style|no salt added|in water|in brine|southern style|seasoned|pickled|early june)\b/
const FRESH = /\b(fresh|baby cut|bagged|clamshell|bunch|loose|washed|triple washed|pre washed|ready to eat|salad|spring mix|baby spinach|baby carrots)\b/
const DRY_LEGUME = /\b(dry|dried|bag|bulk|uncooked|soup mix|lentils?|split peas?)\b/
// Nuts, fruit or pretzels in chocolate are chocolates ("Milk Chocolate
// Almonds", "Dark Chocolate Covered Cherries")
const IN_CHOCOLATE = /\b(chocolate|chocolates|choc|cocoa dusted|yogurt covered|yogurt coated)\b/
const NOT_CHOCOLATE_FLAVOR = /\bchocolate (flavou?red|flavou?r)\b/
const PLANT_BASED = /\b(plant ?based|vegan|veggie|meatless|meat ?free|vegetarian|tofu|seitan|tempeh|bean burgers?|black bean|jackfruit|soy protein|pea protein|hemp)\b/
const WRAP_FILLING = /\b(chicken|turkey|ham|beef|steak|egg|eggs|bacon|tuna|salmon|falafel|hummus|caesar|club|burrito|breakfast|veggie)\b/
// Bars that are frozen desserts
const ICE_CREAM_WORDS = /\b(ice cream|gelato|sorbet|frozen dessert|frozen yogurt|popsicles?|ice pops?|fudge bars?|italian ices?|frozen dairy)\b/

// --- Normalization -------------------------------------------------------
function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`´']/g, '')
    .replace(/&/g, ' and ')
    .replace(/\bn\b/g, 'and') // "mac n cheese", "cookies n cream"
    .replace(/%/g, ' ')
    // "15g protein 7g sugar" is a nutrition claim, not a product word
    .replace(/\b\d+(\.\d+)?\s*(g|mg|grams?)\s+(of\s+)?(protein|sugars?|fiber|carbs?|net carbs?|fat|caffeine)\b/g, ' ')
}

// Crude singular form, applied identically to name words and term words so
// the two always agree (it doesn't need to be correct English, just stable).
function singular(w: string): string {
  if (w.length <= 3) return w
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (/(oes|ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2)
  if (/(ss|us|is)$/.test(w)) return w
  if (w.endsWith('s')) return w.slice(0, -1)
  return w
}

function tokens(s: string): string[] {
  return s.split(/[^a-z0-9]+/).filter(Boolean).map(singular)
}

// Tiers: 0 strong, 1 flavor, 2 weak, 3 neutral (never a result)
type TermInfo = { category: string | null; tier: number }
const TERMS = new Map<string, TermInfo>()
let MAX_TERM_WORDS = 1

function addTerm(raw: string, info: TermInfo) {
  const key = tokens(normalizeText(raw)).join(' ')
  if (!key) return
  // A term keeps its first (strongest) definition
  if (TERMS.has(key)) return
  TERMS.set(key, info)
  MAX_TERM_WORDS = Math.max(MAX_TERM_WORDS, key.split(' ').length)
}
;[STRONG, FLAVOR, WEAK].forEach((list, tier) => {
  for (const [category, joined] of Object.entries(list)) for (const raw of joined.split('|')) addTerm(raw, { category, tier })
})
for (const raw of NEUTRAL) addTerm(raw, { category: null, tier: 3 })

const FLAVOR_WORDS = new Set(['flavor', 'flavored', 'flavour', 'flavoured', 'flavr', 'inspired'])

type Match = { start: number; end: number; term: string; info: TermInfo }

function findMatches(words: string[]): Match[] {
  const found: Match[] = []
  for (let i = 0; i < words.length; i++) {
    for (let len = 1; len <= MAX_TERM_WORDS && i + len <= words.length; len++) {
      const term = words.slice(i, i + len).join(' ')
      let info = TERMS.get(term)
      // "Iced Coffee Flavor", "Pizza Flavored" name a flavor, not the product
      if (info && FLAVOR_WORDS.has(words[i + len])) info = { category: null, tier: 3 }
      if (info) found.push({ start: i, end: i + len, term, info })
    }
  }
  // Longer terms swallow shorter terms they contain
  return found.filter(
    (m) => !found.some((o) => o !== m && o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start)
  )
}

// Latest-ending match of one tier; a longer one wins a tie
function best(matches: Match[], tier: number): Match | null {
  let pick: Match | null = null
  for (const m of matches) {
    if (m.info.tier !== tier) continue
    if (!pick || m.end > pick.end || (m.end === pick.end && m.end - m.start > pick.end - pick.start)) pick = m
  }
  return pick
}

// A segment is either the HEAD of a comma-separated part or a SUB-part
// after with/in/on/for/from inside it ("Milk Chocolate Balls | with Cream").
type Segment = { words: string[]; part: number; sub: boolean }

function segmentsOf(text: string): Segment[] {
  const segments: Segment[] = []
  text.split(/[,;:|()\[\]{}\/+]| [-–—] |\s[-–—]|[-–—]\s/).forEach((part, partIndex) => {
    let current: string[] = []
    let sub = false
    for (const w of tokens(part)) {
      if (SPLIT_WORDS.has(w)) {
        if (current.length) segments.push({ words: current, part: partIndex, sub })
        current = []
        sub = true
      } else current.push(w)
    }
    if (current.length) segments.push({ words: current, part: partIndex, sub })
  })
  return segments
}

export type NameCategoryMatch = { category: string; matchedTerm: string; tier: 'strong' | 'flavor' | 'weak' }

// Returns our category for a FOOD product name, or null when unsure.
export function categorizeByName(name: string): NameCategoryMatch | null {
  const text = normalizeText(name)
  const segments = segmentsOf(text)
  if (!segments.length) return null

  // What follows "with/in/on..." only counts when the part before it names
  // nothing at all: "Milk Chocolate Balls with Cream" is chocolate, not
  // cream; "Brussels Sprouts with Pancetta" is not meat.
  const allMatches = segments.map((s) => findMatches(s.words))
  const headNames = new Set<number>()
  segments.forEach((s, i) => {
    if (!s.sub && allMatches[i].some((m) => m.info.tier <= 2)) headNames.add(s.part)
  })
  const perSegment = allMatches.filter((_, i) => !segments[i].sub || !headNames.has(segments[i].part))

  // The first segment holding a strong term decides; failing that the first
  // with a flavor term; failing that the first with a weak term.
  let chosen: Match | null = null
  for (let tier = 0; tier <= 2 && !chosen; tier++) {
    for (const ms of perSegment) {
      chosen = best(ms, tier)
      if (chosen) break
    }
  }
  if (!chosen || !chosen.info.category) return null

  // Wine, beer and spirits are often an INGREDIENT of a food: "Red Wine
  // Salami", "Cheddar Port Wine", "Beer Mustard", "Vodka Sauce". So an
  // alcohol match gives way to any food product term in the name, to meat
  // or cheese words, and to a food flavor term that comes after it
  // ("Stout Milk Chocolate" is chocolate, "Chocolate Stout" is beer).
  if (chosen.info.category === 'Alcoholic Beverage') {
    const alcohol: Match = chosen
    const food = perSegment
      .flat()
      .filter((m) => {
        const c = m.info.category
        if (!c || DRINK_CATEGORIES.has(c) || MARKER_SET.has(c)) return false
        if (m.info.tier === 0) return true
        if (m.info.tier === 1) return m.end > alcohol.end || perSegment.findIndex((ms) => ms.includes(m)) !== perSegment.findIndex((ms) => ms.includes(alcohol))
        return c === 'Meat' || c === 'Cheese'
      })
      .sort((a, b) => a.info.tier - b.info.tier || b.end - a.end)
    if (food.length) chosen = food[0]
  }

  const plain = ' ' + text.split(/[^a-z0-9]+/).filter(Boolean).join(' ') + ' '
  let category: string | null = chosen.info.category

  // Nuts, dried fruit and pretzels coated in chocolate
  const coatable =
    category === 'Nuts & Seeds' || category === FRUIT || (category === 'Snack' && /^(pretzel|raisin|dried|pretzel crisp)/.test(chosen.term))
  if (coatable && IN_CHOCOLATE.test(plain) && !NOT_CHOCOLATE_FLAVOR.test(plain)) category = 'Chocolate'

  if (category === FRUIT) {
    if (FROZEN.test(plain)) category = 'Frozen Fruit'
    else if (DRIED.test(plain)) category = 'Snack'
    else if (CANNED_FRUIT.test(plain)) category = 'Canned Fruit'
    else if (FRESH.test(plain)) category = 'Fresh Produce'
    // A bare fruit name ("Pineapple", "Mango") is as often a drink, candy
    // or snack flavor as the fruit itself — leave it for a human.
    else category = null
  } else if (category === VEG) {
    if (FROZEN.test(plain)) category = 'Frozen Vegetable'
    else if (CANNED_VEG.test(plain)) category = 'Canned Vegetable'
    else if (FRESH.test(plain)) category = 'Fresh Produce'
    else category = null
  } else if (category === LEGUME) {
    if (FROZEN.test(plain)) category = 'Frozen Vegetable'
    else if (DRY_LEGUME.test(plain)) category = 'Beans & Legumes'
    else category = 'Canned Vegetable'
  }
  if (!category) return null

  if ((category === 'Meat' || category === 'Seafood') && PLANT_BASED.test(plain)) category = 'Meat Alternative'
  if ((category === 'Beverage' || category === 'Juice') && ALCOHOL_STRENGTH.test(name)) category = 'Alcoholic Beverage'
  if (category === 'Alcoholic Beverage' && NON_ALCOHOLIC.test(plain)) category = 'Beverage'
  if (category === 'Canned Vegetable' && FROZEN.test(plain)) category = 'Frozen Vegetable'
  // "Turkey & Cheddar Wrap" is a sandwich; "Spinach Wraps" are flatbread
  if (chosen.term === 'wrap' && WRAP_FILLING.test(plain)) category = 'Prepared Meal'
  if (category === 'Canned Fruit' && FROZEN.test(plain)) category = 'Frozen Fruit'
  if ((category === 'Snack' || category === 'Candy' || category === 'Chocolate') && /^(bar|candy bar|chocolate bar|fruit bar)$/.test(chosen.term) && (ICE_CREAM_WORDS.test(plain) || /\bfrozen\b/.test(plain)))
    category = 'Ice Cream'

  return { category, matchedTerm: chosen.term, tier: (['strong', 'flavor', 'weak'] as const)[chosen.info.tier] }
}

const DRINK_CATEGORIES = new Set(['Alcoholic Beverage', 'Beverage', 'Juice', 'Coffee & Tea'])

// SAFETY CHECK (same as offCategoryMap.ts): every category a term can
// produce must exist in productTypes.ts, so a typo fails loudly at startup.
const MARKERS = [FRUIT, VEG, LEGUME]
const MARKER_SET = new Set(MARKERS)
const produced = new Set<string>(['Fresh Produce', 'Frozen Fruit', 'Frozen Vegetable', 'Canned Fruit', 'Canned Vegetable', 'Snack', 'Beverage', 'Chocolate', 'Ice Cream', 'Beans & Legumes'])
for (const list of [STRONG, FLAVOR, WEAK]) for (const c of Object.keys(list)) if (!MARKERS.includes(c)) produced.add(c)
const unknownCategories = [...produced].filter((c) => !PRODUCT_CATEGORIES_BY_TYPE.food_beverage.includes(c))
if (unknownCategories.length > 0) {
  throw new Error(`nameCategoryMap.ts maps to categories missing from productTypes.ts: ${unknownCategories.join(', ')}`)
}

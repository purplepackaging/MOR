/**
 * Other words customers type for a product. Search reads them; the site never shows them.
 *
 * A word here names the same thing as the product, the way a kitchen says it ("clamshell", "sauce cup",
 * "tin foil"). It is never a claim about the product: nothing like "compostable" or "microwave safe".
 * Write each phrase in the plural with spaces ("to go boxes"). Every word a customer types has to start
 * a word of the product's name, sizes or these phrases, so "to go box" and "to-go" both find it. A spelling
 * people run together gets its own entry ("togo").
 *
 * Keys are product slugs. The build fails on a slug that is not in the catalog.
 */
export const searchWords: Record<string, string[]> = {
  /* Cups & lids */
  "clear-cold-cups": ["plastic cups", "smoothie cups", "drink cups"],
  "cold-cup-dome-lids": ["cup lids"],
  "cold-cup-flat-lids": ["cup lids", "straw lids"],
  "translucent-cups": ["plastic cups", "drink cups"],
  "sipper-lids": ["cup lids"],
  "hot-cups": ["coffee cups", "paper cups", "tea cups", "cup jackets"],
  "hot-cup-lids": ["coffee lids", "cup lids"],
  "portion-cups": ["sauce cups", "souffle cups", "condiment cups", "ketchup cups", "dressing cups", "salsa cups", "dip cups", "ramekins"],
  "portion-cup-lids": ["sauce cup lids", "souffle cup lids", "condiment cup lids"],
  "cup-carriers": ["drink carriers", "cup holders", "drink trays", "coffee carriers"],

  /* Takeout containers */
  "microwavable-rectangular": ["to go containers", "togo containers", "take out containers", "meal prep containers", "plastic containers"],
  "microwavable-round": ["to go containers", "togo containers", "take out containers", "meal prep containers", "plastic containers"],
  "deli-containers": ["soup containers", "deli cups", "pint containers", "quart containers", "plastic containers"],
  "paper-soup-cups": ["soup containers", "paper food cups"],
  "hinged-foam-free": ["clamshells", "to go boxes", "togo boxes", "take out boxes", "carry out boxes", "carryout boxes", "foam boxes", "styrofoam boxes"],
  "hinged-clear-lid": ["clamshells", "to go boxes", "togo boxes", "take out boxes", "carry out boxes", "carryout boxes"],
  "clear-hinged": ["clamshells", "to go boxes", "togo boxes", "salad containers", "plastic containers"],
  "bagasse-hinged": ["clamshells", "to go boxes", "togo boxes", "take out boxes", "carry out boxes", "carryout boxes", "fiber boxes"],
  "kraft-takeout-boxes": ["to go boxes", "togo boxes", "take out boxes", "carry out boxes", "carryout boxes", "kraft boxes", "food boxes"],
  "paper-food-pails": ["chinese takeout boxes", "noodle boxes", "to go boxes", "togo boxes", "take out boxes"],
  "kraft-food-trays": ["food boats", "paper boats", "fry trays", "hot dog trays", "nacho trays"],
  "clear-bowls": ["salad bowls", "plastic bowls"],
  "noodle-bowls": ["ramen bowls", "pho bowls", "to go bowls", "togo bowls", "plastic bowls"],
  "sushi-trays": ["sushi containers", "sushi boxes"],
  "bento-boxes": ["bento containers"],
  "party-trays": ["catering trays", "platters", "deli trays"],
  "rose-bowls": ["salad bowls", "plastic bowls"],
  "clear-containers": ["deli containers", "salad containers", "fruit containers"],
  "anti-fog-containers": ["deli containers", "plastic containers"],
  "hinged-deli-containers": ["clamshells", "plastic containers"],
  "bakery-containers": ["muffin containers", "pie containers", "pastry containers", "clamshells"],
  "meat-trays": ["butcher trays", "produce trays"],
  "food-pads": ["meat pads", "soaker pads"],

  /* Foil & wrap */
  "steam-table-pans": ["aluminum pans", "foil pans", "catering pans", "hotel pans", "chafing pans"],
  "steam-table-lids": ["aluminum pan lids", "foil pan lids", "catering pan lids"],
  "round-foil-containers": ["aluminum pans", "foil pans", "round pans", "aluminum containers"],
  "oblong-foil-containers": ["aluminum pans", "foil pans", "aluminum containers"],
  "foil-rolls": ["tin foil", "foil wrap"],
  "foil-sheets": ["tin foil", "foil wrap", "sandwich foil", "pop up foil"],
  "food-film": ["plastic wrap", "cling wrap", "cling film", "saran wrap", "food wrap"],
  "deli-paper": ["sandwich paper", "deli sheets", "burger paper", "basket liners"],
  "butcher-paper": ["meat paper", "bbq paper"],
  "chafing-fuel": ["sterno", "canned heat", "fuel cans"],

  /* Plates & bowls */
  "bagasse-plates": ["fiber plates", "bagasse plates", "disposable plates"],
  "bagasse-square-plates": ["fiber plates", "bagasse plates", "disposable plates"],
  "bagasse-bowls": ["fiber bowls", "bagasse bowls", "disposable bowls"],
  "mfpp-plates": ["foam plates", "styrofoam plates", "disposable plates"],
  "plastic-plates": ["party plates", "disposable plates"],
  "paper-plates": ["disposable plates"],

  /* Cutlery & straws */
  "cutlery-medium": ["utensils", "silverware", "plasticware", "flatware", "plastic forks", "plastic spoons", "plastic knives"],
  "cutlery-heavy": ["utensils", "silverware", "plasticware", "flatware", "plastic forks", "plastic spoons", "plastic knives"],
  "cutlery-extra-heavy": ["utensils", "silverware", "plasticware", "flatware", "plastic forks", "plastic spoons", "plastic knives"],
  "wrapped-cutlery": ["utensils", "silverware", "plasticware", "wrapped forks", "wrapped spoons", "wrapped knives"],
  "cutlery-kits": ["utensil kits", "silverware kits", "napkin kits", "cutlery packs", "plasticware"],
  "compostable-cutlery": ["utensils", "silverware"],
  "asian-soup-spoons": ["ramen spoons", "pho spoons", "wonton spoons"],
  straws: ["drinking straws", "bubble tea straws", "stir sticks"],
  chopsticks: ["chop sticks"],
  "serving-utensils": ["catering utensils", "salad tongs"],
  skewers: ["kebab sticks", "kabob sticks", "bbq sticks"],
  "pizza-savers": ["pizza tables", "pizza stands", "pizza stacks"],

  /* Bags */
  "tshirt-bags": ["plastic bags", "grocery bags", "carry out bags", "carryout bags", "take out bags", "to go bags", "togo bags", "shopping bags", "tshirt bags"],
  "kraft-bags": ["paper bags", "brown bags", "lunch bags", "grocery bags"],
  "handle-bags": ["paper bags", "brown bags", "shopping bags", "take out bags", "to go bags", "togo bags", "carry out bags", "carryout bags"],
  "grocery-bags": ["paper bags", "brown bags", "paper sacks"],
  "flat-paper-bags": ["bakery bags"],
  "foil-bags": ["hot bags", "chicken bags", "foil lined bags", "hot food bags"],
  "poly-bags": ["ziploc bags", "ziplock bags", "zip lock bags", "storage bags", "plastic bags"],
  "reusable-bags": ["tote bags", "shopping bags"],

  /* Napkins & paper */
  "dinner-napkins": ["paper napkins", "serviettes"],
  "lunch-napkins": ["paper napkins", "serviettes"],
  "beverage-napkins": ["cocktail napkins", "bar napkins", "paper napkins"],
  "dispenser-napkins": ["paper napkins"],
  "paper-towels": ["toilet paper", "toilet tissue", "bathroom tissue", "hand towels"],
  "thermal-rolls": ["receipt paper", "register tape", "register rolls", "pos paper", "cash register paper"],
  "guest-checks": ["order pads", "server pads", "waiter pads", "waitress pads", "check pads", "order books"],

  /* Gloves & kitchen safety */
  "nitrile-gloves": ["disposable gloves", "food gloves", "rubber gloves"],
  "vinyl-gloves": ["disposable gloves", "food gloves", "plastic gloves", "rubber gloves", "deli gloves"],
  "hair-beard-covers": ["hairnets", "hair nets", "beard nets", "chef hats"],

  /* Cleaning & trash */
  "can-liners": ["trash bags", "garbage bags", "bin liners"],
  "hdpe-can-liners": ["trash bags", "garbage bags", "bin liners"],
  "cleaning-chemicals": ["cleaners", "dish soap"],
  "hand-soap": ["hand wash"],
};

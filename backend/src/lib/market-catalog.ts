// Demo supermarket stock. Prices are made up for the demo.
// packBase: grams or millilitres in one pack (for weight/volume units).
// countable: quantity in "pcs" maps to that many packs.

export type CatalogProduct = {
  name: string;
  aliases: string[];
  packSize: string;
  priceCents: number;
  packBase?: number;
  countable?: boolean;
};

const p = (
  name: string,
  priceCents: number,
  packSize: string,
  options: { aliases?: string[]; packBase?: number; countable?: boolean } = {},
): CatalogProduct => ({ name, priceCents, packSize, aliases: options.aliases ?? [], ...options });

export const CATALOG: readonly CatalogProduct[] = [
  // Vegetables
  p("Tomato", 45, "1 pc", { countable: true, packBase: 120 }),
  p("Cherry tomato", 249, "250 g", { packBase: 250 }),
  p("Onion", 35, "1 pc", { countable: true, aliases: ["yellow onion", "brown onion"], packBase: 150 }),
  p("Red onion", 45, "1 pc", { countable: true, packBase: 150 }),
  p("Spring onion", 99, "1 bunch", { aliases: ["scallion", "green onion"] }),
  p("Garlic", 59, "1 bulb", { aliases: ["garlic clove"] }),
  p("Ginger", 129, "100 g", { packBase: 100 }),
  p("Potato", 199, "1 kg", { packBase: 1000, aliases: ["potatoes"] }),
  p("Sweet potato", 249, "1 kg", { packBase: 1000 }),
  p("Carrot", 119, "1 kg", { packBase: 1000 }),
  p("Bell pepper", 89, "1 pc", { countable: true, aliases: ["pepper red", "red pepper", "capsicum"] }),
  p("Chili pepper", 99, "50 g", { aliases: ["chili", "chilli"] }),
  p("Cucumber", 69, "1 pc", { countable: true }),
  p("Zucchini", 79, "1 pc", { countable: true, aliases: ["courgette"] }),
  p("Eggplant", 99, "1 pc", { countable: true, aliases: ["aubergine"] }),
  p("Broccoli", 149, "1 head", { countable: true }),
  p("Spinach", 199, "250 g", { packBase: 250 }),
  p("Lettuce", 99, "1 head", { countable: true, aliases: ["salad"] }),
  p("Cabbage", 129, "1 head", { countable: true }),
  p("Mushroom", 199, "250 g", { packBase: 250, aliases: ["champignon"] }),
  p("Celery", 119, "1 bunch"),
  p("Avocado", 129, "1 pc", { countable: true }),
  p("Corn", 99, "340 g can", { aliases: ["sweetcorn"] }),
  // Fruit & herbs
  p("Lemon", 49, "1 pc", { countable: true }),
  p("Lime", 39, "1 pc", { countable: true }),
  p("Apple", 299, "1 kg", { packBase: 1000 }),
  p("Banana", 179, "1 kg", { packBase: 1000 }),
  p("Basil", 149, "1 pot", { aliases: ["fresh basil"] }),
  p("Parsley", 99, "1 bunch"),
  p("Coriander", 99, "1 bunch", { aliases: ["cilantro"] }),
  // Meat & fish
  p("Chicken breast", 699, "500 g", { packBase: 500 }),
  p("Chicken thigh", 549, "500 g", { packBase: 500 }),
  p("Ground beef", 599, "500 g", { packBase: 500, aliases: ["minced beef", "beef mince"] }),
  p("Beef steak", 1299, "400 g", { packBase: 400 }),
  p("Pork belly", 799, "500 g", { packBase: 500 }),
  p("Bacon", 299, "150 g", { packBase: 150 }),
  p("Salmon fillet", 899, "300 g", { packBase: 300, aliases: ["salmon"] }),
  p("Shrimp", 799, "300 g", { packBase: 300, aliases: ["prawn"] }),
  p("Tofu", 199, "400 g", { packBase: 400 }),
  // Dairy & eggs
  p("Eggs", 299, "10 pcs", { aliases: ["egg"] }),
  p("Milk", 119, "1 L", { packBase: 1000 }),
  p("Butter", 249, "250 g", { packBase: 250 }),
  p("Heavy cream", 179, "200 ml", { packBase: 200, aliases: ["cream", "whipping cream"] }),
  p("Greek yogurt", 199, "500 g", { packBase: 500, aliases: ["yogurt", "yoghurt"] }),
  p("Parmesan", 399, "150 g", { packBase: 150, aliases: ["parmigiano"] }),
  p("Mozzarella", 129, "125 g", { packBase: 125 }),
  p("Cheddar", 299, "200 g", { packBase: 200, aliases: ["cheese"] }),
  p("Feta", 249, "200 g", { packBase: 200 }),
  // Pantry
  p("Spaghetti", 149, "500 g", { packBase: 500, aliases: ["pasta"] }),
  p("Penne", 149, "500 g", { packBase: 500 }),
  p("Rice", 249, "1 kg", { packBase: 1000, aliases: ["jasmine rice", "basmati rice"] }),
  p("Egg noodles", 199, "400 g", { packBase: 400, aliases: ["noodle"] }),
  p("Flour", 99, "1 kg", { packBase: 1000, aliases: ["all purpose flour", "plain flour"] }),
  p("Sugar", 129, "1 kg", { packBase: 1000 }),
  p("Brown sugar", 179, "500 g", { packBase: 500 }),
  p("Bread", 249, "1 loaf", { aliases: ["baguette"] }),
  p("Canned tomatoes", 99, "400 g can", { packBase: 400, aliases: ["chopped tomato", "crushed tomato", "tomato can"] }),
  p("Tomato paste", 89, "200 g", { packBase: 200 }),
  p("Coconut milk", 179, "400 ml can", { packBase: 400 }),
  p("Chicken stock", 199, "1 L", { packBase: 1000, aliases: ["chicken broth", "stock", "broth"] }),
  p("Chickpeas", 99, "400 g can", { packBase: 400, aliases: ["chickpea"] }),
  p("Black beans", 99, "400 g can", { packBase: 400 }),
  p("Olive oil", 699, "750 ml", { packBase: 750 }),
  p("Vegetable oil", 299, "1 L", { packBase: 1000, aliases: ["cooking oil", "sunflower oil"] }),
  p("Sesame oil", 349, "250 ml", { packBase: 250 }),
  p("Soy sauce", 249, "250 ml", { packBase: 250 }),
  p("Oyster sauce", 279, "250 ml", { packBase: 250 }),
  p("Vinegar", 129, "500 ml", { packBase: 500, aliases: ["rice vinegar", "white vinegar"] }),
  p("Honey", 449, "350 g", { packBase: 350 }),
  p("Salt", 59, "500 g", { packBase: 500, aliases: ["sea salt"] }),
  p("Black pepper", 199, "50 g", { packBase: 50, aliases: ["ground pepper", "peppercorn"] }),
  p("Paprika", 179, "50 g", { packBase: 50 }),
  p("Cumin", 179, "50 g", { packBase: 50 }),
  p("Curry powder", 199, "50 g", { packBase: 50, aliases: ["curry paste"] }),
  p("Oregano", 149, "20 g", { packBase: 20, aliases: ["dried oregano"] }),
  p("Baking powder", 89, "4 x 15 g", { aliases: ["baking soda"] }),
  p("Vanilla extract", 399, "38 ml", { aliases: ["vanilla"] }),
  p("Dark chocolate", 199, "100 g", { packBase: 100, aliases: ["chocolate"] }),
];

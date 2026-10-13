import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { buildDishes, dishesFromRecipes } from "@/lib/dishes";
import { recommendRecipes, RecipeServiceError } from "@/lib/recipe-service";
import { searchImage, searchWeb, webSearchApiKey, WebSearchError } from "@/lib/web-search";

// Tools the model may call. Add new ones in buildChatTools() with `tool()` from "ai".
// llm.ts passes them to streamText and lets the model run up to MAX_TOOL_STEPS rounds.
export const MAX_TOOL_STEPS = 5;

export const webSearchTool = tool({
  description:
    "Search the web for up-to-date information: recipes from a specific source, seasonal produce, " +
    "food safety, nutrition facts, prices, or anything you are unsure about. Returns titles, URLs, and snippets.",
  inputSchema: z.object({
    query: z.string().min(2).max(400).describe("A short search query in plain words"),
  }),
  execute: async ({ query }, { abortSignal }) => {
    try {
      return await searchWeb(query, { signal: abortSignal });
    } catch (error) {
      // Give the model the reason instead of failing the whole reply.
      if (error instanceof WebSearchError) return { error: error.message, results: [] };
      throw error;
    }
  },
});

export const PROPOSE_SHOPPING_LIST = "proposeShoppingList";

// Shows a shopping list card with checkboxes. It never buys anything: the backend only
// orders after the user clicks Accept. Its input is read from the stream in llm.ts.
export const proposeShoppingListTool = tool({
  description:
    "Show the user a shopping list of ingredients they may need to buy. Use it only when this reply " +
    "suggests a specific recipe or dishes, or the user asked for a shopping list. Never use it for " +
    "greetings, questions about you, small talk, or off-topic answers. The app shows it with checkboxes; " +
    "nothing is bought until the user clicks Accept. Call it once, after writing your answer.",
  inputSchema: z.object({
    items: z
      .array(
        z.object({
          name: z.string().min(1).max(80).describe('Simple supermarket product name in English, e.g. "olive oil"'),
          quantity: z.number().positive().describe("Amount as a number"),
          unit: z.string().max(20).describe("g, kg, ml, l, pcs, tbsp, tsp, bunch, or clove"),
          note: z.string().max(160).optional().describe("Short reason, e.g. \"for the soup\""),
          searchTerm: z
            .string()
            .max(80)
            .describe('Swedish supermarket search word for Willys/Hemköp, e.g. "gul lök", "olivolja", "körsbärstomater"'),
          have: z
            .boolean()
            .optional()
            .describe("true if the user already has it, or has something that works instead (fresh tomatoes for peeled tomatoes)"),
        }),
      )
      .max(40)
      .describe("Empty only when no ingredients are involved"),
  }),
  execute: async ({ items }) => ({
    shown: items.length,
    message: "The list is now shown to the user. Do not repeat it as JSON or say the order is placed.",
  }),
});

export const SUGGEST_DISHES = "suggestDishes";
const DISH_TOOL_LIMIT = 3;

// Shows recipes from the recipe database as cards with a photo each. The user picks one or
// more; the backend then asks the database what is missing and builds the shopping list.
function suggestDishesTool(withPhotos: boolean, env: Record<string, string | undefined>) {
  return tool({
    description:
      "Find recipes in the recipe database that use the ingredients the user has, and show them as cards " +
      "with a photo. Use it whenever the user asks what to cook, or sends ingredients or a fridge photo, " +
      "and has not picked a dish yet. After calling it, write only a short intro and ask which dishes they want.",
    inputSchema: z.object({
      ingredients: z
        .array(z.string().trim().min(1).max(60))
        .min(1)
        .max(30)
        .describe('Ingredients the user has, as short singular English names, e.g. ["tomato", "egg", "onion"]'),
    }),
    execute: async ({ ingredients }, { abortSignal }) => {
      let recipes;
      try {
        recipes = await recommendRecipes(ingredients, DISH_TOOL_LIMIT, { env, signal: abortSignal });
      } catch (error) {
        if (error instanceof RecipeServiceError) return { error: error.message, dishes: [] };
        throw error;
      }
      if (recipes.length === 0) {
        return {
          dishes: [],
          message:
            "No recipe in the database matches these ingredients. Tell the user, and ask for more ingredients. " +
            "Do not invent recipes.",
        };
      }
      const finder = withPhotos ? (name: string, signal?: AbortSignal) => searchImage(`${name} dish`, { signal }) : null;
      const dishes = await buildDishes(dishesFromRecipes(recipes, ingredients), finder, abortSignal);
      return {
        dishes,
        message:
          "The dishes are now shown to the user as cards, from the recipe database. Do not list them again " +
          "and do not invent other recipes. Ask which ones they want to make. Do not propose a shopping list yet.",
      };
    },
  });
}

export function buildChatTools(env: Record<string, string | undefined> = process.env): ToolSet {
  const canSearch = Boolean(webSearchApiKey(env));
  return {
    [SUGGEST_DISHES]: suggestDishesTool(canSearch, env),
    [PROPOSE_SHOPPING_LIST]: proposeShoppingListTool,
    ...(canSearch ? { webSearch: webSearchTool } : {}),
  };
}

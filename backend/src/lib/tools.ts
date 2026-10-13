import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { buildDishes, dishInputSchema, MAX_DISHES } from "@/lib/dishes";
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

// Shows 2-4 dish ideas as cards with a photo each. The user picks one, then gets the full
// recipe and the shopping list in the next turn.
function suggestDishesTool(withPhotos: boolean) {
  return tool({
    description:
      "Show the user 2 to 3 dish ideas as cards, each with a photo, ingredients, and short steps. " +
      "Use it whenever you suggest what to cook and the user has not picked a dish yet. " +
      "After calling it, write only a short intro and ask which dish they want to make.",
    inputSchema: z.object({ dishes: z.array(dishInputSchema).min(1).max(MAX_DISHES) }),
    execute: async ({ dishes }, { abortSignal }) => {
      const finder = withPhotos ? (name: string, signal?: AbortSignal) => searchImage(`${name} dish`, { signal }) : null;
      return {
        dishes: await buildDishes(dishes, finder, abortSignal),
        message:
          "The dishes are now shown to the user as cards. Do not list them again. " +
          "Ask which one they want to make. Do not propose a shopping list yet.",
      };
    },
  });
}

export function buildChatTools(env: Record<string, string | undefined> = process.env): ToolSet {
  const canSearch = Boolean(webSearchApiKey(env));
  return {
    [SUGGEST_DISHES]: suggestDishesTool(canSearch),
    [PROPOSE_SHOPPING_LIST]: proposeShoppingListTool,
    ...(canSearch ? { webSearch: webSearchTool } : {}),
  };
}

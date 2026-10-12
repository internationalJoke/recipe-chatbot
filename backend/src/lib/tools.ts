import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { searchWeb, webSearchApiKey, WebSearchError } from "@/lib/web-search";

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


export const recipeRecommendationTool = tool({
  description:
    "Recommend recipes from the recipe database based on ingredients the user already has.",

  inputSchema: z.object({
    ingredients: z
      .array(z.string())
      .min(1)
      .describe(
        "Ingredients the user currently has"
      ),

    topK: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5),
  }),

  execute: async ({
    ingredients,
    topK,
  }) => {

    const baseUrl =
      process.env.RECIPE_SERVICE_URL ??
      "http://recipe-service:8000";

    const response = await fetch(
      `${baseUrl}/recommend`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          available_ingredients:
            ingredients,

          top_k:
            topK,

          min_coverage:
            0.3,

          max_missing_ingredients:
            4,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Recipe recommendation service failed: ${response.status}`
      );
    }

    return await response.json();
  },
});


export const recipeMissingIngredientsTool = tool({
  description:
    "Get the exact missing ingredients for a selected recipe based on ingredients the user already has.",

  inputSchema: z.object({

    recipeId: z
      .number()
      .int()
      .describe(
        "The selected recipe ID"
      ),

    ingredients: z
      .array(z.string())
      .describe(
        "Ingredients the user currently has"
      ),
  }),

  execute: async ({
    recipeId,
    ingredients,
  }) => {

    const baseUrl =
      process.env.RECIPE_SERVICE_URL ??
      "http://recipe-service:8000";

    const response = await fetch(
      `${baseUrl}/missing`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          recipe_id:
            recipeId,

          available_ingredients:
            ingredients,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Missing ingredient service failed: ${response.status}`
      );
    }

    return await response.json();
  },
});

export function buildChatTools(
  env: Record<string, string | undefined> = process.env
): ToolSet {
  return {
    recipeRecommendation: recipeRecommendationTool,

    recipeMissingIngredients: recipeMissingIngredientsTool,

    ...(webSearchApiKey(env)
      ? { webSearch: webSearchTool }
      : {}),
  };
}
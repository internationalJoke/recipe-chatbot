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

export function buildChatTools(env: Record<string, string | undefined> = process.env): ToolSet {
  return {
    ...(webSearchApiKey(env) ? { webSearch: webSearchTool } : {}),
  };
}

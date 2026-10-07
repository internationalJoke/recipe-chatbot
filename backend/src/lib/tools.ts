import type { ToolSet } from "ai";

// Tools the model may call. Add entries here with `tool()` from "ai", e.g.
//
//   import { tool } from "ai";
//   import { z } from "zod";
//
//   searchProducts: tool({
//     description: "Look up a product in the supermarket catalog",
//     inputSchema: z.object({ name: z.string() }),
//     execute: async ({ name }) => demoMarket.findProduct(name),
//   }),
//
// llm.ts passes them to streamText and lets the model run up to MAX_TOOL_STEPS rounds.
export const chatTools: ToolSet = {};

export const MAX_TOOL_STEPS = 5;

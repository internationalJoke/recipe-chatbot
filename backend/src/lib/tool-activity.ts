import { z } from "zod";

// What the model did with tools during one reply. Saved on the message so the UI can show it.
export type ToolSource = { title: string; url: string };
export type ToolActivity = { tool: string; query?: string; sources: ToolSource[]; error?: string };
export type ToolOutput = { toolName: string; input: unknown; output: unknown };

const MAX_SOURCES = 5;

const searchInputSchema = z.object({ query: z.string() });
const searchOutputSchema = z.object({
  error: z.string().optional(),
  results: z.array(z.object({ title: z.string(), url: z.string() })).catch([]),
});

export function queryOf(input: unknown): string | undefined {
  const parsed = searchInputSchema.safeParse(input);
  return parsed.success ? parsed.data.query.slice(0, 200) : undefined;
}

export function summarizeToolOutputs(outputs: ToolOutput[]): ToolActivity[] {
  return outputs.map(({ toolName, input, output }) => {
    const query = queryOf(input);
    const parsed = searchOutputSchema.safeParse(output);
    const sources = parsed.success
      ? parsed.data.results.slice(0, MAX_SOURCES).map(({ title, url }) => ({ title: title.slice(0, 160), url }))
      : [];
    return {
      tool: toolName,
      ...(query ? { query } : {}),
      sources,
      ...(parsed.success && parsed.data.error ? { error: parsed.data.error } : {}),
    };
  });
}

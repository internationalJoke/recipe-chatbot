import { z } from "zod";

// Web search via Tavily (https://tavily.com). Enabled when TAVILY_API_KEY is set.
const TAVILY_URL = "https://api.tavily.com/search";
const SEARCH_TIMEOUT_MS = 20_000;
export const MAX_RESULTS = 5;
const MAX_SNIPPET = 1_200;
const MAX_QUERY = 400;

const tavilyResponseSchema = z.object({
  answer: z.string().nullish(),
  results: z.array(
    z.object({
      title: z.string().catch(""),
      url: z.string(),
      content: z.string().catch(""),
    }),
  ),
});

export type WebResult = { title: string; url: string; snippet: string };
export type WebSearchResponse = { answer?: string; results: WebResult[] };

export class WebSearchError extends Error {}

export function webSearchApiKey(env: Record<string, string | undefined> = process.env) {
  return env.TAVILY_API_KEY?.trim() ?? "";
}

function messageForStatus(status: number) {
  if (status === 401) return "Web search key was rejected. Check TAVILY_API_KEY.";
  if (status === 429) return "Web search rate limit reached. Try again soon.";
  if (status === 432 || status === 433) return "Web search plan limit reached.";
  return `Web search failed with HTTP ${status}.`;
}

// Only keep https links and trim long page text, so the prompt stays small and safe.
export function cleanResults(raw: z.infer<typeof tavilyResponseSchema>["results"]): WebResult[] {
  const seen = new Set<string>();
  return raw
    .flatMap((result) => {
      try {
        const url = new URL(result.url);
        if (url.protocol !== "https:" || seen.has(url.href)) return [];
        seen.add(url.href);
        return [{
          title: result.title.replace(/\s+/g, " ").trim().slice(0, 160) || url.hostname,
          url: url.href,
          snippet: result.content.replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET),
        }];
      } catch {
        return [];
      }
    })
    .slice(0, MAX_RESULTS);
}

type TavilyOptions = { apiKey?: string; signal?: AbortSignal; fetchFn?: typeof fetch };

async function callTavily(body: Record<string, unknown>, options: TavilyOptions): Promise<unknown> {
  const apiKey = options.apiKey ?? webSearchApiKey();
  if (!apiKey) throw new WebSearchError("Web search is not configured. Set TAVILY_API_KEY.");

  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const fetchFn = options.fetchFn ?? fetch;

  let response: Response;
  try {
    response = await fetchFn(TAVILY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (timeout.aborted) throw new WebSearchError("Web search timed out.");
    throw error;
  }

  if (!response.ok) throw new WebSearchError(messageForStatus(response.status));
  return response.json().catch(() => null);
}

export async function searchWeb(query: string, options: TavilyOptions = {}): Promise<WebSearchResponse> {
  const data = await callTavily(
    { query: query.trim().slice(0, MAX_QUERY), max_results: MAX_RESULTS, search_depth: "basic", include_answer: "basic" },
    options,
  );
  const parsed = tavilyResponseSchema.safeParse(data);
  if (!parsed.success) throw new WebSearchError("Web search returned an unexpected response.");

  const answer = parsed.data.answer?.trim();
  return { ...(answer ? { answer: answer.slice(0, MAX_SNIPPET) } : {}), results: cleanResults(parsed.data.results) };
}

// Tavily returns images as plain URLs or as { url, description }.
const tavilyImagesSchema = z.object({
  images: z.array(z.union([z.string(), z.object({ url: z.string() })])).catch([]),
});

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|avif)(\?|$)/i;

/** Returns the first usable https image URL for a query, or null. Never throws for "no image". */
export async function searchImage(query: string, options: TavilyOptions = {}): Promise<string | null> {
  const data = await callTavily(
    { query: query.trim().slice(0, MAX_QUERY), max_results: 1, search_depth: "basic", include_images: true },
    options,
  );
  const urls = tavilyImagesSchema.parse(data ?? {}).images.map((image) => (typeof image === "string" ? image : image.url));
  const usable = urls.flatMap((raw) => {
    try {
      const url = new URL(raw);
      return url.protocol === "https:" && url.href.length <= 2_048 ? [url.href] : [];
    } catch {
      return [];
    }
  });
  // Prefer links that clearly point at an image file.
  return usable.find((url) => IMAGE_EXTENSION.test(url)) ?? usable[0] ?? null;
}

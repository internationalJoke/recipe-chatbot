import { describe, expect, it, vi } from "vitest";
import { cleanResults, searchImage, searchWeb, WebSearchError } from "@/lib/web-search";
import { buildChatTools } from "@/lib/tools";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("searchWeb", () => {
  it("sends the query to Tavily with a bearer key and returns clean results", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        answer: "  Basil is in season in summer.  ",
        results: [{ title: "Basil  guide", url: "https://example.com/basil", content: "Fresh   basil..." }],
      }),
    );

    const result = await searchWeb("  when is basil in season  ", { apiKey: "tvly-k", fetchFn });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tvly-k");
    expect(JSON.parse(init.body as string)).toMatchObject({ query: "when is basil in season", max_results: 5 });
    expect(result).toEqual({
      answer: "Basil is in season in summer.",
      results: [{ title: "Basil guide", url: "https://example.com/basil", snippet: "Fresh basil..." }],
    });
  });

  it("refuses to run without a key", async () => {
    await expect(searchWeb("x", { apiKey: "" })).rejects.toThrow(/TAVILY_API_KEY/);
  });

  it("maps HTTP errors to friendly messages", async () => {
    const run = (status: number) => searchWeb("x", { apiKey: "k", fetchFn: async () => jsonResponse({}, status) });
    await expect(run(401)).rejects.toThrow(/rejected/);
    await expect(run(429)).rejects.toThrow(/rate limit/);
    await expect(run(432)).rejects.toThrow(/plan limit/);
    await expect(run(500)).rejects.toBeInstanceOf(WebSearchError);
  });

  it("rejects an unexpected response body", async () => {
    await expect(searchWeb("x", { apiKey: "k", fetchFn: async () => jsonResponse({ nope: 1 }) })).rejects.toThrow(
      /unexpected response/,
    );
  });
});

describe("cleanResults", () => {
  it("drops non-https and duplicate links and caps the count", () => {
    const raw = [
      { title: "a", url: "http://insecure.com", content: "x" },
      { title: "", url: "https://dup.com/", content: "x" },
      { title: "b", url: "https://dup.com/", content: "y" },
      { title: "c", url: "not a url", content: "z" },
      ...Array.from({ length: 10 }, (_, i) => ({ title: `t${i}`, url: `https://s${i}.com/`, content: "c" })),
    ];
    const results = cleanResults(raw);
    expect(results[0]).toEqual({ title: "dup.com", url: "https://dup.com/", snippet: "x" });
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.url.startsWith("https://"))).toBe(true);
  });
});

describe("buildChatTools", () => {
  it("adds webSearch only when TAVILY_API_KEY is set", () => {
    expect(Object.keys(buildChatTools({}))).toEqual(["suggestDishes", "proposeShoppingList", "recipeRecommendation", "recipeMissingIngredients"]);
    expect(Object.keys(buildChatTools({ TAVILY_API_KEY: "tvly-k" }))).toEqual(["suggestDishes", "proposeShoppingList", "recipeRecommendation", "recipeMissingIngredients", "webSearch"]);
  });

  it("returns the error to the model instead of throwing", async () => {
    const tools = buildChatTools({ TAVILY_API_KEY: "tvly-k" });
    vi.stubEnv("TAVILY_API_KEY", "");
    try {
      const output = await tools.webSearch.execute!({ query: "basil" }, { toolCallId: "1", messages: [] } as never);
      expect(output).toEqual({ error: expect.stringMatching(/TAVILY_API_KEY/), results: [] });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("searchImage", () => {
  it("asks Tavily for images and prefers https image files", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ images: ["http://insecure.com/a.jpg", { url: "https://site.com/page" }, "https://cdn.com/tortilla.jpg?w=600"] }),
    );
    expect(await searchImage("tortilla dish", { apiKey: "k", fetchFn })).toBe("https://cdn.com/tortilla.jpg?w=600");
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ query: "tortilla dish", include_images: true });
  });

  it("returns null when there are no images", async () => {
    expect(await searchImage("x", { apiKey: "k", fetchFn: async () => jsonResponse({ results: [] }) })).toBeNull();
  });
});

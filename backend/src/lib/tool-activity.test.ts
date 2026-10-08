import { describe, expect, it } from "vitest";
import { queryOf, summarizeToolOutputs } from "@/lib/tool-activity";

describe("summarizeToolOutputs", () => {
  it("keeps the query and up to 5 sources for each search", () => {
    const results = Array.from({ length: 7 }, (_, i) => ({ title: `T${i}`, url: `https://s${i}.com/`, snippet: "x" }));
    expect(summarizeToolOutputs([{ toolName: "webSearch", input: { query: "kale season" }, output: { results } }])).toEqual([
      { tool: "webSearch", query: "kale season", sources: results.slice(0, 5).map(({ title, url }) => ({ title, url })) },
    ]);
  });

  it("records a failed search", () => {
    expect(
      summarizeToolOutputs([{ toolName: "webSearch", input: { query: "q" }, output: { error: "rate limit", results: [] } }]),
    ).toEqual([{ tool: "webSearch", query: "q", sources: [], error: "rate limit" }]);
  });

  it("handles tools with unknown input and output shapes", () => {
    expect(summarizeToolOutputs([{ toolName: "other", input: 42, output: "ok" }])).toEqual([{ tool: "other", sources: [] }]);
  });
});

describe("queryOf", () => {
  it("reads a query string or returns undefined", () => {
    expect(queryOf({ query: "basil" })).toBe("basil");
    expect(queryOf({})).toBeUndefined();
  });
});

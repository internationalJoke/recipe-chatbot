import { APICallError } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment, Message } from "@/generated/prisma/client";

const mockModel = { current: null as MockLanguageModelV4 | null };

vi.mock("@ai-sdk/google", () => ({ createGoogle: () => () => mockModel.current }));
vi.mock("@/lib/recipe-service", () => ({
  RecipeServiceError: class extends Error {},
  recommendRecipes: async () => [
    { recipe_id: 7, recipe_name: "Tortilla", coverage: 0.5, matched: ["egg", "potato"], missing: ["onion"], required: ["egg", "onion", "potato"] },
  ],
}));
vi.mock("@/lib/files", () => ({
  isImageMimeType: (type: string) => type.startsWith("image/"),
  isTextMimeType: (type: string) => type.startsWith("text/"),
  readUpload: async (path: string) => Buffer.from(path.endsWith(".txt") ? "2 eggs, flour" : "PIXELS"),
}));

const { asksForDishes, buildModelMessages, friendlyError, listIsRelevant, looksLikeRecipe, streamChat, TextOnlyModelError } = await import("@/lib/llm");

type Row = Message & { attachments: Attachment[] };
let seq = 0;
const attachment = (originalName: string, mimeType: string): Attachment => ({
  id: `a${++seq}`, messageId: "m", originalName, mimeType, fileSize: 1, storagePath: originalName, createdAt: new Date(),
});
const row = (role: Row["role"], content: string, attachments: Attachment[] = []): Row => ({
  id: `m${++seq}`, conversationId: "c", role, content, status: "COMPLETE", model: null, toolActivity: null, dishes: null, selectedDishIds: [], attachments, createdAt: new Date(),
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

function streamingModel(...deltas: string[]) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "text-start", id: "t" },
        ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ]),
    }),
  });
}

describe("buildModelMessages", () => {
  it("sends pixels only for the latest image message and inlines text files", async () => {
    const messages = await buildModelMessages([
      row("USER", "old photo", [attachment("old.png", "image/png")]),
      row("ASSISTANT", "That is a cake."),
      row("USER", "", [attachment("fridge.jpg", "image/jpeg"), attachment("recipe.txt", "text/plain")]),
    ]);

    expect(messages[0]).toEqual({ role: "user", content: expect.stringContaining("Earlier image \"old.png\"") });
    expect(messages[1]).toEqual({ role: "assistant", content: "That is a cake." });
    const latest = messages[2] as { content: { type: string; text?: string; mediaType?: string }[] };
    expect(latest.content[0].text).toContain("Look at the attached image");
    expect(latest.content[0].text).toContain("2 eggs, flour");
    expect(latest.content[1]).toMatchObject({ type: "image", mediaType: "image/jpeg" });
  });
});

describe("buildModelMessages with older photos", () => {
  it("sends no pixels when a text follow-up comes after a photo", async () => {
    const messages = await buildModelMessages([
      row("USER", "what is this", [attachment("dish.png", "image/png")]),
      row("ASSISTANT", "A lasagna."),
      row("USER", "who are you"),
    ]);

    expect(messages.every((message) => typeof message.content === "string")).toBe(true);
    expect(messages[0].content).toContain('Earlier image "dish.png"');
  });
});

describe("streamChat", () => {
  beforeEach(() => vi.stubEnv("GEMINI_API_KEY", "test-key"));
  afterEach(() => vi.unstubAllEnvs());

  it("streams chunks and returns the full text", async () => {
    mockModel.current = streamingModel("Hello ", "chef");
    const chunks: string[] = [];
    const reply = await streamChat([row("USER", "hi")], (chunk) => chunks.push(chunk));

    expect(chunks).toEqual(["Hello ", "chef"]);
    expect(reply).toEqual({ content: "Hello chef", model: "gemini-3.8-flash", shoppingItems: [], dishes: [], toolActivity: [] });
    const call = mockModel.current.doStreamCalls[0];
    expect(call.prompt[0]).toMatchObject({ role: "system" });
  });

  it("runs the webSearch tool, reports it, and streams the final answer", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ title: "Basil", url: "https://example.com/basil", content: "Summer herb" }] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const stream = (parts: unknown[]) => ({ stream: convertArrayToReadableStream(parts as never[]) });
    mockModel.current = new MockLanguageModelV4({
      doStream: [
        stream([
          { type: "tool-call", toolCallId: "c1", toolName: "webSearch", input: JSON.stringify({ query: "basil season" }) },
          { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
        ]),
        stream([
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Basil peaks in summer." },
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
        ]),
      ],
    });

    try {
      const tools: string[] = [];
      const reply = await streamChat([row("USER", "when is basil in season?")], () => {}, undefined, (name) => tools.push(name));

      expect(tools).toEqual(["webSearch"]);
      expect(reply.content).toBe("Basil peaks in summer.");
      expect(reply.toolActivity).toEqual([
        { tool: "webSearch", query: "basil season", sources: [{ title: "Basil", url: "https://example.com/basil" }] },
      ]);
      expect(fetchMock).toHaveBeenCalledOnce();
      const secondCall = JSON.stringify(mockModel.current.doStreamCalls[1].prompt);
      expect(secondCall).toContain("https://example.com/basil");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retries with inlined results when the model fails after a tool call", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ title: "Veg", url: "https://example.com/veg", content: "Kale in October" }] })),
    ));
    const stream = (parts: unknown[]) => ({ stream: convertArrayToReadableStream(parts as never[]) });
    let call = 0;
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => {
        call += 1;
        if (call === 1) {
          return stream([
            { type: "text-start", id: "t0" },
            { type: "text-delta", id: "t0", delta: "\n\n" },
            { type: "text-end", id: "t0" },
            { type: "tool-call", toolCallId: "c1", toolName: "webSearch", input: JSON.stringify({ query: "veg october" }) },
            { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
          ]);
        }
        if (call === 2) {
          throw new APICallError({ message: "provider_unavailable", url: "u", requestBodyValues: {}, statusCode: 502, isRetryable: false });
        }
        return stream([
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Kale is in season." },
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
        ]);
      },
    });

    try {
      const reply = await streamChat([row("USER", "veg in october?")], () => {});
      expect(reply.content.trim()).toBe("Kale is in season.");
      expect(call).toBe(3);
      const retryPrompt = JSON.stringify(mockModel.current.doStreamCalls[2].prompt);
      expect(retryPrompt).toContain("tool_results");
      expect(retryPrompt).toContain("https://example.com/veg");
      expect(mockModel.current.doStreamCalls[2].tools ?? []).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retries a mid-stream provider failure, but not a bad key", async () => {
    const providerDown = () =>
      new APICallError({ message: "provider_unavailable", url: "u", requestBodyValues: {}, statusCode: 502, isRetryable: false });
    let calls = 0;
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => {
        calls += 1;
        if (calls === 1) throw providerDown();
        return streamingModel("Fresh kale.").doStream({} as never);
      },
    });
    await expect(streamChat([row("USER", "hi")], () => {})).resolves.toMatchObject({ content: "Fresh kale." });
    expect(calls).toBe(2);

    calls = 0;
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => {
        calls += 1;
        throw new APICallError({ message: "bad key", url: "u", requestBodyValues: {}, statusCode: 401 });
      },
    });
    await expect(streamChat([row("USER", "hi")], () => {})).rejects.toThrow(/rejected the API key/);
    expect(calls).toBe(1);
  });

  it("collects items from proposeShoppingList and keeps it out of the tool chips", async () => {
    const stream = (parts: unknown[]) => ({ stream: convertArrayToReadableStream(parts as never[]) });
    const items = [{ name: "olive oil", quantity: 1, unit: "l", note: "for cooking" }];
    mockModel.current = new MockLanguageModelV4({
      doStream: [
        stream([
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Make a pasta." },
          { type: "text-end", id: "t" },
          { type: "tool-call", toolCallId: "s1", toolName: "proposeShoppingList", input: JSON.stringify({ items }) },
          { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
        ]),
        stream([{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage }]),
      ],
    });
    const statuses: string[] = [];
    const reply = await streamChat([row("USER", "What pasta can I make tonight?")], () => {}, undefined, (name) => statuses.push(name));
    expect(reply.content).toBe("Make a pasta.");
    expect(reply.shoppingItems).toEqual(items);
    expect(reply.toolActivity).toEqual([]);
    expect(statuses).toEqual(["proposeShoppingList"]);
  });

  it("retries without tools when the model's host does not support them", async () => {
    let calls = 0;
    mockModel.current = new MockLanguageModelV4({
      doStream: async (options) => {
        calls += 1;
        if (options.tools?.length) {
          throw new APICallError({
            message: "Not Found", url: "u", requestBodyValues: {}, statusCode: 404,
            data: { error: { message: "No endpoints found that support tool use" } },
          });
        }
        return streamingModel("Plain answer.").doStream({} as never);
      },
    });
    await expect(streamChat([row("USER", "hi")], () => {})).resolves.toMatchObject({ content: "Plain answer." });
    expect(calls).toBe(2);
  });

  it("forces a shopping list when a recipe answer forgot it", async () => {
    const recipe = "Roast the potatoes and carrots with onion. Chop everything, then roast for 30 minutes. ".repeat(3);
    const items = [{ name: "olive oil", quantity: 1, unit: "l" }];
    const model = streamingModel(recipe);
    model.doGenerate = async (options) => {
      expect(options.toolChoice).toEqual({ type: "required" });
      return {
        content: [{ type: "tool-call", toolCallId: "f1", toolName: "proposeShoppingList", input: JSON.stringify({ items }) }],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage,
        warnings: [],
      } as never;
    };
    mockModel.current = model;
    const statuses: string[] = [];
    const reply = await streamChat([row("USER", "dinner?")], () => {}, undefined, (name) => statuses.push(name));
    expect(reply.shoppingItems).toEqual(items);
    expect(statuses).toEqual(["proposeShoppingList"]);
  });

  it("skips the forced list for answers that are not recipes", async () => {
    const model = streamingModel("The current US president is someone. ".repeat(10));
    let generated = 0;
    model.doGenerate = async () => {
      generated += 1;
      throw new Error("should not be called");
    };
    mockModel.current = model;
    const reply = await streamChat([row("USER", "who is president?")], () => {});
    expect(reply.shoppingItems).toEqual([]);
    expect(generated).toBe(0);
  });

  it("keeps the answer when the forced list call fails", async () => {
    const model = streamingModel("Fry the onions, then simmer with tomatoes and serve with rice. ".repeat(4));
    model.doGenerate = async () => {
      throw new APICallError({ message: "down", url: "u", requestBodyValues: {}, statusCode: 502 });
    };
    mockModel.current = model;
    const reply = await streamChat([row("USER", "dinner?")], () => {});
    expect(reply.content).toContain("Fry the onions");
    expect(reply.shoppingItems).toEqual([]);
  });

  it("drops a list the model attached to small talk", async () => {
    const stream = (parts: unknown[]) => ({ stream: convertArrayToReadableStream(parts as never[]) });
    mockModel.current = new MockLanguageModelV4({
      doStream: [
        stream([
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "I'm your home-cooking assistant." },
          { type: "text-end", id: "t" },
          { type: "tool-call", toolCallId: "s1", toolName: "proposeShoppingList", input: JSON.stringify({ items: [{ name: "eggs", quantity: 6, unit: "pcs" }] }) },
          { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
        ]),
        stream([{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage }]),
      ],
    });
    const reply = await streamChat([row("USER", "who are you")], () => {});
    expect(reply.shoppingItems).toEqual([]);
  });

  it("returns dish cards and holds back the shopping list until a dish is picked", async () => {
    const stream = (parts: unknown[]) => ({ stream: convertArrayToReadableStream(parts as never[]) });
    mockModel.current = new MockLanguageModelV4({
      doStream: [
        stream([
          { type: "tool-call", toolCallId: "d1", toolName: "suggestDishes", input: JSON.stringify({ ingredients: ["egg", "potato"] }) },
          { type: "tool-call", toolCallId: "s1", toolName: "proposeShoppingList", input: JSON.stringify({ items: [{ name: "eggs", quantity: 5, unit: "pcs" }] }) },
          { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
        ]),
        stream([
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Which one would you like to make?" },
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
        ]),
      ],
    });
    const statuses: string[] = [];
    const reply = await streamChat([row("USER", "what can I cook with potatoes?")], () => {}, undefined, (name) => statuses.push(name));
    expect(reply.dishes).toEqual([expect.objectContaining({ name: "Tortilla", imageUrl: null, id: expect.any(String), recipeId: 7, missing: ["onion"] })]);
    expect(reply.shoppingItems).toEqual([]);
    expect(reply.toolActivity).toEqual([]);
    expect(statuses).toContain("suggestDishes");
  });

  it("forces suggestDishes when the user asked what to cook and the model skipped it", async () => {
    const model = streamingModel("You could make a nice tortilla with eggs and potatoes.");
    const choices: unknown[] = [];
    model.doGenerate = async (options) => {
      choices.push(options.toolChoice);
      expect(options.tools?.map((t) => t.name)).toEqual(["suggestDishes"]);
      return {
        content: [{ type: "tool-call", toolCallId: "f1", toolName: "suggestDishes", input: JSON.stringify({ ingredients: ["egg", "potato"] }) }],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage,
        warnings: [],
      } as never;
    };
    mockModel.current = model;
    const statuses: string[] = [];
    const reply = await streamChat([row("USER", "What can I cook with eggs and potatoes?")], () => {}, undefined, (name) => statuses.push(name));
    expect(choices).toEqual([{ type: "required" }]);
    expect(reply.dishes).toEqual([expect.objectContaining({ name: "Tortilla", recipeId: 7 })]);
    expect(reply.shoppingItems).toEqual([]);
    expect(statuses).toEqual(["suggestDishes"]);
  });

  it("forces suggestDishes for a photo sent without text", async () => {
    const model = streamingModel("I can see eggs and potatoes.");
    let generated = 0;
    model.doGenerate = async () => {
      generated += 1;
      return {
        content: [{ type: "tool-call", toolCallId: "f1", toolName: "suggestDishes", input: JSON.stringify({ ingredients: ["egg", "potato"] }) }],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage,
        warnings: [],
      } as never;
    };
    mockModel.current = model;
    const reply = await streamChat([row("USER", "", [attachment("fridge.jpg", "image/jpeg")])], () => {});
    expect(generated).toBe(1);
    expect(reply.dishes).toHaveLength(1);
  });

  it("does not force suggestDishes for a named dish or small talk", async () => {
    for (const text of ["Give me a recipe for lasagna", "who are you"]) {
      const model = streamingModel("Sure, here is my answer.");
      let generated = 0;
      model.doGenerate = async () => {
        generated += 1;
        throw new Error("should not be called");
      };
      mockModel.current = model;
      const reply = await streamChat([row("USER", text)], () => {});
      expect(generated).toBe(0);
      expect(reply.dishes).toEqual([]);
    }
  });

  it("keeps the answer when the forced suggestDishes call fails", async () => {
    const model = streamingModel("Try a tortilla.");
    model.doGenerate = async () => {
      throw new APICallError({ message: "down", url: "u", requestBodyValues: {}, statusCode: 502 });
    };
    mockModel.current = model;
    const reply = await streamChat([row("USER", "what should I make for dinner?")], () => {});
    expect(reply.content).toBe("Try a tortilla.");
    expect(reply.dishes).toEqual([]);
  });

  it("rejects an empty answer", async () => {
    mockModel.current = streamingModel();
    await expect(streamChat([row("USER", "hi")], () => {})).rejects.toThrow(/empty answer/);
  });

  it("turns provider errors into friendly messages", async () => {
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({ message: "bad key", url: "u", requestBodyValues: {}, statusCode: 401 });
      },
    });
    await expect(streamChat([row("USER", "hi")], () => {})).rejects.toThrow(/rejected the API key/);
  });

  it("throws TextOnlyModelError when the model rejects images", async () => {
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({
          message: "Not Found", url: "u", requestBodyValues: {}, statusCode: 404,
          data: { error: { message: "No endpoints found that support image input" } },
        });
      },
    });
    const error = await streamChat([row("USER", "hi")], () => {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TextOnlyModelError);
    expect((error as { code?: string }).code).toBe("text_only");
  });
});

describe("friendlyError", () => {
  const apiError = (statusCode: number) =>
    new APICallError({ message: "boom", url: "u", requestBodyValues: {}, statusCode });

  it("maps common HTTP statuses", () => {
    expect(friendlyError(apiError(429))).toMatch(/rate limit/);
    expect(friendlyError(apiError(500))).toBe("Model provider error: boom");
    expect(friendlyError(new Error("plain"))).toBe("plain");
  });

  it("says text only when the model rejects images", () => {
    const withData = (message: string) =>
      new APICallError({ message: "Not Found", url: "u", requestBodyValues: {}, statusCode: 404, data: { error: { message } } });
    expect(friendlyError(withData("No endpoints found that support image input"))).toBe(
      "This model supports text only. Please send a text message without images.",
    );
    expect(friendlyError(withData("model xyz does not exist"))).toBe("Model provider error: model xyz does not exist");
  });
});

describe("buildSystemPrompt", () => {
  it("includes today's date and the always-search rule", async () => {
    const { buildSystemPrompt } = await import("@/lib/prompts");
    const prompt = buildSystemPrompt(new Date("2026-10-08T12:00:00Z"));
    expect(prompt).toContain("Current date: 2026-10-08");
    expect(prompt).toMatch(/ALWAYS search/);
  });
});

describe("looksLikeRecipe", () => {
  it("needs two different cooking words in a long answer", () => {
    expect(looksLikeRecipe("Chop the onions, then roast them for 30 minutes. ".repeat(5))).toBe(true);
    expect(looksLikeRecipe("The president serves a four-year term and will serve until 2029. ".repeat(5))).toBe(false);
    expect(looksLikeRecipe("Roast. Chop.")).toBe(false);
  });
});

describe("asksForDishes", () => {
  it("is true for a photo without text or a what-to-cook question", () => {
    expect(asksForDishes("", true)).toBe(true);
    expect(asksForDishes("What can I cook tonight?", false)).toBe(true);
    expect(asksForDishes("what should we make with these?", true)).toBe(true);
    expect(asksForDishes("any dinner ideas?", false)).toBe(true);
    expect(asksForDishes("I have chicken, rice and leeks. Suggest something", false)).toBe(true);
    expect(asksForDishes("Here is what's in my fridge", true)).toBe(true);
  });

  it("is false for named dishes, questions and small talk", () => {
    expect(asksForDishes("Give me a recipe for lasagna", false)).toBe(false);
    expect(asksForDishes("How do I make this?", true)).toBe(false);
    expect(asksForDishes("dinner?", false)).toBe(false);
    expect(asksForDishes("who are you", false)).toBe(false);
    expect(asksForDishes("how long do I boil an egg?", false)).toBe(false);
  });
});

describe("listIsRelevant", () => {
  const recipe = "Chop the onions, then roast them with potatoes for 30 minutes. ".repeat(5);
  it("keeps a list for food suggestions or when the user asked for one", () => {
    expect(listIsRelevant("what can I cook tonight?", recipe)).toBe(true);
    expect(listIsRelevant("shopping list for lasagna please", "Here you go.")).toBe(true);
  });
  it("drops a list for small talk", () => {
    expect(listIsRelevant("who are you", "I'm your home-cooking assistant. Shall we pick a dish?")).toBe(false);
  });
});

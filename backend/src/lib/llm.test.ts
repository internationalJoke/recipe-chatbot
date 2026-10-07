import { APICallError } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment, Message } from "@/generated/prisma/client";

const mockModel = { current: null as MockLanguageModelV4 | null };

vi.mock("@ai-sdk/google", () => ({ createGoogle: () => () => mockModel.current }));
vi.mock("@/lib/files", () => ({
  isImageMimeType: (type: string) => type.startsWith("image/"),
  isTextMimeType: (type: string) => type.startsWith("text/"),
  readUpload: async (path: string) => Buffer.from(path.endsWith(".txt") ? "2 eggs, flour" : "PIXELS"),
}));

const { buildModelMessages, friendlyError, streamChat, TextOnlyModelError } = await import("@/lib/llm");

type Row = Message & { attachments: Attachment[] };
let seq = 0;
const attachment = (originalName: string, mimeType: string): Attachment => ({
  id: `a${++seq}`, messageId: "m", originalName, mimeType, fileSize: 1, storagePath: originalName, createdAt: new Date(),
});
const row = (role: Row["role"], content: string, attachments: Attachment[] = []): Row => ({
  id: `m${++seq}`, conversationId: "c", role, content, status: "COMPLETE", model: null, attachments, createdAt: new Date(),
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
    expect(reply).toEqual({ content: "Hello chef", model: "gemini-3.8-flash" });
    const call = mockModel.current.doStreamCalls[0];
    expect(call.prompt[0]).toMatchObject({ role: "system" });
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

import { describe, expect, it } from "vitest";
import { describeLlm, resolveLlmConfig, resolveProvider } from "@/lib/llm-config";

describe("resolveProvider", () => {
  it("uses LLM_PROVIDER when set", () => {
    expect(resolveProvider({ LLM_PROVIDER: "OpenRouter" })).toBe("openrouter");
    expect(resolveProvider({ LLM_PROVIDER: "gemini" })).toBe("gemini");
  });

  it("falls back to whichever key exists", () => {
    expect(resolveProvider({ OPENROUTER_API_KEY: "k" })).toBe("openrouter");
    expect(resolveProvider({ GEMINI_API_KEY: "k", OPENROUTER_API_KEY: "k" })).toBe("gemini");
    expect(resolveProvider({})).toBe("gemini");
  });

  it("rejects unknown providers", () => {
    expect(() => resolveProvider({ LLM_PROVIDER: "ollama" })).toThrow(/gemini.*openrouter/);
  });
});

describe("resolveLlmConfig", () => {
  it("builds the Gemini config with the default model", () => {
    expect(resolveLlmConfig({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: " g-key " })).toMatchObject({
      provider: "gemini",
      apiKey: "g-key",
      model: "gemini-3.8-flash",
    });
  });

  it("builds the OpenRouter config with a custom model and temperature", () => {
    expect(
      resolveLlmConfig({
        LLM_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "o-key",
        OPENROUTER_MODEL: "openai/gpt-4o-mini",
        LLM_TEMPERATURE: "0.2",
      }),
    ).toMatchObject({ provider: "openrouter", model: "openai/gpt-4o-mini", temperature: 0.2 });
  });

  it("throws a clear error when the key is missing", () => {
    expect(() => resolveLlmConfig({ LLM_PROVIDER: "openrouter" })).toThrow(/OPENROUTER_API_KEY is not set/);
  });

  it("ignores an invalid temperature", () => {
    expect(resolveLlmConfig({ GEMINI_API_KEY: "k", LLM_TEMPERATURE: "9" }).temperature).toBe(0.7);
  });
});

describe("describeLlm", () => {
  it("never exposes the key", () => {
    const summary = describeLlm({ GEMINI_API_KEY: "secret" });
    expect(JSON.stringify(summary)).not.toContain("secret");
    expect(summary).toMatchObject({ configured: true, provider: "gemini" });
  });

  it("reports missing configuration", () => {
    expect(describeLlm({})).toMatchObject({ configured: false, provider: "gemini" });
    expect(describeLlm({ LLM_PROVIDER: "bad" })).toMatchObject({ configured: false, provider: null });
  });
});

// Model calls go through the Vercel AI SDK (see llm.ts).
// Pick a provider with LLM_PROVIDER and export the matching API key in your terminal.

export type ProviderName = "gemini" | "openrouter";

export type LlmConfig = {
  provider: ProviderName;
  apiKey: string;
  model: string;
  temperature: number;
};

const PROVIDERS = {
  gemini: {
    keyVar: "GEMINI_API_KEY",
    modelVar: "GEMINI_MODEL",
    defaultModel: "gemini-3.8-flash",
  },
  openrouter: {
    keyVar: "OPENROUTER_API_KEY",
    modelVar: "OPENROUTER_MODEL",
    defaultModel: "dots-studio/dots-3-note-preview:free",
  },
} as const;

const DEFAULT_TEMPERATURE = 0.7;

type Env = Record<string, string | undefined>;

function read(env: Env, name: string) {
  return env[name]?.trim() ?? "";
}

export function resolveProvider(env: Env = process.env): ProviderName {
  const raw = read(env, "LLM_PROVIDER").toLowerCase();
  if (raw === "gemini" || raw === "openrouter") return raw;
  if (raw) {
    throw new Error(`LLM_PROVIDER must be "gemini" or "openrouter", got ${JSON.stringify(raw)}.`);
  }
  // No explicit choice: use whichever key is present, Gemini first.
  if (read(env, PROVIDERS.gemini.keyVar)) return "gemini";
  if (read(env, PROVIDERS.openrouter.keyVar)) return "openrouter";
  return "gemini";
}

function resolveTemperature(env: Env) {
  const raw = read(env, "LLM_TEMPERATURE");
  if (!raw) return DEFAULT_TEMPERATURE;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : DEFAULT_TEMPERATURE;
}

export function resolveLlmConfig(env: Env = process.env): LlmConfig {
  const provider = resolveProvider(env);
  const spec = PROVIDERS[provider];
  const apiKey = read(env, spec.keyVar);
  if (!apiKey) {
    throw new Error(`${spec.keyVar} is not set. Export it in your terminal before "docker compose up".`);
  }
  return {
    provider,
    apiKey,
    model: read(env, spec.modelVar) || spec.defaultModel,
    temperature: resolveTemperature(env),
  };
}

// Safe summary for the health endpoint and UI: never includes the key.
export function describeLlm(env: Env = process.env) {
  try {
    const config = resolveLlmConfig(env);
    return { provider: config.provider, model: config.model, configured: true, error: null };
  } catch (error) {
    const provider = (() => {
      try {
        return resolveProvider(env);
      } catch {
        return null;
      }
    })();
    return {
      provider,
      model: provider ? read(env, PROVIDERS[provider].modelVar) || PROVIDERS[provider].defaultModel : null,
      configured: false,
      error: error instanceof Error ? error.message : "LLM is not configured",
    };
  }
}

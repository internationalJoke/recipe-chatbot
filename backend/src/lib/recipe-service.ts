import { z } from "zod";

// Client for the recipe service (recipe-service/, FastAPI). The agreed interface:
// in: detected ingredient names, e.g. ["tomato", "egg"]; out: missing ingredient names per recipe.
const DEFAULT_URL = "http://recipe-service:8000";
const TIMEOUT_MS = 15_000;
const MIN_COVERAGE = 0.3;
const MAX_MISSING = 4;

export class RecipeServiceError extends Error {}

const recommendedSchema = z.object({
  recipe_id: z.number().int(),
  recipe_name: z.string().nullable(),
  coverage: z.number(),
  matched: z.array(z.string()),
  missing: z.array(z.string()),
  required: z.array(z.string()),
});

const recommendSchema = z.object({ recipes: z.array(recommendedSchema) });
const missingSchema = z.object({ recipe_id: z.number().int(), recipe_name: z.string().nullable(), missing: z.array(z.string()) });

export type RecommendedRecipe = z.infer<typeof recommendedSchema>;
export type MissingResult = z.infer<typeof missingSchema>;

type Env = Record<string, string | undefined>;
type Options = { env?: Env; signal?: AbortSignal; fetcher?: typeof fetch };

async function post<T>(path: string, body: unknown, schema: z.ZodType<T>, { env = process.env, signal, fetcher = fetch }: Options) {
  const baseUrl = (env.RECIPE_SERVICE_URL || DEFAULT_URL).replace(/\/+$/, "");
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RecipeServiceError(`The recipe database is not reachable (${String(error)}).`);
  }
  if (!response.ok) throw new RecipeServiceError(`The recipe database failed with status ${response.status}.`);
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new RecipeServiceError("The recipe database sent an unexpected answer.");
  return parsed.data;
}

/** Recipes that use the ingredients the user has, best match first. */
export async function recommendRecipes(ingredients: string[], topK: number, options: Options = {}) {
  const body = { available_ingredients: ingredients, top_k: topK, min_coverage: MIN_COVERAGE, max_missing_ingredients: MAX_MISSING };
  return (await post("/recommend", body, recommendSchema, options)).recipes;
}

/** What the user still needs to buy for one recipe. */
export async function missingIngredients(recipeId: number, ingredients: string[], options: Options = {}) {
  return post("/missing", { recipe_id: recipeId, available_ingredients: ingredients }, missingSchema, options);
}

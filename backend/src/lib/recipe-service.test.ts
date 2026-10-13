import { describe, expect, it, vi } from "vitest";
import { missingIngredients, recommendRecipes, RecipeServiceError } from "@/lib/recipe-service";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const env = { RECIPE_SERVICE_URL: "http://recipes:8000/" };

describe("recipe service client", () => {
  it("posts the agreed fields to /recommend", async () => {
    const recipe = { recipe_id: 1, recipe_name: "Soup", coverage: 0.5, matched: ["egg"], missing: ["miso"], required: ["egg", "miso"] };
    const fetcher = vi.fn(async () => json({ recipes: [recipe] }));
    expect(await recommendRecipes(["egg"], 3, { env, fetcher })).toEqual([recipe]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://recipes:8000/recommend");
    expect(JSON.parse(init.body as string)).toMatchObject({ available_ingredients: ["egg"], top_k: 3 });
  });

  it("posts recipe_id and available_ingredients to /missing", async () => {
    const fetcher = vi.fn(async () => json({ recipe_id: 4, recipe_name: "Soup", missing: ["butter"] }));
    expect((await missingIngredients(4, ["egg"], { env, fetcher })).missing).toEqual(["butter"]);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ recipe_id: 4, available_ingredients: ["egg"] });
  });

  it("turns HTTP errors, bad bodies, and network failures into RecipeServiceError", async () => {
    await expect(missingIngredients(4, [], { env, fetcher: async () => json({}, 404) })).rejects.toThrow(RecipeServiceError);
    await expect(recommendRecipes(["egg"], 3, { env, fetcher: async () => json({ nope: 1 }) })).rejects.toThrow(RecipeServiceError);
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(recommendRecipes(["egg"], 3, { env, fetcher: down })).rejects.toThrow(/not reachable/);
  });
});

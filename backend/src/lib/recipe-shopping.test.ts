import { describe, expect, it, vi } from "vitest";
import type { Dish } from "@/lib/dishes";
import { mergeDetails, missingForDishes, shoppingItemsForDishes } from "@/lib/recipe-shopping";

const dish = (recipeId: number, name = `Dish ${recipeId}`): Dish => ({
  id: `d${recipeId}`,
  name,
  summary: "",
  ingredients: [{ name: "egg" }],
  imageUrl: null,
  recipeId,
  available: ["egg", "onion"],
});

const lookup = vi.fn(async (recipeId: number) => ({
  recipe_id: recipeId,
  recipe_name: null,
  missing: recipeId === 1 ? ["butter", "miso"] : ["Butter", "chicken broth"],
}));

describe("missingForDishes", () => {
  it("asks the database once per recipe and removes repeats", async () => {
    expect(await missingForDishes([dish(1), dish(2)], lookup)).toEqual(["butter", "miso", "chicken broth"]);
    expect(lookup).toHaveBeenCalledWith(1, ["egg", "onion"]);
    expect(lookup).toHaveBeenCalledWith(2, ["egg", "onion"]);
  });

  it("uses the stored missing list for dishes without a recipe id", async () => {
    const old: Dish = { ...dish(3), recipeId: undefined, missing: ["salt"] };
    expect(await missingForDishes([old], lookup)).toEqual(["salt"]);
  });
});

describe("mergeDetails", () => {
  it("keeps only the database's items and fills gaps with defaults", () => {
    const details = [
      { name: "Butter", quantity: 50, unit: "g", searchTerm: "smör" },
      { name: "caviar", quantity: 1, unit: "pcs" },
    ];
    expect(mergeDetails(["butter", "miso"], details, ["Soup"])).toEqual([
      { name: "butter", quantity: 50, unit: "g", searchTerm: "smör", note: "for Soup" },
      { name: "miso", quantity: 1, unit: "pcs", note: "for Soup" },
    ]);
  });
});

describe("shoppingItemsForDishes", () => {
  it("still returns the list when the model fails", async () => {
    const failing = vi.fn(async () => {
      throw new Error("rate limit");
    });
    const items = await shoppingItemsForDishes([dish(1), dish(2)], failing, lookup);
    expect(items.map((i) => i.name)).toEqual(["butter", "miso", "chicken broth"]);
    expect(items[0]).toMatchObject({ quantity: 1, unit: "pcs", note: undefined });
  });

  it("skips the model when nothing is missing", async () => {
    const writer = vi.fn(async () => []);
    const none = vi.fn(async () => ({ recipe_id: 1, recipe_name: null, missing: [] }));
    expect(await shoppingItemsForDishes([dish(1)], writer, none)).toEqual([]);
    expect(writer).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { buildDishes, dishesFromToolOutput, dishInputSchema, dishShoppingItems, parseStoredDishes, type DishInput } from "@/lib/dishes";

const dish = (name: string): DishInput =>
  dishInputSchema.parse({ name, summary: "Tasty.", servings: 4, minutes: 30, ingredients: [{ name: "potato", quantity: 500, unit: "g" }] });

let n = 0;
const makeId = () => `d${++n}`;

describe("buildDishes", () => {
  it("adds ids and a photo per dish, looked up in parallel", async () => {
    const finder = vi.fn(async (name: string) => `https://img.com/${encodeURIComponent(name)}.jpg`);
    const dishes = await buildDishes([dish("Tortilla"), dish("Soup")], finder, undefined, makeId);
    expect(finder).toHaveBeenCalledTimes(2);
    expect(dishes.map((d) => [d.name, d.imageUrl])).toEqual([
      ["Tortilla", "https://img.com/Tortilla.jpg"],
      ["Soup", "https://img.com/Soup.jpg"],
    ]);
    expect(new Set(dishes.map((d) => d.id)).size).toBe(2);
  });

  it("keeps the dish when its photo lookup fails, and works without a finder", async () => {
    const failing = vi.fn(async () => {
      throw new Error("rate limit");
    });
    expect((await buildDishes([dish("Tortilla")], failing, undefined, makeId))[0].imageUrl).toBeNull();
    expect((await buildDishes([dish("Soup")], null, undefined, makeId))[0].imageUrl).toBeNull();
  });

  it("caps the number of dishes", async () => {
    const many = Array.from({ length: 6 }, (_, i) => dish(`Dish ${i}`));
    expect(await buildDishes(many, null, undefined, makeId)).toHaveLength(4);
  });
});

describe("dishInputSchema", () => {
  it("coerces numbers and drops bad optional fields", () => {
    const parsed = dishInputSchema.parse({ name: "Soup", summary: "Warm.", servings: "4", minutes: "abc", ingredients: [{ name: "carrot", quantity: "3" }] });
    expect(parsed).toMatchObject({ servings: 4, minutes: undefined, ingredients: [{ name: "carrot", quantity: 3 }] });
  });
});

describe("stored dishes", () => {
  it("reads valid dishes and ignores broken data", async () => {
    const dishes = await buildDishes([dish("Tortilla")], null, undefined, makeId);
    expect(parseStoredDishes(dishes)).toEqual(dishes);
    expect(dishesFromToolOutput({ dishes })).toEqual(dishes);
    expect(parseStoredDishes([{ nope: 1 }])).toEqual([]);
    expect(dishesFromToolOutput(null)).toEqual([]);
  });
});

describe("dishShoppingItems", () => {
  it("turns a dish into list items, keeping Swedish search words and 'have' flags", async () => {
    const [dish] = await buildDishes(
      [
        dishInputSchema.parse({
          name: "Tortilla",
          summary: "Eggs.",
          ingredients: [
            { name: "potatoes", quantity: 500, unit: "g", searchTerm: "potatis", have: true },
            { name: "eggs", quantity: 5, searchTerm: "ägg" },
            { name: "salt" },
          ],
        }),
      ],
      null,
      undefined,
      makeId,
    );
    expect(dishShoppingItems(dish)).toEqual([
      { name: "potatoes", quantity: 500, unit: "g", searchTerm: "potatis", have: true },
      { name: "eggs", quantity: 5, unit: "pcs", searchTerm: "ägg" },
      { name: "salt", quantity: 1, unit: "pcs" },
    ]);
  });
});

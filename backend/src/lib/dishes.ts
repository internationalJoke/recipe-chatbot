import { randomUUID } from "node:crypto";
import { z } from "zod";

// Dish suggestions shown as cards. The model proposes them with the suggestDishes tool;
// the backend adds a photo for each and the user picks one to cook.
export const MAX_DISHES = 4;
const MAX_INGREDIENTS = 25;
const MAX_STEPS = 12;

const ingredientSchema = z.object({
  name: z.string().trim().min(1).max(80),
  quantity: z.coerce.number().positive().max(10_000).optional().catch(undefined),
  unit: z.string().trim().max(20).optional().catch(undefined),
  searchTerm: z
    .string()
    .trim()
    .max(80)
    .optional()
    .catch(undefined)
    .describe('Swedish supermarket search word for Willys/Hemköp, e.g. "gul lök", "olivolja"'),
  have: z.boolean().optional().catch(undefined).describe("true if the user seems to already have it (e.g. seen in their photo)"),
});

export const dishInputSchema = z.object({
  name: z.string().trim().min(1).max(100).describe("Dish name, e.g. \"Spanish potato tortilla\""),
  summary: z.string().trim().max(240).describe("One or two sentences: what it is and why it fits"),
  servings: z.coerce.number().int().positive().max(50).optional().catch(undefined),
  minutes: z.coerce.number().int().positive().max(1_440).optional().catch(undefined).describe("Total time"),
  ingredients: z.array(ingredientSchema).min(1).max(MAX_INGREDIENTS).describe("All ingredients with amounts"),
  steps: z.array(z.string().trim().min(1).max(300)).max(MAX_STEPS).optional().catch(undefined).describe("Short steps"),
});

export type DishInput = z.infer<typeof dishInputSchema>;
export type Dish = DishInput & { id: string; imageUrl: string | null };

export type ImageFinder = (dishName: string, signal?: AbortSignal) => Promise<string | null>;

/** Adds ids and photos. Photos are looked up in parallel; a failed lookup just means no photo. */
export async function buildDishes(
  inputs: DishInput[],
  findImage: ImageFinder | null,
  signal?: AbortSignal,
  makeId: () => string = randomUUID,
): Promise<Dish[]> {
  const limited = inputs.slice(0, MAX_DISHES);
  const images = await Promise.all(
    limited.map(async (dish) => {
      if (!findImage) return null;
      try {
        return await findImage(dish.name, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        console.warn("Dish photo lookup failed:", { dish: dish.name, error: String(error) });
        return null;
      }
    }),
  );
  return limited.map((dish, index) => ({ ...dish, id: makeId(), imageUrl: images[index] }));
}

const storedDishSchema = dishInputSchema.extend({ id: z.string(), imageUrl: z.string().nullable() });

/** Reads dishes saved on a message; invalid data yields an empty list instead of an error. */
export function parseStoredDishes(value: unknown): Dish[] {
  const parsed = z.array(storedDishSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** Reads the suggestDishes tool output captured from the stream. */
export function dishesFromToolOutput(output: unknown): Dish[] {
  const dishes = (output as { dishes?: unknown } | null)?.dishes;
  return parseStoredDishes(dishes);
}

/** The chosen dish's ingredients as a shopping list. Items the user likely has start unticked. */
export function dishShoppingItems(dish: Dish): unknown[] {
  return dish.ingredients.map((ingredient) => ({
    name: ingredient.name,
    quantity: ingredient.quantity ?? 1,
    unit: ingredient.unit || "pcs",
    ...(ingredient.searchTerm ? { searchTerm: ingredient.searchTerm } : {}),
    ...(ingredient.have ? { have: true } : {}),
  }));
}

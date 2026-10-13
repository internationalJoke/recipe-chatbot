import { generateText, isStepCount } from "ai";
import type { Dish } from "@/lib/dishes";
import { createModel } from "@/lib/llm";
import { resolveLlmConfig } from "@/lib/llm-config";
import { missingIngredients } from "@/lib/recipe-service";
import { PROPOSE_SHOPPING_LIST, proposeShoppingListTool } from "@/lib/tools";

// Shopping list for the recipes the user picked. The recipe database decides WHAT to buy;
// the model adds a Swedish search word and an amount for each item, and marks items the user
// can cover with what they have (e.g. fresh tomatoes for peeled tomatoes). Those start unticked.
const DETAILS_TIMEOUT_MS = 60_000;
const DETAILS_TEMPERATURE = 0.2;

type RawItem = { name: string; quantity: number; unit: string; note?: string; searchTerm?: string; have?: boolean };
export type DetailsWriter = (names: string[], dishNames: string[], available: string[]) => Promise<unknown[]>;

/** Asks the recipe database what is missing for each picked recipe, without repeats. */
export async function missingForDishes(dishes: Dish[], lookup = missingIngredients): Promise<string[]> {
  const results = await Promise.all(
    dishes.map((dish) =>
      dish.recipeId === undefined ? { missing: dish.missing ?? [] } : lookup(dish.recipeId, dish.available ?? []),
    ),
  );
  const seen = new Set<string>();
  return results
    .flatMap((result) => result.missing)
    .filter((name) => {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Keeps the database's list as the truth: details the model gave for an item are used,
 * items it made up are dropped, and items it skipped come back with a default amount.
 */
export function mergeDetails(names: string[], details: unknown[], dishNames: string[]): RawItem[] {
  const byName = new Map<string, Partial<RawItem>>();
  for (const detail of details) {
    const name = (detail as { name?: unknown } | null)?.name;
    if (typeof name === "string") byName.set(name.trim().toLowerCase(), detail as Partial<RawItem>);
  }
  const note = dishNames.length === 1 ? `for ${dishNames[0]}` : undefined;
  return names.map((name) => {
    const detail = byName.get(name.toLowerCase());
    return {
      note,
      ...detail,
      name,
      quantity: typeof detail?.quantity === "number" ? detail.quantity : 1,
      unit: typeof detail?.unit === "string" ? detail.unit : "pcs",
    };
  });
}

/** Default details writer: one forced proposeShoppingList call on the configured model. */
export const writeDetailsWithModel: DetailsWriter = async (names, dishNames, available) => {
  const config = resolveLlmConfig();
  const result = await generateText({
    model: createModel(config),
    temperature: DETAILS_TEMPERATURE,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(DETAILS_TIMEOUT_MS),
    messages: [
      {
        role: "user",
        content:
          `I am cooking: ${dishNames.join(", ")}. I already have: ${JSON.stringify(available)}. ` +
          `The recipe database says I need to buy: ${JSON.stringify(names)}. ` +
          "Call proposeShoppingList with one entry per item. Keep each name exactly as given, add a typical " +
          "amount for the recipe, and a Swedish searchTerm as sold at Willys or Hemköp. Set have: true only " +
          "when something I already have clearly works instead, e.g. fresh tomatoes for whole peeled tomatoes; " +
          "not for a different product, e.g. tomatoes for tomato paste. Do not add other items.",
      },
    ],
    tools: { [PROPOSE_SHOPPING_LIST]: proposeShoppingListTool },
    toolChoice: "required",
    stopWhen: isStepCount(1),
  });
  const call = result.toolCalls.find((c) => c.toolName === PROPOSE_SHOPPING_LIST);
  const items = (call?.input as { items?: unknown } | undefined)?.items;
  return Array.isArray(items) ? items : [];
};

/** Missing items for the picked dishes, ready for toShoppingItems. */
export async function shoppingItemsForDishes(
  dishes: Dish[],
  writeDetails: DetailsWriter = writeDetailsWithModel,
  lookup = missingIngredients,
): Promise<RawItem[]> {
  const names = await missingForDishes(dishes, lookup);
  if (names.length === 0) return [];
  const dishNames = dishes.map((dish) => dish.name);
  const available = [...new Set(dishes.flatMap((dish) => dish.available ?? []))];
  let details: unknown[] = [];
  try {
    details = await writeDetails(names, dishNames, available);
  } catch (error) {
    // The list still works without Swedish words; prices then search the English name.
    console.warn("Could not add amounts and Swedish names to the list:", String(error));
  }
  return mergeDetails(names, details, dishNames);
}

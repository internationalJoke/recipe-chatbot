import { randomUUID } from "node:crypto";
import { z } from "zod";

// The model appends this block when the user needs to buy ingredients.
// The backend strips it from the chat text and stores it as a proposal.
export const OPEN_TAG = "<shopping_list>";
export const CLOSE_TAG = "</shopping_list>";
const MAX_ITEMS = 40;

const rawItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  quantity: z.coerce.number().positive().max(10_000).catch(1),
  unit: z.string().trim().max(20).catch("pcs").default("pcs"),
  note: z.string().trim().max(160).optional().catch(undefined),
  searchTerm: z.string().trim().min(1).max(80).optional().catch(undefined),
  have: z.boolean().optional().catch(undefined),
});

const rawListSchema = z.object({ items: z.array(z.unknown()).max(MAX_ITEMS * 2) });

export type ShoppingItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  note?: string;
  /** Swedish word to search for at Willys/Hemköp, e.g. "gul lök". */
  searchTerm?: string;
  /** The user likely has it already, so the card starts with it unticked. */
  have?: boolean;
};

export type ExtractResult = {
  text: string;
  items: ShoppingItem[] | null;
};

/** Splits the reply into user-facing text and an optional validated ingredient list. */
export function extractShoppingList(reply: string, makeId: () => string = randomUUID): ExtractResult {
  const start = reply.indexOf(OPEN_TAG);
  if (start === -1) return { text: reply.trim(), items: null };

  const end = reply.indexOf(CLOSE_TAG, start);
  const body = reply.slice(start + OPEN_TAG.length, end === -1 ? undefined : end);
  const after = end === -1 ? "" : reply.slice(end + CLOSE_TAG.length);
  const text = `${reply.slice(0, start)}${after}`.trim();

  const items = parseItems(body, makeId);
  return { text, items: items.length > 0 ? items : null };
}

function parseItems(body: string, makeId: () => string): ShoppingItem[] {
  const json = body.replace(/```(?:json)?/gi, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  const list = rawListSchema.safeParse(Array.isArray(parsed) ? { items: parsed } : parsed);
  return list.success ? toShoppingItems(list.data.items, makeId) : [];
}

/**
 * Validates raw items from the model (tool input or text block) into stored items.
 * Drops invalid entries and repeats by name, so a list proposed twice is not doubled.
 */
export function toShoppingItems(raw: unknown[], makeId: () => string = randomUUID): ShoppingItem[] {
  const seen = new Set<string>();
  return raw
    .flatMap((item) => {
      const result = rawItemSchema.safeParse(item);
      if (!result.success) return [];
      const key = result.data.name.toLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      return [result.data];
    })
    .slice(0, MAX_ITEMS)
    .map((item) => ({
      id: makeId(),
      name: item.name,
      quantity: item.quantity,
      unit: item.unit || "pcs",
      ...(item.note ? { note: item.note } : {}),
      ...(item.searchTerm ? { searchTerm: item.searchTerm } : {}),
      ...(item.have ? { have: true } : {}),
    }));
}

const storedItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.number(),
  unit: z.string(),
  note: z.string().optional(),
  searchTerm: z.string().optional(),
  have: z.boolean().optional(),
});

export function parseStoredItems(value: unknown): ShoppingItem[] {
  return z.array(storedItemSchema).parse(value);
}

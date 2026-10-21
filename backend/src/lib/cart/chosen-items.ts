import { z } from "zod";
import type { ShoppingItem } from "@/lib/shopping-list";

// The items to shop for: the ones the user left ticked at Accept, saved in the order's comparison.

const savedChoiceSchema = z.object({ items: z.array(z.object({ itemId: z.string() })).min(1) });

export function chosenItems(items: ShoppingItem[], comparison: unknown): ShoppingItem[] {
  const saved = savedChoiceSchema.safeParse(comparison);
  if (!saved.success) return items.filter((item) => !item.have);
  const wanted = new Set(saved.data.items.map((row) => row.itemId));
  return items.filter((item) => wanted.has(item.id));
}

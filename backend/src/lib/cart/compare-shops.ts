import type { ShoppingItem } from "@/lib/shopping-list";
import type { StoreProduct } from "@/lib/stores/axfood";
import { bestOffer, type Offer } from "@/lib/stores/pricing";

// Compares the list at every shop the user is logged in to, using the same pricing rules as the app.

export type ShopId = "willys" | "hemkop" | "ica";

/** Search results per shop, keyed by shopping item id. */
export type ShopResults = Partial<Record<ShopId, Record<string, StoreProduct[]>>>;

export type ShopTotal = {
  shop: ShopId;
  totalCents: number;
  missing: string[];
  picks: { item: ShoppingItem; offer: Offer }[];
};

/** One total per shop: complete shops first (cheapest first), then by fewest missing items. */
export function compareShops(items: ShoppingItem[], results: ShopResults): ShopTotal[] {
  const totals = (Object.keys(results) as ShopId[]).map((shop) => {
    const found = results[shop] ?? {};
    const picks = items.flatMap((item) => {
      const offer = bestOffer(item, found[item.id] ?? []);
      return offer ? [{ item, offer }] : [];
    });
    return {
      shop,
      totalCents: picks.reduce((sum, pick) => sum + pick.offer.costCents, 0),
      missing: items.filter((item) => !picks.some((pick) => pick.item.id === item.id)).map((item) => item.name),
      picks,
    };
  });
  return [...totals].sort((a, b) => a.missing.length - b.missing.length || (a.missing.length === 0 ? a.totalCents - b.totalCents : 0));
}

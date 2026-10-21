import { z } from "zod";
import type { ShopId, ShopTotal } from "@/lib/cart/compare-shops";
import { normalizePostcode, type Place } from "@/lib/cart/postcode";

// What the web page and the local shop helper (scripts/shop-helper.ts) send each other.

export const HELPER_PORT = 3200;

const SHOP_IDS = ["willys", "hemkop", "ica"] as const satisfies readonly ShopId[];
const SHOP_NAMES: Record<ShopId, string> = { willys: "Willys", hemkop: "Hemköp", ica: "ICA" };

export const compareRequestSchema = z.object({
  shoppingListId: z.uuid(),
  location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).nullish(),
  postcode: z
    .string()
    .nullish()
    .transform((value, ctx) => {
      if (!value?.trim()) return null;
      const postcode = normalizePostcode(value);
      if (!postcode) ctx.addIssue({ code: "custom", message: "A Swedish postcode has 5 digits" });
      return postcode;
    }),
});

export const continueRequestSchema = z.object({ skip: z.boolean().catch(false) });

export const buyRequestSchema = z.object({ shop: z.enum(SHOP_IDS) });

export type Phase = "idle" | "working" | "waiting" | "ready" | "done" | "error";

export type ShopView = {
  shop: ShopId;
  name: string;
  storeName: string | null;
  distanceKm: number | null;
  totalCents: number;
  missing: string[];
  lines: { item: string; product: string; size: string; costCents: number; url: string }[];
};

export type HelperStatus = {
  phase: Phase;
  /** The list being compared; the page shows the status only on that list. */
  shoppingListId: string | null;
  /** What is happening now, e.g. "ICA: using ICA Folkes Livs (2.0 km)". */
  message: string;
  /** Set while waiting for the user, e.g. "log in with BankID, then continue". */
  question: string | null;
  /** Where the stores were searched near, e.g. { postcode: "75230", city: "Uppsala" }. */
  area: Place | null;
  shops: ShopView[];
  cart: { shop: ShopId; added: string[]; failed: { product: string; url: string }[]; skipped: boolean } | null;
};

/** Only pages served from this computer may drive the browser. */
export function isAllowedOrigin(origin: string | undefined) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function shopViews(totals: ShopTotal[], shops: { id: ShopId; storeName: string | null; distanceKm: number | null }[]): ShopView[] {
  return totals.map((total) => {
    const shop = shops.find((s) => s.id === total.shop);
    return {
      shop: total.shop,
      name: SHOP_NAMES[total.shop],
      storeName: shop?.storeName ?? null,
      distanceKm: shop?.distanceKm ?? null,
      totalCents: total.totalCents,
      missing: total.missing,
      lines: total.picks.map(({ item, offer }) => ({
        item: capitalize(item.name),
        product: offer.product,
        size: offer.size,
        costCents: offer.costCents,
        url: offer.url,
      })),
    };
  });
}

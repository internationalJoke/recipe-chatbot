import type { ShoppingItem } from "@/lib/shopping-list";
import type { StoreProduct } from "@/lib/stores/axfood";

// Turns "500 g potatoes" + a store product into "how many packs, and what does it cost".

export type Need =
  | { kind: "mass"; grams: number }
  | { kind: "volume"; ml: number }
  | { kind: "count"; pieces: number }
  | { kind: "other" };

export type Offer = {
  code: string;
  product: string;
  url: string;
  /** Packs to buy, or kilograms for products sold by weight. */
  amount: number;
  amountLabel: string;
  /** Short weight or size to show, e.g. "≈0.16 kg", "500ml", "2 × 100g". */
  size: string;
  costCents: number;
};

const MASS: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000, hg: 100 };
const VOLUME: Record<string, number> = { ml: 1, cl: 10, dl: 100, l: 1000, liter: 1000, litre: 1000 };
const COUNT = new Set(["pcs", "pc", "st", "piece", "pieces", "clove", "cloves", "bunch", "head", "can", "pack"]);
const DEFAULT_PIECE_KG = 0.15;
const DEFAULT_LOOSE_KG = 0.5;
const MAX_PACKS = 20;
/** Only the store's most relevant results are considered, so a cheap but wrong product doesn't win. */
const CANDIDATES = 4;

export function needOf(item: Pick<ShoppingItem, "quantity" | "unit">): Need {
  const unit = item.unit.trim().toLowerCase();
  if (MASS[unit]) return { kind: "mass", grams: item.quantity * MASS[unit] };
  if (VOLUME[unit]) return { kind: "volume", ml: item.quantity * VOLUME[unit] };
  if (COUNT.has(unit)) return { kind: "count", pieces: item.quantity };
  return { kind: "other" }; // tbsp, tsp, pinch…: one pack covers it
}

/** "750ml" → 750 ml, "2kg" → 2000 g, "1,5l" → 1500 ml, "10-p" → 10 pieces. */
export function parsePackSize(display: string | null): Need {
  if (!display) return { kind: "other" };
  const text = display.toLowerCase().replace(",", ".");
  const multi = text.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|hg|g|cl|dl|ml|l)\b/);
  const single = text.match(/(\d+(?:\.\d+)?)\s*(kg|hg|g|cl|dl|ml|l)\b/);
  const pieces = text.match(/(\d+)\s*(?:-?p\b|st\b|pack\b)/);
  const [count, amount, unit] = multi
    ? [Number(multi[1]), Number(multi[2]), multi[3]]
    : single
      ? [1, Number(single[1]), single[2]]
      : [0, 0, ""];
  if (unit && MASS[unit]) return { kind: "mass", grams: count * amount * MASS[unit] };
  if (unit && VOLUME[unit]) return { kind: "volume", ml: count * amount * VOLUME[unit] };
  if (pieces) return { kind: "count", pieces: Number(pieces[1]) };
  return { kind: "other" };
}

function kilogramsNeeded(need: Need, product: StoreProduct) {
  if (need.kind === "mass") return need.grams / 1000;
  if (need.kind === "volume") return need.ml / 1000;
  if (need.kind === "count") return need.pieces * (product.averageWeightKg ?? DEFAULT_PIECE_KG);
  return product.averageWeightKg ?? DEFAULT_LOOSE_KG;
}

function packsNeeded(need: Need, pack: Need) {
  if (need.kind === "mass" && pack.kind === "mass") return Math.ceil(need.grams / pack.grams);
  if (need.kind === "volume" && pack.kind === "volume") return Math.ceil(need.ml / pack.ml);
  if (need.kind === "count" && pack.kind === "count") return Math.ceil(need.pieces / pack.pieces);
  if (need.kind === "count" && pack.kind === "other") return Math.ceil(need.pieces);
  return 1;
}

export function offerFor(item: Pick<ShoppingItem, "quantity" | "unit">, product: StoreProduct): Offer {
  const need = needOf(item);
  if (product.perKg) {
    const kg = Math.max(0.05, kilogramsNeeded(need, product));
    return {
      code: product.code,
      product: product.name,
      url: product.url,
      amount: Number(kg.toFixed(2)),
      amountLabel: `≈${kg.toFixed(2).replace(/\.?0+$/, "")} kg ${product.name}`,
      size: `≈${kg.toFixed(2).replace(/\.?0+$/, "")} kg`,
      costCents: Math.round(product.price * kg * 100),
    };
  }
  const packs = Math.min(MAX_PACKS, Math.max(1, packsNeeded(need, parsePackSize(product.displayVolume))));
  const size = product.displayVolume ? ` (${product.displayVolume})` : "";
  return {
    code: product.code,
    product: product.name,
    url: product.url,
    amount: packs,
    amountLabel: `${packs} × ${product.name}${size}`,
    size: product.displayVolume ? (packs > 1 ? `${packs} × ${product.displayVolume}` : product.displayVolume) : `${packs} st`,
    costCents: Math.round(product.price * packs * 100),
  };
}

/** Cheapest way to cover the item among the store's most relevant products. */
export function bestOffer(item: Pick<ShoppingItem, "quantity" | "unit">, products: StoreProduct[]): Offer | null {
  return products
    .slice(0, CANDIDATES)
    .map((product) => offerFor(item, product))
    .reduce<Offer | null>((best, offer) => (!best || offer.costCents < best.costCents ? offer : best), null);
}

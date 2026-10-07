import type { ShoppingItem } from "@/lib/shopping-list";
import { CATALOG, type CatalogProduct } from "@/lib/market-catalog";

// A supermarket the app can "buy" from. Only the demo store exists today;
// a real store API can implement the same interface later.
export interface Market {
  readonly name: string;
  readonly currency: string;
  findProduct(itemName: string): CatalogProduct | null;
}

export type OrderLine = {
  itemId: string;
  requested: string;
  product: string;
  packSize: string;
  packs: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type OrderQuote = {
  store: string;
  currency: string;
  lines: OrderLine[];
  missing: string[];
  totalCents: number;
};

export function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singular(word: string) {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokens(value: string) {
  return new Set(normalize(value).split(" ").filter(Boolean).map(singular));
}

// Best catalog entry whose every keyword appears in the requested name.
// "2 ripe tomatoes" matches "tomato"; "cherry tomatoes" prefers "cherry tomato".
export function matchProduct(itemName: string, catalog: readonly CatalogProduct[]): CatalogProduct | null {
  const wanted = tokens(itemName);
  let best: { product: CatalogProduct; score: number } | null = null;

  for (const product of catalog) {
    for (const keyword of [product.name, ...product.aliases]) {
      const keys = [...tokens(keyword)];
      if (keys.length === 0 || !keys.every((key) => wanted.has(key))) continue;
      if (!best || keys.length > best.score) best = { product, score: keys.length };
    }
  }
  return best?.product ?? null;
}

export const demoMarket: Market = {
  name: "Demo Fresh Market",
  currency: "EUR",
  findProduct: (itemName) => matchProduct(itemName, CATALOG),
};

// Grams/millilitres per unit, so "500 g flour" maps to one 1 kg pack.
const UNIT_TO_BASE: Record<string, number> = {
  g: 1, gram: 1, grams: 1, kg: 1000,
  ml: 1, l: 1000, liter: 1000, litre: 1000,
};

export function packsNeeded(item: ShoppingItem, product: CatalogProduct) {
  const factor = UNIT_TO_BASE[normalize(item.unit)];
  if (factor && product.packBase) {
    return Math.max(1, Math.ceil((item.quantity * factor) / product.packBase));
  }
  if (product.countable) return Math.max(1, Math.ceil(item.quantity));
  // Spoons, cloves, pinches, bunches: one pack covers a recipe.
  return 1;
}

export function quoteOrder(items: ShoppingItem[], market: Market = demoMarket): OrderQuote {
  const lines: OrderLine[] = [];
  const missing: string[] = [];

  for (const item of items) {
    const product = market.findProduct(item.name);
    if (!product) {
      missing.push(item.name);
      continue;
    }
    const packs = packsNeeded(item, product);
    lines.push({
      itemId: item.id,
      requested: `${item.quantity} ${item.unit} ${item.name}`.trim(),
      product: product.name,
      packSize: product.packSize,
      packs,
      unitPriceCents: product.priceCents,
      lineTotalCents: packs * product.priceCents,
    });
  }

  return {
    store: market.name,
    currency: market.currency,
    lines,
    missing,
    totalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
  };
}

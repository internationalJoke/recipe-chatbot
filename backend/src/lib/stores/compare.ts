import type { ShoppingItem } from "@/lib/shopping-list";
import { searchStore, searchUrl, STORE_IDS, STORES, StoreUnavailableError, type StoreId, type StoreProduct } from "@/lib/stores/axfood";
import { bestOffer, type Offer } from "@/lib/stores/pricing";

// Compares a shopping list at Willys and Hemköp and recommends the cheapest way to buy it.

export type Plan = StoreId | "mix";

export type PlanLine = {
  itemId: string;
  /** The ingredient as the model named it, e.g. "garlic". */
  name: string;
  /** Weight or pack size to buy, e.g. "≈0.16 kg" or "500ml". */
  size: string;
  requested: string;
  store: StoreId;
  storeName: string;
  product: string;
  amountLabel: string;
  lineTotalCents: number;
  url: string;
};

export type StoreSummary = { store: StoreId; name: string; totalCents: number; missing: string[]; searchUrl: string };

export type Comparison = {
  currency: "SEK";
  /** When the prices were fetched; store prices change often. */
  comparedAt: string;
  items: { itemId: string; name: string; offers: Partial<Record<StoreId, Offer>> }[];
  stores: StoreSummary[];
  mix: { totalCents: number; missing: string[]; storesUsed: StoreId[] };
  recommendation: { plan: Plan; label: string; totalCents: number; reason: string };
  lines: PlanLine[];
  missing: string[];
};

const MAX_PARALLEL = 6;

type Search = (store: StoreId, term: string, signal?: AbortSignal) => Promise<StoreProduct[]>;

const defaultSearch: Search = (store, term, signal) => searchStore(store, term, { signal });

async function inBatches<T, R>(inputs: T[], size: number, run: (input: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < inputs.length; i += size) {
    results.push(...(await Promise.all(inputs.slice(i, i + size).map(run))));
  }
  return results;
}

const termFor = (item: ShoppingItem) => item.searchTerm?.trim() || item.name;

/** The name shown on the card, in English, e.g. "Garlic". The Swedish word is only for searching. */
function displayName(item: ShoppingItem) {
  return item.name.charAt(0).toUpperCase() + item.name.slice(1);
}

function requested(item: ShoppingItem) {
  return `${item.quantity} ${item.unit} ${item.name}`.trim();
}

function line(item: ShoppingItem, store: StoreId, offer: Offer): PlanLine {
  return {
    itemId: item.id,
    name: displayName(item),
    size: offer.size,
    requested: requested(item),
    store,
    storeName: STORES[store].name,
    product: offer.product,
    amountLabel: offer.amountLabel,
    lineTotalCents: offer.costCents,
    url: offer.url,
  };
}

export async function comparePrices(
  items: ShoppingItem[],
  options: { search?: Search; signal?: AbortSignal; now?: () => Date } = {},
): Promise<Comparison> {
  const search = options.search ?? defaultSearch;
  const jobs = items.flatMap((item) => STORE_IDS.map((store) => ({ item, store })));
  let failures = 0;

  const found = await inBatches(jobs, MAX_PARALLEL, async ({ item, store }) => {
    try {
      return { item, store, offer: bestOffer(item, await search(store, termFor(item), options.signal)) };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      failures += 1;
      console.warn("Store search failed:", { store, term: termFor(item), error: String(error) });
      return { item, store, offer: null };
    }
  });
  if (jobs.length > 0 && failures === jobs.length) {
    throw new StoreUnavailableError("Could not reach Willys or Hemköp. Please try again in a moment.");
  }

  const offersByItem = new Map<string, Partial<Record<StoreId, Offer>>>();
  for (const { item, store, offer } of found) {
    const offers = offersByItem.get(item.id) ?? {};
    if (offer) offers[store] = offer;
    offersByItem.set(item.id, offers);
  }

  const stores: StoreSummary[] = STORE_IDS.map((store) => ({
    store,
    name: STORES[store].name,
    totalCents: items.reduce((sum, item) => sum + (offersByItem.get(item.id)?.[store]?.costCents ?? 0), 0),
    missing: items.filter((item) => !offersByItem.get(item.id)?.[store]).map((item) => item.name),
    searchUrl: searchUrl(store, ""),
  }));

  // Mix: for each item, the cheapest store that has it.
  const mixLines: PlanLine[] = [];
  const mixMissing: string[] = [];
  for (const item of items) {
    const offers = offersByItem.get(item.id) ?? {};
    const cheapest = STORE_IDS.filter((store) => offers[store]).sort((a, b) => offers[a]!.costCents - offers[b]!.costCents)[0];
    if (cheapest) mixLines.push(line(item, cheapest, offers[cheapest]!));
    else mixMissing.push(item.name);
  }
  const mixTotal = mixLines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const storesUsed = [...new Set(mixLines.map((l) => l.store))];

  // Rule: each item from the store where it is cheapest; if only one store has it, from that store.
  const recommendation = {
    plan: (storesUsed.length === 1 ? storesUsed[0] : "mix") as Plan,
    label: storesUsed.map((s) => STORES[s].name).join(" + ") || "No store",
    totalCents: mixTotal,
    reason:
      storesUsed.length > 1
        ? "Each item from the store where it is cheapest."
        : storesUsed.length === 1
          ? `${STORES[storesUsed[0]].name} is cheapest for everything on the list.`
          : "Neither store has these items.",
  };

  return {
    currency: "SEK",
    comparedAt: (options.now ?? (() => new Date()))().toISOString(),
    items: items.map((item) => ({ itemId: item.id, name: displayName(item), offers: offersByItem.get(item.id) ?? {} })),
    stores,
    mix: { totalCents: mixTotal, missing: mixMissing, storesUsed },
    recommendation,
    lines: mixLines,
    missing: mixMissing,
  };
}

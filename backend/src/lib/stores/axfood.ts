import { z } from "zod";

// Willys and Hemköp (both Axfood) share one web platform with a public JSON product search.
// It is not an official API: it can change without notice, so every field is validated.
export type StoreId = "willys" | "hemkop";

// Logos: public-domain wordmarks from Wikimedia Commons, same 5:1 shape so they match.
export const STORES: Record<StoreId, { name: string; baseUrl: string; logoUrl: string }> = {
  willys: {
    name: "Willys",
    baseUrl: "https://www.willys.se",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/5/58/Willys_logo.svg",
  },
  hemkop: {
    name: "Hemköp",
    baseUrl: "https://www.hemkop.se",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/c/ce/Hemkop_logo.svg",
  },
};

export const STORE_IDS = Object.keys(STORES) as StoreId[];

export type StoreProduct = {
  code: string;
  name: string;
  /** Price per piece/pack, or per kg when `perKg` is true. */
  price: number;
  perKg: boolean;
  displayVolume: string | null;
  averageWeightKg: number | null;
  url: string;
};

const SEARCH_TIMEOUT_MS = 12_000;
const RESULTS_PER_SEARCH = 8;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;

const productSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  priceValue: z.number().positive(),
  priceUnit: z.string().catch(""),
  displayVolume: z.string().nullish().catch(null),
  averageWeight: z.number().positive().nullish().catch(null),
  outOfStock: z.boolean().catch(false),
  online: z.boolean().catch(true),
});

const searchResponseSchema = z.object({ results: z.array(z.unknown()).catch([]) });

export class StoreUnavailableError extends Error {}

function slug(name: string) {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function productUrl(store: StoreId, name: string, code: string) {
  return `${STORES[store].baseUrl}/produkt/${slug(name)}-${encodeURIComponent(code)}`;
}

export function searchUrl(store: StoreId, term: string) {
  return `${STORES[store].baseUrl}/sok?q=${encodeURIComponent(term)}`;
}

export function parseProducts(store: StoreId, data: unknown): StoreProduct[] {
  const { results } = searchResponseSchema.parse(data ?? {});
  return results.flatMap((raw) => {
    const parsed = productSchema.safeParse(raw);
    if (!parsed.success || parsed.data.outOfStock || !parsed.data.online) return [];
    const p = parsed.data;
    return [{
      code: p.code,
      name: p.name,
      price: p.priceValue,
      perKg: /kg/i.test(p.priceUnit),
      displayVolume: p.displayVolume ?? null,
      averageWeightKg: p.averageWeight ?? null,
      url: productUrl(store, p.name, p.code),
    }];
  });
}

const cache = new Map<string, { at: number; products: StoreProduct[] }>();

/** Searches one store. Results are cached for an hour to stay polite and fast. */
export async function searchStore(
  store: StoreId,
  term: string,
  options: { signal?: AbortSignal; fetchFn?: typeof fetch; now?: () => number } = {},
): Promise<StoreProduct[]> {
  const query = term.trim().toLowerCase().slice(0, 80);
  const key = `${store}:${query}`;
  const now = options.now ?? Date.now;
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_TTL_MS) return hit.products;

  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const url = `${STORES[store].baseUrl}/search?q=${encodeURIComponent(query)}&size=${RESULTS_PER_SEARCH}`;

  let response: Response;
  try {
    response = await (options.fetchFn ?? fetch)(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (RecipeBox price check)" },
      signal,
    });
  } catch (error) {
    throw new StoreUnavailableError(`${STORES[store].name} did not respond: ${String(error)}`);
  }
  if (!response.ok) throw new StoreUnavailableError(`${STORES[store].name} search failed with HTTP ${response.status}`);

  const products = parseProducts(store, await response.json().catch(() => null));
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: now(), products });
  return products;
}

export function clearStoreCache() {
  cache.clear();
}

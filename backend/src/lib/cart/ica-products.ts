import type { StoreProduct } from "@/lib/stores/axfood";

// ICA's online shop has no public API. Its search page loads products as JSON, and the shape is
// not documented, so this walks every JSON response and keeps anything that looks like a product.

const MAX_RESULTS = 8;
const MAX_DEPTH = 12;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;

function toNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".").replace(/[^\d.]/g, "") || NaN) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Price as a number, wherever ICA puts it: 12.5, "12,50", { amount }, { current: { amount } }. */
function priceOf(raw: Json): number | null {
  const price = raw.price ?? raw.currentPrice;
  if (!isObject(price)) return toNumber(price);
  const current = isObject(price.current) ? price.current.amount : undefined;
  return toNumber(current ?? price.amount ?? price.value);
}

function textOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isObject(value) && typeof value.value === "string" && value.value.trim()) return value.value.trim();
  return null;
}

/** "0.35kg", or { value: "0.3", uom: "KG" } → "0.3kg". */
function sizeOf(value: unknown): string | null {
  const text = textOf(value);
  const unit = isObject(value) && typeof value.uom === "string" ? value.uom.toLowerCase() : "";
  return text && unit && !text.toLowerCase().endsWith(unit) ? `${text}${unit}` : text;
}

function toProduct(raw: Json, storeUrl: string): StoreProduct | null {
  const id = raw.retailerProductId ?? raw.productId ?? raw.id ?? raw.sku;
  const name = textOf(raw.name);
  const price = priceOf(raw);
  if ((typeof id !== "string" && typeof id !== "number") || !name || price === null || raw.available === false) return null;

  const displayVolume = sizeOf(raw.size) ?? textOf(raw.packSize);
  const unit = [raw.priceUnit, isObject(raw.price) ? raw.price.unit : undefined, raw.unit]
    .map((u) => (isObject(u) ? textOf(u.label) : textOf(u)))
    .find(Boolean);
  return {
    code: String(id),
    name,
    price,
    perKg: !displayVolume && /kg/i.test(unit ?? ""),
    displayVolume,
    averageWeightKg: null,
    url: `${storeUrl}/search?q=${encodeURIComponent(name)}`,
  };
}

function collect(value: unknown, storeUrl: string, found: Map<string, StoreProduct>, depth = 0) {
  if (depth > MAX_DEPTH || found.size >= MAX_RESULTS || !isObject(value)) return;
  const product = Array.isArray(value) ? null : toProduct(value, storeUrl);
  if (product) {
    if (!found.has(product.code)) found.set(product.code, product);
    return;
  }
  for (const child of Object.values(value)) collect(child, storeUrl, found, depth + 1);
}

/** Products from the JSON bodies the ICA search page loaded, in the order the page listed them. */
export function parseIcaProducts(bodies: unknown[], storeUrl: string): StoreProduct[] {
  const found = new Map<string, StoreProduct>();
  for (const body of bodies) collect(body, storeUrl, found);
  return [...found.values()].slice(0, MAX_RESULTS);
}

const STATE_MARKER = /window\.__INITIAL_STATE__\s*=\s*/;

type IcaState = {
  data?: {
    products?: { productEntities?: Record<string, unknown> };
    search?: { catalogue?: { data?: { productGroups?: { products?: string[] }[] } } };
  };
};

/** Search results from the HTML ICA sends, in the order ICA lists them. */
export function icaProductsFromHtml(html: string, storeUrl: string): StoreProduct[] {
  const marker = STATE_MARKER.exec(html);
  if (!marker) return [];
  const start = marker.index + marker[0].length;
  const end = html.indexOf("</script>", start);
  const json = html.slice(start, end === -1 ? undefined : end).trim().replace(/;$/, "");
  let state: IcaState;
  try {
    state = JSON.parse(json);
  } catch {
    return [];
  }
  const entities = state.data?.products?.productEntities ?? {};
  const ids = (state.data?.search?.catalogue?.data?.productGroups ?? []).flatMap((group) => group.products ?? []);
  const ordered = ids.length > 0 ? ids.map((id) => entities[id]).filter(Boolean) : Object.values(entities);
  return parseIcaProducts([ordered], storeUrl);
}

/** ICA's bot check ("Human Verification") instead of the page asked for. */
export function isHumanCheck(html: string) {
  return /<title>\s*Human Verification\s*<\/title>/i.test(html);
}

/** ICA's first "did you mean" search when nothing was found, e.g. "/stores/1003975/search?q=svartpeppar". */
export function icaSuggestion(html: string): string | null {
  const list = html.indexOf('data-test="suggestion-search-list"');
  if (list === -1) return null;
  const href = /href="([^"]*\/search\?q=[^"]+)"/.exec(html.slice(list))?.[1];
  return href ? href.replace(/&amp;/g, "&") : null;
}

/** How many of a product (ICA's productId, a UUID) are in the cart from `/api/cart/v1/carts/active`. */
export function icaCartQuantity(cart: unknown, productId: string): number {
  const items = (cart as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return 0;
  const line = items.find((item: { productId?: unknown } | null) => item?.productId === productId) as { quantity?: unknown } | undefined;
  return typeof line?.quantity === "number" ? line.quantity : 0;
}

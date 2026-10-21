import type { Page } from "playwright";
import { parseProducts, STORES, type StoreId, type StoreProduct } from "@/lib/stores/axfood";
import { nearestBranches, type Branch, type Location } from "@/lib/stores/branches";
import { isAxfoodCustomer } from "@/lib/cart/sessions";
import type { Offer } from "@/lib/stores/pricing";

// Willys and Hemköp, driven from inside the user's tab, so prices and cart are theirs.

const RESULTS_PER_SEARCH = 8;
const CANDIDATES = 3; // some nearby stores have no online shop, so try a few

export function openAxfood(page: Page, store: StoreId) {
  return page.goto(STORES[store].baseUrl);
}

/** Asks the site whether this browser's session belongs to a logged-in customer. */
export async function axfoodLoggedIn(page: Page, store: StoreId) {
  const response = await page.context().request.get(`${STORES[store].baseUrl}/axfood/rest/customer`, { headers: { Accept: "application/json" } });
  return response.ok() && isAxfoodCustomer(await response.json().catch(() => null));
}

/** Makes this tab use one store's prices, like picking it on the site. Same calls as session.ts. */
async function activateStore(page: Page, storeId: string) {
  return page.evaluate(async (storeId) => {
    const token = await (await fetch("/axfood/rest/csrf-token", { headers: { Accept: "application/json" } })).json();
    await fetch(`/axfood/rest/v2/store/activate?storeId=${encodeURIComponent(storeId)}&activelySelected=true`, {
      method: "POST",
      headers: { "X-CSRF-Token": String(token) },
    });
    const active = await (await fetch("/axfood/rest/v2/store/active", { headers: { Accept: "application/json" } })).json();
    return active?.storeId === storeId;
  }, storeId).catch(() => false);
}

/** Picks the nearest store with online prices. Returns null to keep the site's default store. */
export async function chooseNearestAxfood(page: Page, store: StoreId, location: Location): Promise<Branch | null> {
  const branches = await nearestBranches(store, location, CANDIDATES).catch(() => []);
  for (const branch of branches) {
    if (await activateStore(page, branch.id)) return branch;
  }
  return null;
}

export async function searchAxfood(page: Page, store: StoreId, term: string): Promise<StoreProduct[]> {
  const data = await page.evaluate(async ({ term, size }) => {
    const response = await fetch(`/search?q=${encodeURIComponent(term)}&size=${size}`, { headers: { Accept: "application/json" } });
    return response.ok ? response.json() : null;
  }, { term: term.trim().toLowerCase(), size: RESULTS_PER_SEARCH });
  return parseProducts(store, data);
}

/** Adds through the site's own cart endpoint. Loose produce sold per piece falls back to 1 piece. */
export async function addAxfood(page: Page, offer: Offer) {
  const byWeight = offer.size.startsWith("≈"); // pricing.ts marks products sold by weight this way
  const attempts = byWeight
    ? [{ qty: offer.amount, pickUnit: "kilogram" }, { qty: 1, pickUnit: "pieces" }]
    : [{ qty: offer.amount, pickUnit: "pieces" }];
  for (const attempt of attempts) {
    const ok = await page.evaluate(async ({ code, qty, pickUnit }) => {
      const token = await (await fetch("/axfood/rest/csrf-token", { headers: { Accept: "application/json" } })).json();
      const response = await fetch("/axfood/rest/cart/addProducts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": String(token) },
        body: JSON.stringify({ products: [{ productCodePost: code, qty, pickUnit }] }),
      });
      return response.ok;
    }, { code: offer.code, ...attempt }).catch(() => false);
    if (ok) return true;
  }
  return false;
}

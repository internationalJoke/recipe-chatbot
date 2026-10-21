import { chromium, type BrowserContext, type Page } from "playwright";
import { compareShops, type ShopId, type ShopResults, type ShopTotal } from "@/lib/cart/compare-shops";
import { savedLocationFromToday } from "@/lib/cart/saved-location";
import { parseStoredItems, type ShoppingItem } from "@/lib/shopping-list";
import type { StoreId, StoreProduct } from "@/lib/stores/axfood";
import type { Location } from "@/lib/stores/branches";
import { addAxfood, axfoodLoggedIn, chooseNearestAxfood, openAxfood, searchAxfood } from "./axfood-tab";
import { acceptCookies, loginWithBankId, say } from "./browser";
import { addIca, chooseNearestIca, findIcaStore, ICA_START_URL, icaLoggedIn, searchIca } from "./ica-tab";

// The shopping flow shared by the terminal script (shop.ts) and the web page's helper (shop-helper.ts):
// open the three shops at the stores nearest the user, compare the list, fill one cart.

process.env.DATABASE_URL ??= "postgresql://chatbot:chatbot@localhost:5434/recipe_chat?schema=public";

const PROFILE_DIR = ".cart-profile"; // keeps cookies and logins between runs
const LOCATION_TIMEOUT_MS = 10_000;
export const SHOP_NAMES: Record<ShopId, string> = { willys: "Willys", hemkop: "Hemköp", ica: "ICA" };

/** A tab that can search and add to its cart. Willys and Hemköp show prices without a login. */
export type Shop = {
  id: ShopId;
  page: Page;
  loggedIn: boolean;
  /** The store whose prices are used, e.g. "Willys Uppsala Stenhagen"; null = the site's default. */
  storeName: string | null;
  distanceKm: number | null;
  /** Asks the store's server whether this browser is logged in. */
  isLoggedIn: () => Promise<boolean>;
  search: (term: string) => Promise<StoreProduct[]>;
  add: (pick: ShopTotal["picks"][number]) => Promise<boolean>;
};

export type CartResult = {
  added: string[];
  failed: { product: string; url: string }[];
  skipped: boolean;
  /** Why nothing was added, when skipped. */
  reason?: string;
};

export const termFor = (item: ShoppingItem) => item.searchTerm?.trim() || item.name;

/** The list's items, and the rough location the web app saved if the user accepted it today. */
export async function loadList(shoppingListId?: string): Promise<{ items: ShoppingItem[]; near: Location | null }> {
  // Imported here so DATABASE_URL is set before the client is created.
  const { prisma } = await import("@/lib/prisma");
  const include = { order: { select: { comparison: true, createdAt: true } } } as const;
  const list = shoppingListId
    ? await prisma.shoppingList.findUnique({ where: { id: shoppingListId }, include })
    : await prisma.shoppingList.findFirst({ orderBy: { createdAt: "desc" }, include });
  if (!list) throw new Error(shoppingListId ? `No shopping list ${shoppingListId}` : "No shopping lists yet: ask the chatbot for a recipe first");
  const items = parseStoredItems(list.items).filter((item) => !item.have);
  if (items.length === 0) throw new Error("The shopping list is empty");
  return { items, near: savedLocationFromToday(list.order) };
}

export async function launchBrowser(): Promise<BrowserContext> {
  // BankID needs a visible browser. ICA's captcha does not work with Google Translate on.
  const options = { headless: false, locale: "sv-SE", args: ["--disable-features=Translate", "--lang=sv-SE"] };
  return chromium
    .launchPersistentContext(PROFILE_DIR, { ...options, channel: "chrome" })
    .catch(() => chromium.launchPersistentContext(PROFILE_DIR, options));
}

/** Asks Chrome for the user's location, like the web app does. Null if Chrome cannot tell. */
export async function browserLocation(context: BrowserContext): Promise<Location | null> {
  const page = await context.newPage();
  try {
    await page.goto(ICA_START_URL, { waitUntil: "domcontentloaded" }); // geolocation needs an https page
    await context.grantPermissions(["geolocation"]);
    return await page.evaluate((timeout) => new Promise<Location | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
        () => resolve(null),
        { timeout },
      );
    }), LOCATION_TIMEOUT_MS);
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

/** ICA needs a login first, then a store. Its store list also tells us roughly where the user is. */
async function openIca(context: BrowserContext, postcode: string | null, user: Location | null): Promise<{ shop: Shop | null; location: Location | null }> {
  const page = await context.newPage();
  await page.goto(ICA_START_URL);
  await acceptCookies(page);
  const login = await loginWithBankId(page, SHOP_NAMES.ica, () => icaLoggedIn(page));
  if (!login.loggedIn) {
    say(`${login.reason} ICA is left out of the comparison.`);
    return { shop: null, location: null };
  }

  const nearest = postcode ? await chooseNearestIca(page, postcode, user).catch(() => null) : null;
  if (postcode && !nearest) say("ICA: could not pick the nearest store by itself.");
  const storeUrl = nearest?.url ?? (await findIcaStore(page));
  if (!storeUrl) {
    say("ICA: could not find a store's online shop, so ICA is skipped.");
    return { shop: null, location: null };
  }
  const distance = nearest?.distanceKm != null ? ` (${nearest.distanceKm.toFixed(1)} km)` : "";
  say(`ICA: using ${nearest?.name ?? storeUrl}${distance}`);
  const shop: Shop = {
    id: "ica", page, loggedIn: true, storeName: nearest?.name ?? null, distanceKm: nearest?.distanceKm ?? null,
    isLoggedIn: () => icaLoggedIn(page),
    search: (term) => searchIca(page, storeUrl, term), add: ({ offer }) => addIca(page, storeUrl, offer),
  };
  return { shop, location: nearest?.location ?? null };
}

/** Willys and Hemköp show prices without a login; the user logs in only if they pick this shop. */
async function openAxfoodShop(context: BrowserContext, id: StoreId, location: Location | null): Promise<Shop> {
  const page = await context.newPage();
  await openAxfood(page, id);
  await acceptCookies(page);
  const branch = location ? await chooseNearestAxfood(page, id, location) : null;
  say(`${SHOP_NAMES[id]}: using ${branch ? `${branch.name} (${branch.distanceKm.toFixed(1)} km)` : "the site's default store"}`);
  return {
    id, page, loggedIn: false, storeName: branch?.name ?? null, distanceKm: branch?.distanceKm ?? null,
    isLoggedIn: () => axfoodLoggedIn(page, id),
    search: (term) => searchAxfood(page, id, term), add: ({ offer }) => addAxfood(page, offer),
  };
}

/** One location for all three chains: each picks its store closest to it. */
export async function openShops(context: BrowserContext, postcode: string | null, located: Location | null): Promise<Shop[]> {
  const ica = await openIca(context, postcode, located);
  const location = located ?? ica.location; // if the postcode lookup failed, ICA's store stands in
  const axfood: Shop[] = [];
  for (const id of ["willys", "hemkop"] as const) axfood.push(await openAxfoodShop(context, id, location));
  return [...axfood, ...(ica.shop ? [ica.shop] : [])];
}

async function searchAll(shops: Shop[], items: ShoppingItem[]): Promise<ShopResults> {
  // One search at a time per tab; the tabs search in parallel.
  const entries = await Promise.all(shops.map(async (shop) => {
    const found: Record<string, StoreProduct[]> = {};
    for (const item of items) {
      found[item.id] = await shop.search(termFor(item)).catch((error) => {
        say(`${SHOP_NAMES[shop.id]}: search for "${termFor(item)}" failed: ${String(error)}`);
        return [];
      });
    }
    return [shop.id, found] as const;
  }));
  return Object.fromEntries(entries);
}

export async function comparePrices(shops: Shop[], items: ShoppingItem[]) {
  say("Comparing prices…");
  return compareShops(items, await searchAll(shops, items));
}

/** Logs in if needed and adds the picks to the shop's cart. Never orders or pays. */
export async function fillCart(shop: Shop, total: ShopTotal): Promise<CartResult> {
  await shop.page.bringToFront();
  if (!shop.loggedIn) {
    const login = await loginWithBankId(shop.page, SHOP_NAMES[shop.id], shop.isLoggedIn);
    if (!login.loggedIn) return { added: [], failed: [], skipped: true, reason: login.reason };
    shop.loggedIn = true;
  }
  const added: string[] = [];
  const failed: CartResult["failed"] = [];
  for (const pick of total.picks) {
    const ok = await shop.add(pick).catch(() => false);
    say(`${ok ? "Added" : "Could not add"}: ${pick.offer.amountLabel}`);
    if (ok) added.push(pick.offer.amountLabel);
    else failed.push({ product: pick.offer.product, url: pick.offer.url });
  }
  await shop.page.reload(); // so the cart badge shows the new items
  return { added, failed, skipped: false };
}

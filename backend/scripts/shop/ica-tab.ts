import { mkdir, writeFile } from "node:fs/promises";
import type { Page } from "playwright";
import { icaCartQuantity, icaProductsFromHtml, icaSuggestion, isHumanCheck } from "@/lib/cart/ica-products";
import { nearestPickupStore, parsePickupStores } from "@/lib/cart/ica-stores";
import { icaPageLoggedIn } from "@/lib/cart/sessions";
import type { StoreProduct } from "@/lib/stores/axfood";
import type { Location } from "@/lib/stores/branches";
import type { Offer } from "@/lib/stores/pricing";
import { acceptCookies, ask, clickFirstVisible, say } from "./browser";

// ICA has no usable API from outside, so this drives its online shop page like a person would.

export const ICA_START_URL = "https://www.ica.se";
const STORE_URL = /https:\/\/handlaprivatkund\.ica\.se\/stores\/\d+/;
const PAGE_TIMEOUT_MS = 15_000;
const DEBUG_DIR = ".cart-debug";
const MANUAL_ATTEMPTS = 3;
const SEARCH_PAUSE_MS = 1_500;
const CHECK_POLL_MS = 1_500;
const CART_UPDATE_MS = 1_200;

const CHOOSE_STORE_URL = "https://www.ica.se/produkt/?chooseEcomStore=true";
const STORE_LIST_API = "handla.ica.se/api/store/v1";
const SESSION_CHECK_URL = "https://www.ica.se/produkt/";

/** ICA writes the session into its pages, so ask its server for one with this browser's cookies. */
export async function icaLoggedIn(page: Page) {
  const response = await page.context().request.get(SESSION_CHECK_URL);
  return response.ok() && icaPageLoggedIn(await response.text());
}

export type IcaStore = { url: string; name: string | null; distanceKm: number | null; location: Location | null };

/** Types the postcode into ICA's store picker and picks the pickup store closest to the user. */
export async function chooseNearestIca(page: Page, postcode: string, user: Location | null): Promise<IcaStore | null> {
  const storeList = page.waitForResponse((r) => r.url().includes(STORE_LIST_API), { timeout: PAGE_TIMEOUT_MS }).catch(() => null);
  await page.goto(CHOOSE_STORE_URL, { waitUntil: "domcontentloaded" });
  await acceptCookies(page);
  const zip = page.getByRole("textbox").or(page.locator("input[inputmode=numeric]")).first();
  await zip.fill(postcode, { timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);
  if (!(await clickFirstVisible([page.getByRole("button", { name: /hämta i butik/i })]))) return null;

  const nearest = nearestPickupStore(parsePickupStores(await (await storeList)?.json().catch(() => null)), user);
  const choose = page.locator("[role=dialog] a, dialog a").filter({ hasText: /^\s*välj butik\s*$/i });
  const link = nearest ? page.locator(`a[aria-label="Välj butik ${nearest.name.replace(/"/g, '\\"')}"]`) : choose;
  if (!(await clickFirstVisible([link, choose]))) return null;

  await page.waitForURL(STORE_URL, { timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);
  const url = page.url().match(STORE_URL)?.[0];
  return url ? { url, name: nearest?.name ?? null, distanceKm: nearest?.distanceKm ?? null, location: nearest?.location ?? null } : null;
}

/** Goes to "Handla online" and returns the URL of the user's ICA store, e.g. …/stores/1003380. */
export async function findIcaStore(page: Page): Promise<string | null> {
  if (!STORE_URL.test(page.url())) {
    await clickFirstVisible([
      page.getByRole("link", { name: /handla online/i }),
      page.getByRole("button", { name: /handla online/i }),
    ]);
    await page.waitForURL(STORE_URL, { timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);
  }
  // ICA may open the shop in a new tab, so look at every tab.
  const findInTabs = () => page.context().pages().map((tab) => tab.url().match(STORE_URL)?.[0]).find(Boolean) ?? null;
  for (let attempt = 0; attempt < MANUAL_ATTEMPTS && !findInTabs(); attempt++) {
    const answer = await ask(
      "ICA: in the ICA tab click \"Välj butik\", type your postcode, click \"Hämta i butik\" and \"Välj butik\" on a store. " +
      "When the address starts with handlaprivatkund.ica.se/stores/, continue (or skip ICA)",
    );
    if (answer.toLowerCase() === "skip") return null;
  }
  return findInTabs();
}

/** Opens a search page and returns the HTML ICA sent. Pauses for the user when ICA shows its captcha. */
async function openSearch(page: Page, url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    await page.waitForTimeout(SEARCH_PAUSE_MS); // many quick searches trigger ICA's bot check
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    const html = (await response?.text().catch(() => "")) ?? "";
    if (!isHumanCheck(html) || attempt >= MANUAL_ATTEMPTS) return html;
    await waitForHumanCheck(page);
  }
}

/** True once the tab has left ICA's "Human Verification" page: the puzzle reloads the page when solved. */
async function humanCheckSolved(page: Page) {
  const title = await page.title().catch(() => "");
  const loaded = await page.evaluate(() => document.readyState === "complete").catch(() => false);
  return loaded && title !== "" && !/human verification/i.test(title);
}

/** Waits for the user to solve the puzzle: goes on by itself when it is solved, or when they continue. */
async function waitForHumanCheck(page: Page) {
  await page.bringToFront().catch(() => undefined);
  const stop = new AbortController();
  void (async () => {
    while (!stop.signal.aborted) {
      await page.waitForTimeout(CHECK_POLL_MS).catch(() => undefined);
      if (await humanCheckSolved(page)) stop.abort(); // closes the question
    }
  })();
  await ask("ICA wants a security check: solve the puzzle in the ICA tab. This continues by itself once it is solved.", stop.signal);
  if (stop.signal.aborted) say("ICA: security check passed.");
  stop.abort();
}

/** Searches the store; with no results, tries ICA's first suggestion (e.g. "svartpepparkorn" → "svartpeppar"). */
export async function searchIca(page: Page, storeUrl: string, term: string): Promise<StoreProduct[]> {
  let html = await openSearch(page, `${storeUrl}/search?q=${encodeURIComponent(term)}`);
  let products = icaProductsFromHtml(html, storeUrl);
  const suggestion = products.length === 0 ? icaSuggestion(html) : null;
  if (suggestion) {
    html = await openSearch(page, new URL(suggestion, storeUrl).href);
    products = icaProductsFromHtml(html, storeUrl);
  }
  if (products.length === 0) await saveDebug(term, html);
  return products;
}

/** Saves the page, so the reader can be fixed if ICA's format changes. */
async function saveDebug(term: string, html: string) {
  const name = term.replace(/[^\p{L}\d]+/gu, "-");
  await mkdir(DEBUG_DIR, { recursive: true });
  await writeFile(`${DEBUG_DIR}/ica-${name}.html`, html);
  say(`  ICA found nothing for "${term}": saved the page to ${DEBUG_DIR}/ica-${name}.html`);
}

/** How many of the product are in the user's ICA cart, from ICA's own cart data. */
async function quantityInCart(page: Page, storeUrl: string, productId: string) {
  const cart = await page.evaluate(async (url) => {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    return response.ok ? response.json() : null;
  }, `${new URL(storeUrl).pathname}/api/cart/v1/carts/active`).catch(() => null);
  return icaCartQuantity(cart, productId);
}

/**
 * Puts the offer in the cart: finds the product's card, adds only what the cart is still missing
 * (it may be there from an earlier run), and checks the result against ICA's cart.
 */
export async function addIca(page: Page, storeUrl: string, offer: Offer) {
  await openSearch(page, offer.url);
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);
  const card = page.locator("[data-test^='fop-wrapper:']").filter({ hasText: offer.product }).first();
  const productId = (await card.getAttribute("data-test", { timeout: PAGE_TIMEOUT_MS }).catch(() => null))?.split(":")[1];
  if (!productId) return false;

  const wanted = offer.size.startsWith("≈") ? 1 : Math.max(1, Math.round(offer.amount)); // by weight: one piece
  let have = await quantityInCart(page, storeUrl, productId);
  if (have >= wanted) {
    say(`ICA: ${offer.product} is already in the cart.`);
    return true;
  }
  if (have === 0) {
    await clickFirstVisible([card.getByRole("button", { name: `Lägg till ${offer.product} i varukorg`, exact: true })]);
    await page.waitForTimeout(CART_UPDATE_MS);
    have = await quantityInCart(page, storeUrl, productId);
  }
  for (let tries = 0; have > 0 && have < wanted && tries < wanted; tries++) {
    if (!(await clickFirstVisible([card.getByRole("button", { name: /(öka|plus|\+)/i })], 3_000))) break;
    await page.waitForTimeout(CART_UPDATE_MS);
    have = await quantityInCart(page, storeUrl, productId);
  }
  return have >= wanted;
}

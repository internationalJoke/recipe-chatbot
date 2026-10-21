/**
 * Compares the shopping list at Willys, Hemköp and ICA, then fills the cart at the shop you pick.
 * It never orders or pays: you check the cart yourself. BankID: ICA first, the others only if picked.
 * Runs on your own computer: BankID needs a visible browser and a person.
 * The web page does the same through `npm run shop:helper` (see shop-helper.ts).
 *
 * Setup (once):   npm install && npx playwright install chromium   (skipped if Google Chrome is installed)
 * Run:            npm run shop                    (the newest shopping list)
 *                 npm run shop -- <shoppingListId>
 *
 * The database must be reachable: `docker compose up database` exposes it on localhost:5434.
 */
import "dotenv/config";
import type { ShopTotal } from "@/lib/cart/compare-shops";
import { locatePostcode, normalizePostcode, postcodeAt } from "@/lib/cart/postcode";
import { ask } from "./shop/browser";
import { browserLocation, comparePrices, fillCart, launchBrowser, loadList, openShops, SHOP_NAMES } from "./shop/session";

const kr = (cents: number) => `${(cents / 100).toFixed(2)} kr`;

/** Suggests the postcode where the user is; they can confirm it or type another. */
async function askPostcode(suggested: string | null): Promise<string | null> {
  const prompt = suggested
    ? `Your location is postcode ${suggested}. Press Enter to use it, or type another postcode: `
    : "Your postcode, to use the nearest stores (Enter = skip): ";
  for (;;) {
    const answer = await ask(prompt);
    if (answer === "") return suggested;
    const postcode = normalizePostcode(answer);
    if (postcode) return postcode;
    console.log(`"${answer}" is not a Swedish postcode (5 digits). Try again.`);
  }
}

function printTable(totals: ShopTotal[], itemCount: number) {
  console.log("\nPrices for your list:");
  totals.forEach((total, i) => {
    const missing = total.missing.length ? `, missing: ${total.missing.join(", ")}` : "";
    console.log(`  ${i + 1}. ${SHOP_NAMES[total.shop].padEnd(7)} ${kr(total.totalCents).padStart(11)}  (${total.picks.length}/${itemCount} items${missing})`);
  });
}

async function pickShop(totals: ShopTotal[]) {
  const answer = await ask(`Which shop do you want to order from? 1-${totals.length} (Enter = 1): `);
  const index = answer === "" ? 0 : Number(answer) - 1;
  if (!Number.isInteger(index) || !totals[index]) throw new Error(`"${answer}" is not one of the shops`);
  return totals[index];
}

async function main() {
  const { items, near } = await loadList(process.argv[2]);
  console.log(`Shopping list: ${items.map((item) => item.name).join(", ")}`);
  const context = await launchBrowser();

  // The location from the web app's Accept comes first; otherwise ask Chrome, like the app does.
  if (near) console.log("Using the location the web app got when you accepted the list today.");
  const here = near ?? (await browserLocation(context));
  if (!here) console.log("No location: accept the list in the web app, or allow Chrome under macOS Location Services.");
  const herePostcode = here ? await postcodeAt(here) : null;
  const postcode = await askPostcode(herePostcode);
  const located = postcode === herePostcode && here ? here : postcode ? await locatePostcode(postcode) : null;

  const shops = await openShops(context, postcode, located);
  const totals = await comparePrices(shops, items);
  printTable(totals, items.length);

  const chosen = await pickShop(totals);
  const result = await fillCart(shops.find((shop) => shop.id === chosen.shop)!, chosen);
  if (result.skipped) console.log(result.reason ?? "Skipped: nothing was added.");
  if (result.failed.length > 0) console.log(`\nAdd these by hand:\n  ${result.failed.map((f) => `${f.product}: ${f.url}`).join("\n  ")}`);
  if (!result.skipped) console.log(`\n${SHOP_NAMES[chosen.shop]}: the items are in your cart. Nothing was ordered.`);

  console.log("Check the cart in the browser. Close the browser window when you are done.");
  await new Promise<void>((resolve) => context.on("close", () => resolve()));
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

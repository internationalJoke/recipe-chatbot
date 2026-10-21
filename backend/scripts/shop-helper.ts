/**
 * Local helper for the web page's Prices tab: compares the list at Willys, Hemköp and ICA in a visible
 * Chrome window (BankID needs one) and fills the cart at the shop the user picks. Never orders or pays.
 * It runs on your own computer next to Docker, because a container cannot open a window on your screen.
 *
 * Run:  npm run shop:helper     (keep it running; the web page talks to http://localhost:3200)
 *
 * The database must be reachable: `docker compose up` exposes it on localhost:5434.
 */
import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { BrowserContext } from "playwright";
import type { ZodType } from "zod";
import type { ShopId, ShopTotal } from "@/lib/cart/compare-shops";
import {
  buyRequestSchema,
  compareRequestSchema,
  continueRequestSchema,
  HELPER_PORT,
  isAllowedOrigin,
  shopViews,
  type HelperStatus,
} from "@/lib/cart/helper-protocol";
import { locatePostcode, postcodeAt } from "@/lib/cart/postcode";
import { say, setUserChannel } from "./shop/browser";
import { comparePrices, fillCart, launchBrowser, loadList, openShops, SHOP_NAMES, type Shop } from "./shop/session";

const MAX_BODY_BYTES = 10_000;

let status: HelperStatus = { phase: "idle", shoppingListId: null, message: "Ready.", question: null, shops: [], cart: null };
let context: BrowserContext | null = null;
let session: { shops: Shop[]; totals: ShopTotal[] } = { shops: [], totals: [] };
let answer: ((skip: boolean) => void) | null = null;

const update = (patch: Partial<HelperStatus>) => {
  status = { ...status, ...patch };
};

// Progress and questions go to the web page (and the terminal, for debugging).
setUserChannel({
  reporter: (message) => {
    console.log(message);
    update({ message });
  },
  prompter: (question, signal) => new Promise((resolve) => {
    console.log(`Waiting for the user: ${question}`);
    update({ phase: "waiting", question });
    answer = (skip) => {
      answer = null;
      update({ phase: "working", question: null });
      resolve(skip ? "skip" : "");
    };
    // Answered some other way, e.g. the login was detected: the question goes away.
    signal?.addEventListener("abort", () => answer?.(false), { once: true });
  }),
});

async function browser() {
  if (context) return context;
  const opened = await launchBrowser();
  opened.on("close", () => {
    context = null;
    session = { shops: [], totals: [] };
  });
  context = opened;
  return opened;
}

function fail(error: unknown) {
  const tabClosed = /closed|Target page/i.test(String(error));
  const message = !context
    ? "The Chrome window was closed. Start again."
    : tabClosed ? "A shop tab was closed while it was working. Click the button again." : error instanceof Error ? error.message : String(error);
  console.error("Shop helper failed:", error);
  answer = null;
  update({ phase: "error", message, question: null });
}

async function runCompare(request: ReturnType<typeof compareRequestSchema.parse>) {
  update({ phase: "working", shoppingListId: request.shoppingListId, message: "Opening the shops…", question: null, shops: [], cart: null });
  try {
    const { items, near } = await loadList(request.shoppingListId);
    // A typed postcode wins; otherwise the page's location, then the one saved at Accept today.
    const here = request.location ?? near;
    const postcode = request.postcode ?? (here ? await postcodeAt(here) : null);
    const located = request.postcode ? await locatePostcode(request.postcode) : here;
    say(postcode ? `Finding the stores nearest postcode ${postcode}…` : "No location: using the shops' default stores.");

    const opened = await browser();
    await Promise.all(session.shops.map((shop) => shop.close()));
    const shops = await openShops(opened, postcode, located);
    const totals = await comparePrices(shops, items);
    session = { shops, totals };
    update({ phase: "ready", message: "Prices are ready. Pick a shop.", shops: shopViews(totals, shops) });
  } catch (error) {
    fail(error);
  }
}

async function runBuy(shopId: ShopId) {
  const shop = session.shops.find((s) => s.id === shopId);
  const total = session.totals.find((t) => t.shop === shopId);
  if (!shop || !total) return update({ phase: "error", message: "Compare prices first." });
  if (total.missing.length > 0) return update({ message: `${SHOP_NAMES[shopId]} does not have ${total.missing.join(", ")}. Pick a shop with every item.` });
  if (status.cart && !status.cart.skipped) return update({ message: `The list is already in your ${SHOP_NAMES[status.cart.shop]} cart. Compare again to start over.` });
  update({ phase: "working", message: `Filling your ${SHOP_NAMES[shopId]} cart…`, cart: null });
  try {
    const result = await fillCart(shop, total);
    const message = result.skipped ? (result.reason ?? "Skipped: nothing was added.") : `The items are in your ${SHOP_NAMES[shopId]} cart. Nothing was ordered.`;
    update({ phase: "done", message, cart: { shop: shopId, ...result } });
  } catch (error) {
    fail(error);
  }
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage, schema: ZodType<T>): Promise<T | null> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) return null;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(raw || "{}"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const busy = () => status.phase === "working" || status.phase === "waiting";

async function route(req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (req.method === "GET" && path === "/status") return send(res, 200, status);

  if (req.method === "POST" && path === "/compare") {
    if (busy()) return send(res, 409, { error: "Already working. Finish the current step first." });
    const request = await readJson(req, compareRequestSchema);
    if (!request) return send(res, 400, { error: "Send a shopping list id, and optionally a location or a 5-digit postcode." });
    void runCompare(request);
    return send(res, 202, status);
  }
  if (req.method === "POST" && path === "/continue") {
    const request = await readJson(req, continueRequestSchema);
    if (!answer || !request) return send(res, 409, { error: "Nothing is waiting for you." });
    answer(request.skip);
    return send(res, 200, status);
  }
  if (req.method === "POST" && path === "/buy") {
    if (busy()) return send(res, 409, { error: "Already working. Finish the current step first." });
    const request = await readJson(req, buyRequestSchema);
    if (!request) return send(res, 400, { error: "Pick willys, hemkop or ica." });
    void runBuy(request.shop);
    return send(res, 202, status);
  }
  return send(res, 404, { error: "Not found" });
}

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  // Only pages served from this computer may drive the browser; other websites are refused.
  if (origin && !isAllowedOrigin(origin)) return send(res, 403, { error: "Origin not allowed" });
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  if (req.method === "POST" && !origin) return send(res, 403, { error: "Use the web page" });
  route(req, res).catch((error) => {
    console.error("Request failed:", error);
    send(res, 500, { error: "Something went wrong in the shop helper" });
  });
});

server.listen(HELPER_PORT, "127.0.0.1", () => {
  console.log(`Shop helper ready on http://localhost:${HELPER_PORT}. Use the Prices tab in the web app.`);
});

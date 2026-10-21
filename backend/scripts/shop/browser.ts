import { createInterface } from "node:readline/promises";
import type { Locator, Page } from "playwright";
import { loginScreen } from "@/lib/cart/sessions";

// Small helpers shared by the shop tabs. Sites change their buttons, so each step tries a few locators.

const STEP_TIMEOUT_MS = 5_000;
const COOKIE_TIMEOUT_MS = 4_000;

export async function clickFirstVisible(locators: Locator[], timeout = STEP_TIMEOUT_MS) {
  for (const locator of locators) {
    try {
      await locator.first().waitFor({ state: "visible", timeout });
      await locator.first().click();
      return true;
    } catch {
      // try the next one
    }
  }
  return false;
}

export async function acceptCookies(page: Page) {
  await clickFirstVisible([
    page.getByRole("button", { name: /(godkänn|acceptera|tillåt)/i }),
    page.locator("#onetrust-accept-btn-handler"),
  ], COOKIE_TIMEOUT_MS); // fine if no banner shows up
}

/**
 * Asks the user something and waits for the answer: in the terminal, or on the web page (shop-helper.ts).
 * When `signal` aborts (the answer was detected some other way), the question goes away and "" is returned.
 */
export type Prompter = (question: string, signal?: AbortSignal) => Promise<string>;
/** Tells the user what is happening. */
export type Reporter = (message: string) => void;

const terminalPrompter: Prompter = async (question, signal) => {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    // Questions that already say how to answer end with ": "; the others wait to continue or skip.
    const hint = question.endsWith(": ") ? "" : " — press Enter (or type skip): ";
    return (await prompt.question(`\n${question}${hint}`, { signal: signal ?? new AbortController().signal })).trim();
  } catch (error) {
    if (signal?.aborted) return "";
    throw error;
  } finally {
    prompt.close();
  }
};

let prompter: Prompter = terminalPrompter;
let reporter: Reporter = (message) => console.log(message);

export function setUserChannel(channel: { prompter: Prompter; reporter: Reporter }) {
  prompter = channel.prompter;
  reporter = channel.reporter;
}

export const ask: Prompter = (question, signal) => prompter(question, signal);
export const say: Reporter = (message) => reporter(message);

const LOGIN_BUTTON = /^logga in$/i;
const LOGIN_POLL_MS = 1_500;
const CLOSED_POLLS = 3;

/** Asks the store's server whether the session is logged in. */
export type SessionCheck = () => Promise<boolean>;

/** How a login ended: logged in, the store has no account for this BankID, or the user backed out. */
type LoginOutcome = "in" | "no-account" | "cancelled" | "stopped";
export type LoginResult = { loggedIn: true } | { loggedIn: false; reason: string };

/**
 * Watches the tab until the store's server says the session is logged in, the store says there is no
 * account, or the login page goes away without a login (cancelled; also when the tab is closed).
 * "stopped" when `signal` aborts first.
 */
async function watchLogin(page: Page, isLoggedIn: SessionCheck, signal: AbortSignal): Promise<LoginOutcome> {
  let seenLogin = false;
  let closedPolls = 0;
  while (!signal.aborted) {
    if (page.isClosed()) return "cancelled";
    if (await isLoggedIn().catch(() => false)) return "in";
    const text = await page.locator("body").innerText({ timeout: LOGIN_POLL_MS }).catch(() => "");
    const screen = loginScreen(page.url(), text);
    if (screen === "no-account") return "no-account";
    if (screen === "open") {
      seenLogin = true;
      closedPolls = 0;
    } else if (seenLogin && ++closedPolls >= CLOSED_POLLS) {
      return "cancelled"; // a few polls of grace: a finished login also lands on a normal page
    }
    await page.waitForTimeout(LOGIN_POLL_MS).catch(() => undefined);
  }
  return "stopped";
}

function loginFailure(shopName: string, outcome: LoginOutcome | "skipped"): LoginResult {
  const reasons: Record<string, string> = {
    "no-account": `${shopName}: this BankID has no ${shopName} account. Create one on ${shopName}'s site, or pick another shop.`,
    cancelled: `${shopName}: the login was cancelled, so nothing was added.`,
  };
  return { loggedIn: false, reason: reasons[outcome] ?? `${shopName}: login skipped, so nothing was added.` };
}

/**
 * Logs in with BankID. Skips the question when the saved session is still logged in, and goes on
 * by itself once the store's server says the login worked, or once the store says no account /
 * the user cancels. The user can still continue or skip by hand.
 */
export async function loginWithBankId(page: Page, shopName: string, isLoggedIn: SessionCheck): Promise<LoginResult> {
  if (await isLoggedIn().catch(() => false)) {
    say(`${shopName}: already logged in.`);
    return { loggedIn: true };
  }
  const opened = await clickFirstVisible([
    page.getByRole("button", { name: LOGIN_BUTTON }),
    page.getByRole("link", { name: LOGIN_BUTTON }),
  ]);
  if (opened) await clickFirstVisible([page.getByRole("button", { name: /bankid/i }), page.getByText(/bankid/i)]);
  else say(`${shopName}: click "Logga in" (top right) yourself and choose BankID.`);

  const stop = new AbortController();
  const watched = watchLogin(page, isLoggedIn, stop.signal).then((outcome) => {
    if (outcome !== "stopped") stop.abort(); // closes the question
    return outcome;
  });
  const answer = await ask(`${shopName}: log in with BankID in its tab. This continues by itself once you are in.`, stop.signal);
  const detected = stop.signal.aborted;
  stop.abort(); // if the user answered first, stop watching
  const outcome = await watched;
  if (detected && outcome === "in") {
    say(`${shopName}: logged in.`);
    return { loggedIn: true };
  }
  if (detected) return loginFailure(shopName, outcome);
  return answer.toLowerCase() === "skip" ? loginFailure(shopName, "skipped") : { loggedIn: true };
}

import { isHumanCheck } from "@/lib/cart/ica-products";

// Whether the user is logged in, as the store's own server sees the session (not what the tab shows).

/** Willys / Hemköp `/axfood/rest/customer`: `uid` is "anonymous" until the user logs in. */
export function isAxfoodCustomer(data: unknown): boolean {
  const uid = (data as { uid?: unknown } | null)?.uid;
  return typeof uid === "string" && uid !== "" && uid !== "anonymous";
}

/** ICA renders the session into its pages: "Logga in" when logged out, the user's name otherwise. */
export function icaPageLoggedIn(html: string): boolean {
  if (!html.includes("ICA") || isHumanCheck(html)) return false;
  return !/Logga in/i.test(html);
}

const LOGIN_URL = /inlogg|login|authn?\b|authenticate|bankid/i;
const NO_ACCOUNT = /inget konto hittades|du har inte ett konto/i;

/**
 * What the login tab shows while the user logs in: the store saying this BankID has no account,
 * a login page still open, or a normal page again (the user cancelled, or the login finished).
 */
export function loginScreen(url: string, text: string): "no-account" | "open" | "closed" {
  if (NO_ACCOUNT.test(text)) return "no-account";
  return LOGIN_URL.test(url) ? "open" : "closed";
}

import { STORES, type StoreId } from "@/lib/stores/axfood";

// A website session with one store chosen, so product searches return that store's prices.
// The site needs a session cookie and a CSRF token to change the store. Not an official API.

const SESSION_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const HEADERS = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (RecipeBox price check)" };

type Session = { at: number; cookie: string };
const sessions = new Map<string, Session>();

/** Keeps the name=value part of each Set-Cookie header; later cookies replace earlier ones. */
export function mergeCookies(jar: Map<string, string>, response: Response) {
  for (const header of response.headers.getSetCookie?.() ?? []) {
    const pair = header.split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

const cookieHeader = (jar: Map<string, string>) => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

/**
 * Opens a session with the store activated and returns its Cookie header, or null when the
 * site would not activate that store (e.g. it has no online shop).
 */
export async function storeSessionCookie(
  store: StoreId,
  branchId: string,
  options: { fetchFn?: typeof fetch; now?: () => number } = {},
): Promise<string | null> {
  const key = `${store}:${branchId}`;
  const now = (options.now ?? Date.now)();
  const hit = sessions.get(key);
  if (hit && now - hit.at < SESSION_TTL_MS) return hit.cookie;

  const fetchFn = options.fetchFn ?? fetch;
  const base = STORES[store].baseUrl;
  const jar = new Map<string, string>();
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetchFn(base + path, {
      ...init,
      headers: { ...HEADERS, ...(init.headers ?? {}), Cookie: cookieHeader(jar) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    mergeCookies(jar, response);
    return response;
  };

  await call("/");
  const token = await (await call("/axfood/rest/csrf-token")).json().catch(() => null);
  if (typeof token !== "string") return null;
  const activated = await call(`/axfood/rest/v2/store/activate?storeId=${encodeURIComponent(branchId)}&activelySelected=true`, {
    method: "POST",
    headers: { "X-CSRF-Token": token },
  });
  if (!activated.ok) return null;
  const active = await (await call("/axfood/rest/v2/store/active")).json().catch(() => null);
  if ((active as { storeId?: unknown } | null)?.storeId !== branchId) return null;

  const cookie = cookieHeader(jar);
  sessions.set(key, { at: now, cookie });
  return cookie;
}

export function clearSessionCache() {
  sessions.clear();
}

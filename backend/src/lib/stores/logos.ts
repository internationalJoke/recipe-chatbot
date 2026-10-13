import { prisma } from "@/lib/prisma";
import { STORES, type StoreId } from "@/lib/stores/axfood";

// Logos are downloaded once, saved in Postgres, and refreshed now and then.
// If a refresh fails, the saved copy keeps working.
export const LOGO_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const LOGO_MAX_BYTES = 200 * 1024;
const LOGO_TIMEOUT_MS = 10_000;
const LOGO_TYPES = new Set(["image/png", "image/svg+xml", "image/jpeg", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"]);

export type Logo = { mimeType: string; data: Uint8Array };

type LogoRow = { mimeType: string; data: Uint8Array; fetchedAt: Date; sourceUrl: string };

export type LogoStore = {
  find(store: StoreId): Promise<LogoRow | null>;
  save(store: StoreId, logo: Logo, sourceUrl: string): Promise<void>;
};

const prismaLogoStore: LogoStore = {
  find: (store) => prisma.storeLogo.findUnique({ where: { store }, select: { mimeType: true, data: true, fetchedAt: true, sourceUrl: true } }),
  save: async (store, logo, sourceUrl) => {
    const data = { mimeType: logo.mimeType, data: Buffer.from(logo.data), sourceUrl, fetchedAt: new Date() };
    await prisma.storeLogo.upsert({ where: { store }, create: { store, ...data }, update: data });
  },
};

export async function downloadLogo(url: string, fetchFn: typeof fetch = fetch): Promise<Logo> {
  const response = await fetchFn(url, {
    headers: { "User-Agent": "RecipeBox/1.0 (course project; store logos)" },
    signal: AbortSignal.timeout(LOGO_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Logo download failed with HTTP ${response.status}`);
  const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!LOGO_TYPES.has(mimeType)) throw new Error(`Unexpected logo type: ${mimeType || "unknown"}`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength === 0 || data.byteLength > LOGO_MAX_BYTES) throw new Error(`Logo size not allowed: ${data.byteLength} bytes`);
  return { mimeType, data };
}

/** Returns the saved logo, downloading it first if missing, older than 30 days, or from an old source URL. */
export async function getStoreLogo(
  store: StoreId,
  options: { db?: LogoStore; fetchFn?: typeof fetch; now?: () => number } = {},
): Promise<Logo | null> {
  const db = options.db ?? prismaLogoStore;
  const now = options.now ?? Date.now;
  const saved = await db.find(store);
  const sameSource = saved?.sourceUrl === STORES[store].logoUrl;
  if (saved && sameSource && now() - saved.fetchedAt.getTime() < LOGO_MAX_AGE_MS) return saved;

  try {
    const logo = await downloadLogo(STORES[store].logoUrl, options.fetchFn);
    await db.save(store, logo, STORES[store].logoUrl);
    return logo;
  } catch (error) {
    console.warn("Could not refresh store logo; using the saved copy if any:", { store, error: String(error) });
    return saved;
  }
}

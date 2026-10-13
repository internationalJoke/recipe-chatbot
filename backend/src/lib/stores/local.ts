import { nearestBranches, type Branch, type Location } from "@/lib/stores/branches";
import { STORE_IDS, type StoreId } from "@/lib/stores/axfood";
import { storeSessionCookie } from "@/lib/stores/session";

// For each chain, the nearest store whose prices the website will show. Some stores (no online
// shop) cannot be chosen on the site, so the next nearest ones are tried.

export type LocalStore = { branch: Branch; cookie: string };
export type LocalStores = Partial<Record<StoreId, LocalStore>>;

const CANDIDATES = 3;

async function nearestUsable(store: StoreId, location: Location): Promise<LocalStore | null> {
  for (const branch of await nearestBranches(store, location, CANDIDATES)) {
    const cookie = await storeSessionCookie(store, branch.id);
    if (cookie) return { branch, cookie };
  }
  return null;
}

/** Nearest usable store per chain. A chain that fails falls back to its default prices. */
export async function findLocalStores(location: Location): Promise<LocalStores> {
  const found = await Promise.all(
    STORE_IDS.map(async (store) => {
      try {
        return [store, await nearestUsable(store, location)] as const;
      } catch (error) {
        console.warn("Could not pick a nearby store; using default prices:", { store, error: String(error) });
        return [store, null] as const;
      }
    }),
  );
  return Object.fromEntries(found.filter(([, local]) => local)) as LocalStores;
}

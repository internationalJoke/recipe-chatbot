import { z } from "zod";
import { STORES, type StoreId } from "@/lib/stores/axfood";

// Physical stores of each chain, and the ones closest to the user.
// Willys has the same prices everywhere; Hemköp stores (many are franchises) set their own.

export type Location = { lat: number; lon: number };
export type Branch = { id: string; name: string; town: string | null; distanceKm: number };

type BranchSite = { id: string; name: string; town: string | null; lat: number; lon: number };

const LIST_TIMEOUT_MS = 12_000;
const LIST_TTL_MS = 24 * 60 * 60 * 1000;
const EARTH_RADIUS_KM = 6371;

const branchSchema = z.object({
  storeId: z.string().min(1),
  name: z.string().min(1),
  geoPoint: z.object({ latitude: z.number(), longitude: z.number() }),
  address: z.object({ town: z.string().nullish() }).nullish(),
});

const lists = new Map<StoreId, { at: number; sites: BranchSite[] }>();

export function distanceKm(a: Location, b: Location) {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function parseBranches(data: unknown): BranchSite[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw) => {
    const parsed = branchSchema.safeParse(raw);
    if (!parsed.success) return [];
    const { storeId, name, geoPoint, address } = parsed.data;
    return [{ id: storeId, name: name.trim(), town: address?.town ?? null, lat: geoPoint.latitude, lon: geoPoint.longitude }];
  });
}

async function listBranches(store: StoreId, fetchFn: typeof fetch, now: number): Promise<BranchSite[]> {
  const hit = lists.get(store);
  if (hit && now - hit.at < LIST_TTL_MS) return hit.sites;
  const response = await fetchFn(`${STORES[store].baseUrl}/axfood/rest/store?online=false`, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (RecipeBox price check)" },
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${STORES[store].name} store list failed with HTTP ${response.status}`);
  const sites = parseBranches(await response.json().catch(() => null));
  lists.set(store, { at: now, sites });
  return sites;
}

/** The chain's stores nearest to the user, closest first. */
export async function nearestBranches(
  store: StoreId,
  location: Location,
  count: number,
  options: { fetchFn?: typeof fetch; now?: () => number } = {},
): Promise<Branch[]> {
  const sites = await listBranches(store, options.fetchFn ?? fetch, (options.now ?? Date.now)());
  return sites
    .map((site) => ({ id: site.id, name: site.name, town: site.town, distanceKm: distanceKm(location, site) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, count);
}

export function clearBranchCache() {
  lists.clear();
}

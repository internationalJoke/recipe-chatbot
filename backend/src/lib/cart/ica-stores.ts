import { distanceKm, type Location } from "@/lib/stores/branches";

// ICA's stores with pickup for a postcode, and the one closest to the user,
// so ICA is chosen by the same rule as Willys and Hemköp: shortest distance.

export type PickupStore = { name: string; location: Location | null };

/** The `forPickupDelivery` list from ICA's store lookup (handla.ica.se/api/store/v1?zip=…). */
export function parsePickupStores(data: unknown): PickupStore[] {
  const list = (data as { forPickupDelivery?: unknown } | null)?.forPickupDelivery;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw: { name?: unknown; latitude?: unknown; longitude?: unknown } | null) => {
    if (typeof raw?.name !== "string") return [];
    const lat = Number(raw.latitude);
    const lon = Number(raw.longitude);
    const known = raw.latitude != null && raw.longitude != null && Number.isFinite(lat) && Number.isFinite(lon);
    return [{ name: raw.name, location: known ? { lat, lon } : null }];
  });
}

/** Closest store to the user; without a location, ICA's own first choice. */
export function nearestPickupStore(stores: PickupStore[], user: Location | null) {
  const measured = stores.map((store) => ({
    ...store,
    distanceKm: user && store.location ? distanceKm(user, store.location) : null,
  }));
  if (!user) return measured[0] ?? null;
  const withDistance = measured.filter((store) => store.distanceKm !== null);
  return withDistance.sort((a, b) => a.distanceKm! - b.distanceKm!)[0] ?? measured[0] ?? null;
}

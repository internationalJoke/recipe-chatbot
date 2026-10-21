import { describe, expect, it } from "vitest";
import { nearestPickupStore, parsePickupStores } from "@/lib/cart/ica-stores";

const store = (name: string, latitude: unknown, longitude: unknown) => ({ name, latitude, longitude });

describe("parsePickupStores", () => {
  it("reads ICA's pickup stores with coordinates", () => {
    const data = { forPickupDelivery: [store("ICA A", "59.33", "18.06"), store("ICA B", 59.4, 18.1), store("No coords", null, null), { nope: 1 }] };
    expect(parsePickupStores(data)).toEqual([
      { name: "ICA A", location: { lat: 59.33, lon: 18.06 } },
      { name: "ICA B", location: { lat: 59.4, lon: 18.1 } },
      { name: "No coords", location: null },
    ]);
  });

  it("returns nothing for other shapes", () => {
    expect(parsePickupStores(null)).toEqual([]);
    expect(parsePickupStores({ forPickupDelivery: "x" })).toEqual([]);
  });
});

describe("nearestPickupStore", () => {
  const stores = [
    { name: "Far", location: { lat: 59.4, lon: 18.2 } },
    { name: "Near", location: { lat: 59.331, lon: 18.061 } },
    { name: "Unknown", location: null },
  ];

  it("picks the store closest to the user, with its distance", () => {
    const nearest = nearestPickupStore(stores, { lat: 59.33, lon: 18.06 });
    expect(nearest?.name).toBe("Near");
    expect(nearest?.distanceKm).toBeLessThan(1);
  });

  it("keeps ICA's order when the user's location is unknown", () => {
    expect(nearestPickupStore(stores, null)).toMatchObject({ name: "Far", distanceKm: null });
    expect(nearestPickupStore([], null)).toBeNull();
  });
});

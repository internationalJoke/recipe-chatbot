import { describe, expect, it } from "vitest";
import { savedLocationFromToday } from "@/lib/cart/saved-location";

const comparison = { near: { lat: 59.86, lon: 17.64 } };
const now = new Date(2026, 9, 21, 15, 0); // 21 Oct, afternoon, local time

describe("savedLocationFromToday", () => {
  it("uses the location saved with an order accepted today", () => {
    expect(savedLocationFromToday({ comparison, createdAt: new Date(2026, 9, 21, 0, 5) }, now)).toEqual({ lat: 59.86, lon: 17.64 });
  });

  it("ignores a location from an earlier day", () => {
    expect(savedLocationFromToday({ comparison, createdAt: new Date(2026, 9, 20, 23, 55) }, now)).toBeNull();
  });

  it("returns null without an order or a saved location", () => {
    expect(savedLocationFromToday(null, now)).toBeNull();
    expect(savedLocationFromToday({ comparison: { stores: [] }, createdAt: now }, now)).toBeNull();
    expect(savedLocationFromToday({ comparison: null, createdAt: now }, now)).toBeNull();
  });
});

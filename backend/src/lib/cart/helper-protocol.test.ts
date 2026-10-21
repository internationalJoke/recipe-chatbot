import { describe, expect, it } from "vitest";
import type { ShopTotal } from "@/lib/cart/compare-shops";
import { buyRequestSchema, compareRequestSchema, isAllowedOrigin, shopViews } from "@/lib/cart/helper-protocol";

const LIST_ID = "6f1c2a52-6a0b-4d55-9a11-0c1f3c1d2e3f";

describe("compareRequestSchema", () => {
  it("accepts a list id with an optional location or postcode", () => {
    expect(compareRequestSchema.parse({ shoppingListId: LIST_ID })).toMatchObject({ shoppingListId: LIST_ID });
    expect(compareRequestSchema.parse({ shoppingListId: LIST_ID, location: { lat: 59.86, lon: 17.64 }, postcode: "752 30" }))
      .toMatchObject({ location: { lat: 59.86, lon: 17.64 }, postcode: "75230" });
  });

  it("rejects bad ids, coordinates and postcodes", () => {
    expect(compareRequestSchema.safeParse({ shoppingListId: "x" }).success).toBe(false);
    expect(compareRequestSchema.safeParse({ shoppingListId: LIST_ID, location: { lat: 200, lon: 0 } }).success).toBe(false);
    expect(compareRequestSchema.safeParse({ shoppingListId: LIST_ID, postcode: "12" }).success).toBe(false);
  });

  it("treats an empty postcode as none", () => {
    expect(compareRequestSchema.parse({ shoppingListId: LIST_ID, postcode: " " }).postcode).toBeNull();
  });
});

describe("buyRequestSchema", () => {
  it("accepts only known shops", () => {
    expect(buyRequestSchema.parse({ shop: "ica" })).toEqual({ shop: "ica" });
    expect(buyRequestSchema.safeParse({ shop: "lidl" }).success).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("allows only pages served from this computer", () => {
    expect(isAllowedOrigin("http://localhost:4300")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:4200")).toBe(true);
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("http://localhost.evil.example:4300")).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
  });
});

describe("shopViews", () => {
  const offer = { code: "1", product: "Stjälkselleri 350g", url: "https://x/1", amount: 1, amountLabel: "1 × Stjälkselleri", size: "350g", costCents: 2230 };
  const totals: ShopTotal[] = [
    { shop: "ica", totalCents: 2230, missing: ["pepper"], picks: [{ item: { id: "a", name: "celery", quantity: 1, unit: "pcs" }, offer }] },
  ];

  it("joins totals with the store each shop used", () => {
    expect(shopViews(totals, [{ id: "ica", storeName: "ICA Folkes Livs", distanceKm: 2.04 }])).toEqual([{
      shop: "ica",
      name: "ICA",
      storeName: "ICA Folkes Livs",
      distanceKm: 2.04,
      totalCents: 2230,
      missing: ["pepper"],
      lines: [{ item: "Celery", product: "Stjälkselleri 350g", size: "350g", costCents: 2230, url: "https://x/1" }],
    }]);
  });

  it("works when the shop's store is unknown", () => {
    expect(shopViews(totals, [])[0]).toMatchObject({ storeName: null, distanceKm: null });
  });
});

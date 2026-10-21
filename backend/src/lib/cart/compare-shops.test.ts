import { describe, expect, it } from "vitest";
import { compareShops } from "@/lib/cart/compare-shops";
import type { ShoppingItem } from "@/lib/shopping-list";
import type { StoreProduct } from "@/lib/stores/axfood";

const product = (code: string, price: number, displayVolume: string | null = null): StoreProduct => ({
  code, name: `Product ${code}`, price, perKg: false, displayVolume, averageWeightKg: null, url: `https://x/${code}`,
});

const items: ShoppingItem[] = [
  { id: "pasta", name: "pasta", quantity: 1, unit: "pcs" },
  { id: "milk", name: "milk", quantity: 2, unit: "pcs" },
];

describe("compareShops", () => {
  it("totals each shop and ranks the cheapest complete shop first", () => {
    const result = compareShops(items, {
      willys: { pasta: [product("w1", 10)], milk: [product("w2", 15)] },
      hemkop: { pasta: [product("h1", 12)], milk: [product("h2", 14)] },
      ica: { pasta: [product("i1", 5)], milk: [] },
    });
    expect(result.map((s) => [s.shop, s.totalCents, s.missing])).toEqual([
      ["willys", 4000, []],
      ["hemkop", 4000, []],
      ["ica", 500, ["milk"]],
    ]);
    expect(result[0].picks.map((p) => [p.item.id, p.offer.code, p.offer.amount])).toEqual([["pasta", "w1", 1], ["milk", "w2", 2]]);
  });

  it("breaks ties between complete shops by order given", () => {
    const result = compareShops(items, {
      hemkop: { pasta: [product("h1", 10)], milk: [product("h2", 15)] },
      willys: { pasta: [product("w1", 10)], milk: [product("w2", 15)] },
    });
    expect(result.map((s) => s.shop)).toEqual(["hemkop", "willys"]);
  });

  it("puts shops that miss items after complete ones, fewest missing first", () => {
    const result = compareShops(items, {
      ica: {},
      willys: { pasta: [product("w1", 99)] },
      hemkop: { pasta: [product("h1", 50)], milk: [product("h2", 50)] },
    });
    expect(result.map((s) => [s.shop, s.missing.length])).toEqual([["hemkop", 0], ["willys", 1], ["ica", 2]]);
  });
});

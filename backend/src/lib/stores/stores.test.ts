import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "@/lib/shopping-list";
import { clearStoreCache, parseProducts, productUrl, searchStore, type StoreId, type StoreProduct } from "@/lib/stores/axfood";
import { comparePrices } from "@/lib/stores/compare";
import { bestOffer, needOf, offerFor, parsePackSize } from "@/lib/stores/pricing";

const product = (overrides: Partial<StoreProduct>): StoreProduct => ({
  code: "1_ST", name: "Thing", price: 10, perKg: false, displayVolume: null, averageWeightKg: null, url: "https://x", ...overrides,
});
const item = (name: string, quantity: number, unit: string, id = name): ShoppingItem => ({ id, name, quantity, unit, searchTerm: name });

describe("parseProducts", () => {
  it("keeps in-stock products and reads price per kg", () => {
    const products = parseProducts("willys", {
      results: [
        { code: "1_KG", name: "Lök Gul", priceValue: 10.9, priceUnit: "kr/kg", averageWeight: 0.12, outOfStock: false, online: true },
        { code: "2_ST", name: "Olivolja", priceValue: 72.9, priceUnit: "kr/st", displayVolume: "750ml", outOfStock: false },
        { code: "3_ST", name: "Slut", priceValue: 5, priceUnit: "kr/st", outOfStock: true },
        { broken: true },
      ],
    });
    expect(products.map((p) => [p.name, p.price, p.perKg])).toEqual([["Lök Gul", 10.9, true], ["Olivolja", 72.9, false]]);
    expect(products[1].url).toBe("https://www.willys.se/produkt/Olivolja-2_ST");
  });

  it("builds slugs without Swedish letters", () => {
    expect(productUrl("hemkop", "Lök Gul Klass 1", "100269139_KG")).toBe("https://www.hemkop.se/produkt/Lok-Gul-Klass-1-100269139_KG");
  });
});

describe("searchStore", () => {
  afterEach(() => clearStoreCache());

  it("calls the store search once and caches the result", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ results: [{ code: "1_ST", name: "Olivolja", priceValue: 50, priceUnit: "kr/st" }] })));
    await searchStore("hemkop", "Olivolja", { fetchFn });
    await searchStore("hemkop", "olivolja ", { fetchFn });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toBe("https://www.hemkop.se/search?q=olivolja&size=8");
  });

  it("reports a failing store", async () => {
    await expect(searchStore("willys", "x", { fetchFn: async () => new Response("no", { status: 503 }) })).rejects.toThrow(/HTTP 503/);
  });
});

describe("pricing", () => {
  it("reads pack sizes", () => {
    expect(parsePackSize("750ml")).toEqual({ kind: "volume", ml: 750 });
    expect(parsePackSize("2kg")).toEqual({ kind: "mass", grams: 2000 });
    expect(parsePackSize("1,5l")).toEqual({ kind: "volume", ml: 1500 });
    expect(parsePackSize("4x100g")).toEqual({ kind: "mass", grams: 400 });
    expect(parsePackSize("10-p")).toEqual({ kind: "count", pieces: 10 });
    expect(parsePackSize(null)).toEqual({ kind: "other" });
  });

  it("prices weight products by kg, using average weight for pieces", () => {
    const onions = product({ name: "Lök", price: 10, perKg: true, averageWeightKg: 0.12 });
    expect(offerFor({ quantity: 500, unit: "g" }, onions).costCents).toBe(500);
    expect(offerFor({ quantity: 5, unit: "pcs" }, onions)).toMatchObject({ costCents: 600, amountLabel: "≈0.6 kg Lök" });
  });

  it("buys enough packs", () => {
    const oil = product({ price: 50, displayVolume: "500ml" });
    expect(offerFor({ quantity: 1, unit: "l" }, oil)).toMatchObject({ amount: 2, costCents: 10_000 });
    expect(offerFor({ quantity: 3, unit: "tbsp" }, oil)).toMatchObject({ amount: 1, costCents: 5_000 });
    expect(needOf({ quantity: 2, unit: "clove" })).toEqual({ kind: "count", pieces: 2 });
  });

  it("picks the cheapest of the most relevant products only", () => {
    const products = [product({ code: "a", price: 30 }), product({ code: "b", price: 20 }), product({ code: "c", price: 25 }), product({ code: "d", price: 28 }), product({ code: "e", price: 1 })];
    expect(bestOffer({ quantity: 1, unit: "pcs" }, products)?.code).toBe("b");
    expect(bestOffer({ quantity: 1, unit: "pcs" }, [])).toBeNull();
  });
});

describe("comparePrices", () => {
  const prices = (table: Record<string, Partial<Record<StoreId, number>>>) => async (store: StoreId, term: string) => {
    const price = table[term]?.[store];
    return price === undefined ? [] : [product({ code: `${term}-${store}`, name: term, price })];
  };

  it("buys each item where it is cheapest, even when that saves only a little", async () => {
    const result = await comparePrices([item("oil", 1, "pcs"), item("salt", 1, "pcs")], {
      search: prices({ oil: { willys: 50, hemkop: 55 }, salt: { willys: 12, hemkop: 10 } }),
    });
    expect(result.lines.map((l) => [l.itemId, l.store])).toEqual([["oil", "willys"], ["salt", "hemkop"]]);
    expect(result.recommendation).toMatchObject({ plan: "mix", label: "Willys + Hemköp", totalCents: 6000 });
    expect(result.stores.map((s) => [s.store, s.totalCents])).toEqual([["willys", 6200], ["hemkop", 6500]]);
  });

  it("takes an item from the other store when one store lacks it (screenshot case)", async () => {
    const result = await comparePrices([item("garlic", 1, "pcs"), item("oil", 1, "pcs"), item("paprika", 1, "pcs")], {
      search: prices({ garlic: { willys: 8.9, hemkop: 11.3 }, oil: { willys: 62.9, hemkop: 68.09 }, paprika: { hemkop: 31.18 } }),
    });
    expect(result.lines.map((l) => [l.itemId, l.store])).toEqual([["garlic", "willys"], ["oil", "willys"], ["paprika", "hemkop"]]);
    expect(result.recommendation.totalCents).toBe(10298);
    expect(result.missing).toEqual([]);
  });

  it("uses one store when it is cheapest for everything, and lists what neither has", async () => {
    const result = await comparePrices([item("oil", 1, "pcs"), item("saffron", 1, "g")], {
      search: prices({ oil: { willys: 50, hemkop: 55 } }),
    });
    expect(result.recommendation).toMatchObject({ plan: "willys", label: "Willys" });
    expect(result.missing).toEqual(["saffron"]);
  });

  it("names items in English, searches in Swedish, and records when prices were fetched", async () => {
    const result = await comparePrices([{ id: "g", name: "garlic", quantity: 1, unit: "pcs", searchTerm: "vitlök" }], {
      search: prices({ "vitlök": { willys: 9 } }),
      now: () => new Date("2026-10-09T09:45:00Z"),
    });
    expect(result.lines[0].name).toBe("Garlic");
    expect(result.items[0].name).toBe("Garlic");
    expect(result.comparedAt).toBe("2026-10-09T09:45:00.000Z");
  });

  it("prices at the nearby store when one was found, and says which", async () => {
    const seen: (string | undefined)[] = [];
    const search = async (store: StoreId, term: string, _signal?: AbortSignal, branch?: { id: string }) => {
      seen.push(`${store}:${branch?.id}`);
      return prices({ [term]: { willys: 10, hemkop: 12 } })(store, term);
    };
    const branch = { id: "4003", name: "Hemköp Uppsala", town: "Uppsala", distanceKm: 1.2, closerWithoutPrices: false };
    const result = await comparePrices([item("milk", 1, "pcs")], { search, local: { hemkop: { branch, cookie: "c=1" } } });
    expect(seen.sort()).toEqual(["hemkop:4003", "willys:undefined"]);
    expect(result.stores.find((s) => s.store === "hemkop")?.branch).toEqual(branch);
    expect(result.stores.find((s) => s.store === "willys")?.branch).toBeNull();
  });

  it("fails only when every store search fails", async () => {
    const down = async () => {
      throw new Error("offline");
    };
    await expect(comparePrices([item("oil", 1, "pcs")], { search: down })).rejects.toThrow(/Could not reach/);

    let calls = 0;
    const half = async (store: StoreId, term: string) => {
      calls += 1;
      if (store === "hemkop") throw new Error("offline");
      return [product({ name: term, price: 20 })];
    };
    const result = await comparePrices([item("oil", 1, "pcs")], { search: half });
    expect(calls).toBe(2);
    expect(result.recommendation).toMatchObject({ plan: "willys", totalCents: 2000 });
  });
});

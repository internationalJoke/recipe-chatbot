import { describe, expect, it } from "vitest";
import { matchProduct, packsNeeded, quoteOrder } from "@/lib/market";
import { CATALOG } from "@/lib/market-catalog";
import type { ShoppingItem } from "@/lib/shopping-list";

const item = (name: string, quantity: number, unit: string, id = name): ShoppingItem => ({ id, name, quantity, unit });
const find = (name: string) => matchProduct(name, CATALOG)?.name ?? null;

describe("matchProduct", () => {
  it("matches plurals and extra words", () => {
    expect(find("ripe tomatoes")).toBe("Tomato");
    expect(find("Garlic cloves")).toBe("Garlic");
    expect(find("boneless chicken breasts")).toBe("Chicken breast");
  });

  it("prefers the most specific product", () => {
    expect(find("cherry tomatoes")).toBe("Cherry tomato");
    expect(find("tomato paste")).toBe("Tomato paste");
    expect(find("egg noodles")).toBe("Egg noodles");
    expect(find("black pepper")).toBe("Black pepper");
  });

  it("uses aliases and ignores accents and case", () => {
    expect(find("Cilantro")).toBe("Coriander");
    expect(find("JALAPEÑO chilli")).toBe("Chili pepper");
  });

  it("returns null for unknown products", () => {
    expect(find("saffron")).toBeNull();
  });
});

describe("packsNeeded", () => {
  const product = (name: string) => matchProduct(name, CATALOG)!;

  it("converts weight and volume to packs", () => {
    expect(packsNeeded(item("flour", 500, "g"), product("flour"))).toBe(1);
    expect(packsNeeded(item("flour", 2.5, "kg"), product("flour"))).toBe(3);
    expect(packsNeeded(item("milk", 1500, "ml"), product("milk"))).toBe(2);
  });

  it("counts pieces for countable products", () => {
    expect(packsNeeded(item("lemon", 3, "pcs"), product("lemon"))).toBe(3);
  });

  it("buys one pack for spoons and other small units", () => {
    expect(packsNeeded(item("soy sauce", 3, "tbsp"), product("soy sauce"))).toBe(1);
  });
});

describe("quoteOrder", () => {
  it("prices found items and lists missing ones", () => {
    const quote = quoteOrder([item("lemon", 2, "pcs"), item("saffron", 1, "g"), item("rice", 1, "kg")]);
    expect(quote.lines.map((line) => [line.product, line.packs, line.lineTotalCents])).toEqual([
      ["Lemon", 2, 98],
      ["Rice", 1, 249],
    ]);
    expect(quote.missing).toEqual(["saffron"]);
    expect(quote.totalCents).toBe(347);
    expect(quote.currency).toBe("EUR");
  });

  it("returns an empty quote for no items", () => {
    expect(quoteOrder([])).toMatchObject({ lines: [], missing: [], totalCents: 0 });
  });
});

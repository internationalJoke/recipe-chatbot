import { describe, expect, it } from "vitest";
import { icaCartQuantity, icaPageProductId, icaProductsFromHtml, icaSuggestion, isHumanCheck, parseIcaProducts } from "@/lib/cart/ica-products";

const STORE = "https://handlaprivatkund.ica.se/stores/1003380";

describe("parseIcaProducts", () => {
  it("finds products nested anywhere in the page's JSON responses", () => {
    const body = {
      entities: {
        product: {
          a: { retailerProductId: "111", name: "Tomater Kvist", available: true, price: { current: { amount: "34.90" } }, size: { value: "500g" } },
          b: { productId: 222, name: "Krossade Tomater", price: { amount: 12.5 }, packSize: "400g" },
        },
      },
    };
    const products = parseIcaProducts([body], STORE);
    expect(products).toEqual([
      expect.objectContaining({ code: "111", name: "Tomater Kvist", price: 34.9, perKg: false, displayVolume: "500g" }),
      expect.objectContaining({ code: "222", name: "Krossade Tomater", price: 12.5, displayVolume: "400g" }),
    ]);
    expect(products[0].url).toContain(`${STORE}/search?q=`);
  });

  it("reads Swedish decimal commas and per-kg prices", () => {
    const [product] = parseIcaProducts([[{ id: "9", name: "Gul lök", price: "19,95", priceUnit: "kr/kg" }]], STORE);
    expect(product).toMatchObject({ price: 19.95, perKg: true, displayVolume: null });
  });

  it("skips unavailable items, items without a price, and duplicates", () => {
    const products = parseIcaProducts([
      { list: [{ id: "1", name: "A", price: 10 }, { id: "1", name: "A", price: 10 }] },
      { list: [{ id: "2", name: "B", price: 10, available: false }, { id: "3", name: "C" }, { id: "4", name: "D", price: "gratis" }] },
      null,
      "not json",
    ], STORE);
    expect(products.map((p) => p.code)).toEqual(["1"]);
  });

  it("reads ICA's page state: unit price labels and weights with a separate unit", () => {
    const entities = [
      { retailerProductId: "2048653", name: "Stjälkselleri 350g Klass 1 ICA", available: true, size: { value: "0.35kg" },
        price: { current: { amount: "22.30", currency: "SEK" }, unit: { label: "fop.price.per.kg", current: { amount: "63.71" } } } },
      { retailerProductId: "1474453", name: "Rotselleri Delad ca 300g", available: true, size: { value: "0.3", uom: "KG", catchWeight: true },
        price: { current: { amount: "10.77" }, unit: { label: "fop.price.per.kg", current: { amount: "35.90" } } } },
    ];
    expect(parseIcaProducts([entities], STORE)).toEqual([
      expect.objectContaining({ code: "2048653", price: 22.3, perKg: false, displayVolume: "0.35kg" }),
      expect.objectContaining({ code: "1474453", price: 10.77, perKg: false, displayVolume: "0.3kg" }),
    ]);
  });

  it("keeps at most eight results", () => {
    const list = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: `P${i}`, price: 1 + i }));
    expect(parseIcaProducts([list], STORE)).toHaveLength(8);
  });
});

describe("icaProductsFromHtml", () => {
  const entity = (id: string, name: string, amount: string) => ({
    productId: `uuid-${id}`, retailerProductId: id, name, available: true, size: { value: "1kg" }, price: { current: { amount } },
  });
  const state = {
    data: {
      products: { productEntities: { "uuid-1": entity("1", "Kycklingvingar 1kg ICA", "37.44"), "uuid-2": entity("2", "Kycklingvingar 1kg Kronfågel", "41.49") } },
      search: { catalogue: { data: { productGroups: [{ products: ["uuid-2", "uuid-1"] }] } } },
    },
  };
  const html = (json: string) => `<html><body><script>window.__INITIAL_STATE__ = ${json};</script><div>…</div></body></html>`;

  it("reads products from the page's initial state, in search order", () => {
    const products = icaProductsFromHtml(html(JSON.stringify(state).replace(/\//g, "\\u002F")), STORE);
    expect(products.map((p) => [p.code, p.price])).toEqual([["2", 41.49], ["1", 37.44]]);
  });

  it("links each product to the search page it was found on", () => {
    const products = icaProductsFromHtml(html(JSON.stringify(state)), STORE, `${STORE}/search?q=chicken%20wing`);
    expect(products.map((p) => p.url)).toEqual([`${STORE}/search?q=chicken%20wing`, `${STORE}/search?q=chicken%20wing`]);
  });

  it("finds ICA's page id (the one on the product card) for a product code", () => {
    expect(icaPageProductId(html(JSON.stringify(state)), "1")).toBe("uuid-1");
    expect(icaPageProductId(html(JSON.stringify(state)), "9")).toBeNull();
    expect(icaPageProductId("<html></html>", "1")).toBeNull();
  });

  it("returns nothing for pages without state or with broken JSON", () => {
    expect(icaProductsFromHtml("<html>Human Verification</html>", STORE)).toEqual([]);
    expect(icaProductsFromHtml(html("{broken"), STORE)).toEqual([]);
  });
});

describe("isHumanCheck", () => {
  it("spots ICA's captcha page", () => {
    expect(isHumanCheck("<title>Human Verification</title>")).toBe(true);
    expect(isHumanCheck("<title>– ICA Handla Online</title>")).toBe(false);
  });
});

describe("icaSuggestion", () => {
  it("returns the first suggested search when nothing was found", () => {
    const html = '<span>förslag:</span><div data-test="suggestion-search-list" class="x"><a class="b" href="/stores/1003975/search?q=svartpeppar">svartpeppar</a><a href="/stores/1003975/search?q=pepparkorn">pepparkorn</a></div>';
    expect(icaSuggestion(html)).toBe("/stores/1003975/search?q=svartpeppar");
  });

  it("returns null without suggestions", () => {
    expect(icaSuggestion('<a href="/stores/1/search?q=x">x</a>')).toBeNull();
  });
});

describe("icaCartQuantity", () => {
  const cart = { items: [{ productId: "uuid-1", quantity: 2 }, { productId: "uuid-2", quantity: 1 }] };

  it("returns how many of a product are in the cart", () => {
    expect(icaCartQuantity(cart, "uuid-1")).toBe(2);
    expect(icaCartQuantity(cart, "uuid-3")).toBe(0);
  });

  it("returns 0 for an empty or unexpected cart", () => {
    expect(icaCartQuantity({ items: [] }, "uuid-1")).toBe(0);
    expect(icaCartQuantity(null, "uuid-1")).toBe(0);
    expect(icaCartQuantity({ items: [{ productId: "uuid-1", quantity: "x" }] }, "uuid-1")).toBe(0);
  });
});

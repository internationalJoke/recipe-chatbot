import { describe, expect, it } from "vitest";
import { extractShoppingList, parseStoredItems } from "@/lib/shopping-list";

let counter = 0;
const makeId = () => `id-${++counter}`;

describe("extractShoppingList", () => {
  it("returns plain text when there is no block", () => {
    expect(extractShoppingList("  Just cook pasta.  ", makeId)).toEqual({ text: "Just cook pasta.", items: null });
  });

  it("strips the block and parses items", () => {
    const reply = `You need tomatoes and basil.
<shopping_list>
{"items":[{"name":"tomato","quantity":4,"unit":"pcs"},{"name":"basil","quantity":1,"unit":"bunch","note":"fresh"}]}
</shopping_list>`;
    const result = extractShoppingList(reply, makeId);
    expect(result.text).toBe("You need tomatoes and basil.");
    expect(result.items).toHaveLength(2);
    expect(result.items?.[0]).toMatchObject({ name: "tomato", quantity: 4, unit: "pcs" });
    expect(result.items?.[1]).toMatchObject({ name: "basil", note: "fresh" });
    expect(result.items?.[0].id).not.toBe(result.items?.[1].id);
  });

  it("accepts a code fence and a bare array", () => {
    const reply = 'Ok.<shopping_list>```json\n[{"name":"rice","quantity":"500","unit":"g"}]\n```</shopping_list>';
    expect(extractShoppingList(reply, makeId).items).toEqual([
      expect.objectContaining({ name: "rice", quantity: 500, unit: "g" }),
    ]);
  });

  it("drops invalid items and defaults bad fields", () => {
    const reply = '<shopping_list>{"items":[{"name":""},{"foo":1},{"name":"egg","quantity":-2}]}</shopping_list>';
    const result = extractShoppingList(reply, makeId);
    expect(result.items).toEqual([expect.objectContaining({ name: "egg", quantity: 1, unit: "pcs" })]);
  });

  it("hides a broken block and returns no items", () => {
    const result = extractShoppingList("Recipe text <shopping_list>{not json", makeId);
    expect(result).toEqual({ text: "Recipe text", items: null });
  });

  it("caps the list at 40 items", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ name: `item ${i}`, quantity: 1, unit: "pcs" }));
    const reply = `<shopping_list>${JSON.stringify({ items })}</shopping_list>`;
    expect(extractShoppingList(reply, makeId).items).toHaveLength(40);
  });
});

describe("parseStoredItems", () => {
  it("rejects malformed stored data", () => {
    expect(() => parseStoredItems([{ id: 1 }])).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { chosenItems } from "@/lib/cart/chosen-items";
import type { ShoppingItem } from "@/lib/shopping-list";

const item = (id: string, have = false) => ({ id, name: id, quantity: 1, unit: "st", have }) as ShoppingItem;
const items = [item("butter"), item("corn"), item("milk"), item("salt", true)];

describe("chosenItems", () => {
  it("keeps only the items the user left ticked at Accept", () => {
    const comparison = { items: [{ itemId: "butter" }, { itemId: "corn" }, { itemId: "salt" }] };
    expect(chosenItems(items, comparison).map((i) => i.id)).toEqual(["butter", "corn", "salt"]);
  });

  it("without a saved choice, leaves out what the user already has", () => {
    expect(chosenItems(items, null).map((i) => i.id)).toEqual(["butter", "corn", "milk"]);
    expect(chosenItems(items, { other: true }).map((i) => i.id)).toEqual(["butter", "corn", "milk"]);
  });
});

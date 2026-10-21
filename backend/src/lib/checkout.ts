import { prisma } from "@/lib/prisma";
import { parseStoredItems } from "@/lib/shopping-list";
import { StoreUnavailableError } from "@/lib/stores/axfood";
import { roughLocation, type Location } from "@/lib/stores/branches";
import { comparePrices } from "@/lib/stores/compare";
import { findLocalStores } from "@/lib/stores/local";

export class CheckoutError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const withOrder = { order: true } as const;

/**
 * Runs only after the user clicks Accept. Compares Willys and Hemköp for the ticked items and
 * saves the cheapest plan. With the user's location, prices come from the nearest stores; the
 * location is saved only rounded to about a km (`comparison.near`), so `npm run shop` can use the
 * same nearby stores. Nothing is bought online: the user finishes at the store's site.
 * Prices are fetched before the claim, so a store outage leaves the list open to try again.
 */
export async function acceptShoppingList(listId: string, itemIds: string[], location?: Location) {
  const list = await prisma.shoppingList.findUnique({ where: { id: listId } });
  if (!list) throw new CheckoutError("Shopping list not found", 404);
  if (list.status !== "PROPOSED") throw new CheckoutError(`This list was already ${list.status.toLowerCase()}`, 409);

  const wanted = new Set(itemIds);
  const chosen = parseStoredItems(list.items).filter((item) => wanted.has(item.id));
  if (chosen.length === 0) throw new CheckoutError("Pick at least one item to buy", 400);

  let comparison;
  try {
    const local = location ? await findLocalStores(location) : {};
    comparison = await comparePrices(chosen, { local });
  } catch (error) {
    if (error instanceof StoreUnavailableError) throw new CheckoutError(error.message, 502);
    throw error;
  }

  return prisma.$transaction(async (tx) => {
    // The status check stops a double click from saving two plans.
    const claimed = await tx.shoppingList.updateMany({
      where: { id: listId, status: "PROPOSED" },
      data: { status: "ACCEPTED" },
    });
    if (claimed.count !== 1) throw new CheckoutError("This list was already handled", 409);

    await tx.order.create({
      data: {
        shoppingListId: listId,
        store: comparison.recommendation.label,
        currency: comparison.currency,
        lines: comparison.lines,
        missing: comparison.missing,
        totalCents: comparison.recommendation.totalCents,
        comparison: location ? { ...comparison, near: roughLocation(location) } : comparison,
      },
    });
    return tx.shoppingList.findUniqueOrThrow({ where: { id: listId }, include: withOrder });
  });
}

export async function declineShoppingList(listId: string) {
  const claimed = await prisma.shoppingList.updateMany({
    where: { id: listId, status: "PROPOSED" },
    data: { status: "DECLINED" },
  });
  if (claimed.count !== 1) {
    const exists = await prisma.shoppingList.findUnique({ where: { id: listId }, select: { id: true } });
    throw exists
      ? new CheckoutError("This list was already handled", 409)
      : new CheckoutError("Shopping list not found", 404);
  }
  return prisma.shoppingList.findUniqueOrThrow({ where: { id: listId }, include: withOrder });
}

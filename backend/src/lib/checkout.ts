import { prisma } from "@/lib/prisma";
import { quoteOrder } from "@/lib/market";
import { parseStoredItems } from "@/lib/shopping-list";

export class CheckoutError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const withOrder = { order: true } as const;

/**
 * The only place that "buys" groceries. Runs only after the user clicks Accept.
 * The status check inside the transaction stops a double click from ordering twice.
 */
export async function acceptShoppingList(listId: string, itemIds: string[]) {
  return prisma.$transaction(async (tx) => {
    const list = await tx.shoppingList.findUnique({ where: { id: listId } });
    if (!list) throw new CheckoutError("Shopping list not found", 404);
    if (list.status !== "PROPOSED") throw new CheckoutError(`This list was already ${list.status.toLowerCase()}`, 409);

    const items = parseStoredItems(list.items);
    const wanted = new Set(itemIds);
    const chosen = items.filter((item) => wanted.has(item.id));
    if (chosen.length === 0) throw new CheckoutError("Pick at least one item to buy", 400);

    const claimed = await tx.shoppingList.updateMany({
      where: { id: listId, status: "PROPOSED" },
      data: { status: "ACCEPTED" },
    });
    if (claimed.count !== 1) throw new CheckoutError("This list was already handled", 409);

    const quote = quoteOrder(chosen);
    await tx.order.create({
      data: {
        shoppingListId: listId,
        store: quote.store,
        currency: quote.currency,
        lines: quote.lines,
        missing: quote.missing,
        totalCents: quote.totalCents,
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

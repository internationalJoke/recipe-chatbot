import { NextResponse } from "next/server";
import { z } from "zod";
import { dishShoppingItems, parseStoredDishes } from "@/lib/dishes";
import { prisma } from "@/lib/prisma";
import { toShoppingItems } from "@/lib/shopping-list";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const selectSchema = z.object({ dishId: z.string().min(1).max(64) });

/**
 * The user picked a dish card: save the choice and turn that dish's ingredients into the
 * shopping list on the same message. No model call is needed; the card already has the recipe.
 * Picking another dish replaces the list, unless prices were already compared.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const parsed = selectSchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "Pick a dish" }, { status: 400 });
  }

  try {
    const message = await prisma.message.findUnique({
      where: { id },
      select: { dishes: true, shoppingList: { select: { status: true } } },
    });
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    const dish = parseStoredDishes(message.dishes).find((d) => d.id === parsed.data.dishId);
    if (!dish) return NextResponse.json({ error: "That dish is not part of this message" }, { status: 400 });
    if (message.shoppingList && message.shoppingList.status !== "PROPOSED") {
      return NextResponse.json({ error: "Prices were already compared for this message" }, { status: 409 });
    }

    const items = toShoppingItems(dishShoppingItems(dish));
    const updated = await prisma.message.update({
      where: { id },
      data: {
        selectedDishId: dish.id,
        shoppingList: {
          upsert: { create: { items }, update: { items, status: "PROPOSED" } },
        },
      },
      select: { id: true, selectedDishId: true, shoppingList: { include: { order: true } } },
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Could not save dish choice:", { messageId: id, error });
    return NextResponse.json({ error: "Could not save your choice" }, { status: 500 });
  }
}

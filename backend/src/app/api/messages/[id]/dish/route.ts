import { NextResponse } from "next/server";
import { z } from "zod";
import { dishShoppingItems, MAX_DISHES, parseStoredDishes } from "@/lib/dishes";
import { prisma } from "@/lib/prisma";
import { RecipeServiceError } from "@/lib/recipe-service";
import { shoppingItemsForDishes } from "@/lib/recipe-shopping";
import { toShoppingItems } from "@/lib/shopping-list";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const dishId = z.string().min(1).max(64);
// `dishId` is the old single-pick body; it still works.
const selectSchema = z.union([
  z.object({ dishIds: z.array(dishId).min(1).max(MAX_DISHES) }),
  z.object({ dishId }).transform(({ dishId }) => ({ dishIds: [dishId] })),
]);

/**
 * The user picked one or more dish cards: save the choice and build the shopping list on the
 * same message. Database recipes ask the recipe service what is missing; older cards use
 * their own ingredients. Picking again replaces the list, unless prices were already compared.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const parsed = selectSchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "Pick at least one dish" }, { status: 400 });
  }

  try {
    const message = await prisma.message.findUnique({
      where: { id },
      select: { dishes: true, shoppingList: { select: { status: true } } },
    });
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    const stored = parseStoredDishes(message.dishes);
    const picked = stored.filter((d) => parsed.data.dishIds.includes(d.id));
    if (picked.length !== new Set(parsed.data.dishIds).size) {
      return NextResponse.json({ error: "That dish is not part of this message" }, { status: 400 });
    }
    if (message.shoppingList && message.shoppingList.status !== "PROPOSED") {
      return NextResponse.json({ error: "Prices were already compared for this message" }, { status: 409 });
    }

    const fromDatabase = picked.some((d) => d.recipeId !== undefined);
    const raw = fromDatabase ? await shoppingItemsForDishes(picked) : picked.flatMap(dishShoppingItems);
    const items = toShoppingItems(raw);
    const updated = await prisma.message.update({
      where: { id },
      data: {
        selectedDishIds: picked.map((d) => d.id),
        shoppingList: {
          upsert: { create: { items }, update: { items, status: "PROPOSED" } },
        },
      },
      select: { id: true, selectedDishIds: true, shoppingList: { include: { order: true } } },
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof RecipeServiceError) {
      console.error("Recipe service failed:", { messageId: id, error: error.message });
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error("Could not save dish choice:", { messageId: id, error });
    return NextResponse.json({ error: "Could not save your choice" }, { status: 500 });
  }
}

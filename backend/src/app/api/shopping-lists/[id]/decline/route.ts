import { NextResponse } from "next/server";
import { z } from "zod";
import { CheckoutError, declineShoppingList } from "@/lib/checkout";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Shopping list not found" }, { status: 404 });
  }

  try {
    return NextResponse.json(await declineShoppingList(id));
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Decline failed:", { shoppingListId: id, error });
    return NextResponse.json({ error: "Could not update the list" }, { status: 500 });
  }
}

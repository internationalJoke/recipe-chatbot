import { NextResponse } from "next/server";
import { z } from "zod";
import { acceptShoppingList, CheckoutError } from "@/lib/checkout";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const acceptSchema = z.object({
  itemIds: z.array(z.string().min(1).max(64)).min(1).max(40),
});

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const parsed = acceptSchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "Pick at least one item to buy" }, { status: 400 });
  }

  try {
    return NextResponse.json(await acceptShoppingList(id, parsed.data.itemIds));
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Checkout failed:", { shoppingListId: id, error });
    return NextResponse.json({ error: "Could not place the order" }, { status: 500 });
  }
}

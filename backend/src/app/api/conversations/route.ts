import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export async function GET() {
  const conversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });

  return NextResponse.json(conversations);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = createConversationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid conversation title" }, { status: 400 });
  }

  const conversation = await prisma.conversation.create({
    data: { title: parsed.data.title ?? "New conversation" },
  });

  return NextResponse.json(conversation, { status: 201 });
}

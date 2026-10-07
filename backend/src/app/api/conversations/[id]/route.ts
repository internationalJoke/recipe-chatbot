import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { removeUpload } from "@/lib/files";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: { attachments: true, shoppingList: { include: { order: true } } },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json(conversation);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: {
      messages: {
        select: { attachments: { select: { storagePath: true } } },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  await prisma.conversation.delete({ where: { id } });
  const paths = conversation.messages.flatMap((message) =>
    message.attachments.map((attachment) => attachment.storagePath),
  );
  await Promise.allSettled(paths.map(removeUpload));

  return new Response(null, { status: 204 });
}

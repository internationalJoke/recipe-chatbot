import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { streamChat, TextOnlyModelError } from "@/lib/llm";
import { describeLlm } from "@/lib/llm-config";
import { MAX_FILES, removeUpload, saveUpload, validateUpload } from "@/lib/files";
import { extractShoppingList } from "@/lib/shopping-list";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_CONTENT = 8_000;
const HISTORY_LIMIT = 30;

function makeTitle(content: string, files: File[]) {
  const source = content.trim() || files[0]?.name || "New conversation";
  return source.length > 48 ? `${source.slice(0, 47)}…` : source;
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const llm = describeLlm();
  if (!llm.configured) {
    return NextResponse.json({ error: llm.error }, { status: 503 });
  }

  const formData = await request.formData();
  const contentEntry = formData.get("content");
  const content = typeof contentEntry === "string" ? contentEntry.trim() : "";
  const files = formData.getAll("files").filter((item): item is File => item instanceof File);

  if (!content && files.length === 0) {
    return NextResponse.json({ error: "Add a message or an attachment" }, { status: 400 });
  }
  if (content.length > MAX_CONTENT) {
    return NextResponse.json({ error: "Messages are limited to 8,000 characters" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `You can upload at most ${MAX_FILES} files` }, { status: 400 });
  }
  try {
    files.forEach(validateUpload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid attachment" },
      { status: 400 },
    );
  }

  const savedFiles: Awaited<ReturnType<typeof saveUpload>>[] = [];
  try {
    for (const file of files) savedFiles.push(await saveUpload(file));

    const userMessage = await prisma.message.create({
      data: { conversationId: id, role: "USER", content, attachments: { create: savedFiles } },
      include: { attachments: true },
    });

    if (conversation.title === "New conversation") {
      await prisma.conversation.update({ where: { id }, data: { title: makeTitle(content, files) } });
    }

    const pendingReply = await prisma.message.create({
      data: { conversationId: id, role: "ASSISTANT", content: "", status: "PENDING", model: llm.model },
    });

    return new Response(replyStream(id, pendingReply.id, userMessage), {
      status: 201,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    await Promise.allSettled(savedFiles.map((file) => removeUpload(file.storagePath)));
    console.error("Unable to save message:", { conversationId: id, error });
    return NextResponse.json({ error: "Unable to save message" }, { status: 500 });
  }
}

type SavedUserMessage = { id: string; attachments: { storagePath: string }[] };

// The model can't read images: drop this turn entirely so the page can resend text only
// and the photo doesn't linger in the conversation history.
async function discardTurn(userMessage: SavedUserMessage, replyId: string) {
  await prisma.message.deleteMany({ where: { id: { in: [userMessage.id, replyId] } } });
  await Promise.allSettled(userMessage.attachments.map((a) => removeUpload(a.storagePath)));
}

function replyStream(conversationId: string, replyId: string, userMessage: SavedUserMessage) {
  const encoder = new TextEncoder();
  const operationAbort = new AbortController();
  let streamOpen = true;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        if (!streamOpen) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          streamOpen = false;
          operationAbort.abort();
        }
      };

      void (async () => {
        try {
          const history = await prisma.message.findMany({
            where: { conversationId, status: "COMPLETE" },
            orderBy: { createdAt: "desc" },
            take: HISTORY_LIMIT,
            include: { attachments: true },
          });

          send({ type: "status", status: "answering" });
          const reply = await streamChat(
            history.reverse(),
            (chunk) => send({ type: "chunk", content: chunk }),
            operationAbort.signal,
          );

          const { text, items } = extractShoppingList(reply.content);
          const assistantMessage = await prisma.message.update({
            where: { id: replyId },
            data: {
              content: text || "Here is the shopping list for this recipe.",
              model: reply.model,
              status: "COMPLETE",
              ...(items ? { shoppingList: { create: { items } } } : {}),
            },
            include: { attachments: true, shoppingList: { include: { order: true } } },
          });

          await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
          send({ type: "done", userMessage, assistantMessage });
        } catch (error) {
          if (error instanceof TextOnlyModelError) {
            console.warn("Model is text only; discarding image message:", { conversationId, messageId: userMessage.id });
            await discardTurn(userMessage, replyId).catch((cleanupError) =>
              console.error("Could not discard image message:", cleanupError),
            );
            send({ type: "error", error: error.message, code: error.code });
            return;
          }
          const message = error instanceof Error ? error.message : "Model request failed";
          console.error("Message processing failed:", { conversationId, messageId: replyId, error });
          await prisma.message
            .update({ where: { id: replyId }, data: { content: message, status: "FAILED" } })
            .catch((updateError) => console.error("Could not mark reply as failed:", updateError));
          send({ type: "error", error: message });
        } finally {
          if (streamOpen) {
            streamOpen = false;
            controller.close();
          }
        }
      })();
    },
    cancel() {
      streamOpen = false;
      operationAbort.abort();
    },
  });
}

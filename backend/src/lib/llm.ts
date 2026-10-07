import { createGoogle } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, isStepCount, streamText, type LanguageModel, type ModelMessage } from "ai";
import type { Attachment, Message } from "@/generated/prisma/client";
import { isImageMimeType, isTextMimeType, readUpload } from "@/lib/files";
import { resolveLlmConfig, type LlmConfig } from "@/lib/llm-config";
import { IMAGE_ONLY_PROMPT, SYSTEM_PROMPT } from "@/lib/prompts";
import { chatTools, MAX_TOOL_STEPS } from "@/lib/tools";

type MessageWithAttachments = Message & { attachments: Attachment[] };
type UserPart =
  | { type: "text"; text: string }
  | { type: "image"; image: Buffer; mediaType: string };

const LLM_TIMEOUT_MS = 180_000;

export function createModel(config: LlmConfig): LanguageModel {
  if (config.provider === "gemini") {
    return createGoogle({ apiKey: config.apiKey })(config.model);
  }
  return createOpenRouter({ apiKey: config.apiKey, headers: { "X-Title": "Recipe Chatbot" } })(config.model);
}

export const TEXT_ONLY_MESSAGE = "This model supports text only. Please send a text message without images.";

/** Thrown when the model rejects image input, so callers can retry with text only. */
export class TextOnlyModelError extends Error {
  readonly code = "text_only";
  constructor() {
    super(TEXT_ONLY_MESSAGE);
  }
}

// Pixels go only with the newest message. Older images are described in the
// assistant's earlier replies, so text follow-ups work on text-only models too.
function latestImageMessageId(messages: MessageWithAttachments[]) {
  const last = messages.at(-1);
  return last?.attachments.some((a) => isImageMimeType(a.mimeType)) ? last.id : null;
}

async function toModelMessage(message: MessageWithAttachments, includeImages: boolean): Promise<ModelMessage> {
  const hasImage = message.attachments.some((a) => isImageMimeType(a.mimeType));
  const textParts: string[] = [message.content || (hasImage ? IMAGE_ONLY_PROMPT : "")];
  const imageParts: UserPart[] = [];

  for (const attachment of message.attachments) {
    const name = JSON.stringify(attachment.originalName);
    if (isImageMimeType(attachment.mimeType)) {
      if (includeImages) {
        imageParts.push({ type: "image", image: await readUpload(attachment.storagePath), mediaType: attachment.mimeType });
      } else {
        textParts.push(`[Earlier image ${name}; see your previous reply for what it showed.]`);
      }
    } else if (isTextMimeType(attachment.mimeType)) {
      const data = await readUpload(attachment.storagePath);
      textParts.push(`<file name=${name}>\n${data.toString("utf8")}\n</file>`);
    }
  }

  const text = textParts.filter(Boolean).join("\n\n") || "Please respond to the attached file.";
  if (message.role === "ASSISTANT") return { role: "assistant", content: text };
  if (message.role === "SYSTEM") return { role: "system", content: text };
  return { role: "user", content: imageParts.length > 0 ? [{ type: "text", text }, ...imageParts] : text };
}

export async function buildModelMessages(history: MessageWithAttachments[]): Promise<ModelMessage[]> {
  const imageMessageId = latestImageMessageId(history);
  return Promise.all(history.map((message) => toModelMessage(message, message.id === imageMessageId)));
}

function providerMessage(error: APICallError) {
  const data = error.data as { error?: { message?: unknown } } | undefined;
  return typeof data?.error?.message === "string" ? data.error.message : error.message;
}

export function isImageUnsupported(error: unknown) {
  return APICallError.isInstance(error) && /image input|vision|multimodal/i.test(providerMessage(error));
}

export function friendlyError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return "The model provider rejected the API key. Check your exported key.";
    }
    if (error.statusCode === 429) return "The model provider rate limit was reached. Wait a moment and try again.";
    if (isImageUnsupported(error)) return TEXT_ONLY_MESSAGE;
    return `Model provider error: ${providerMessage(error)}`;
  }
  return error instanceof Error ? error.message : "Model request failed";
}

export async function streamChat(
  history: MessageWithAttachments[],
  onChunk: (chunk: string) => void,
  clientSignal?: AbortSignal,
) {
  const config = resolveLlmConfig();
  const timeoutSignal = AbortSignal.timeout(LLM_TIMEOUT_MS);
  const abortSignal = clientSignal ? AbortSignal.any([clientSignal, timeoutSignal]) : timeoutSignal;
  const hasTools = Object.keys(chatTools).length > 0;

  try {
    const result = streamText({
      model: createModel(config),
      instructions: SYSTEM_PROMPT,
      messages: await buildModelMessages(history),
      temperature: config.temperature,
      maxRetries: 1,
      abortSignal,
      ...(hasTools ? { tools: chatTools, stopWhen: isStepCount(MAX_TOOL_STEPS) } : {}),
    });

    let content = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        content += part.text;
        onChunk(part.text);
      } else if (part.type === "error") {
        throw part.error;
      }
    }

    if (!content.trim()) throw new Error("The model returned an empty answer.");
    return { content, model: config.model };
  } catch (error) {
    if (clientSignal?.aborted) throw new Error("The request was canceled.");
    if (timeoutSignal.aborted) throw new Error("The model took too long to answer. Please try again.");
    if (isImageUnsupported(error)) throw new TextOnlyModelError();
    throw new Error(friendlyError(error));
  }
}

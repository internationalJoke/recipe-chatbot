import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  Conversation,
  ConversationSummary,
  Health,
  SendMessageResponse,
  SendMessageStreamEvent,
  ShoppingList,
  StreamStatus,
} from './models';

/** A stream error the page can react to, e.g. code 'text_only' when the model can't read images. */
export class ChatStreamError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';

  listConversations() {
    return this.http.get<ConversationSummary[]>(`${this.baseUrl}/conversations`);
  }

  createConversation() {
    return this.http.post<ConversationSummary>(`${this.baseUrl}/conversations`, {});
  }

  getConversation(id: string) {
    return this.http.get<Conversation>(`${this.baseUrl}/conversations/${id}`);
  }

  deleteConversation(id: string) {
    return this.http.delete<void>(`${this.baseUrl}/conversations/${id}`);
  }

  async sendMessage(
    id: string,
    content: string,
    files: File[],
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
    onStatus?: (status: StreamStatus, query?: string) => void,
  ): Promise<SendMessageResponse> {
    const formData = new FormData();
    formData.append('content', content);
    files.forEach((file) => formData.append('files', file));

    // Aborting closes the connection; the backend then stops the model call.
    const response = await fetch(`${this.baseUrl}/conversations/${id}/messages`, {
      method: 'POST',
      body: formData,
      signal,
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Message request failed with HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('The message response did not include a stream.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed: SendMessageResponse | undefined;

    const processLine = (line: string) => {
      if (!line.trim()) return;

      let event: SendMessageStreamEvent;
      try {
        event = JSON.parse(line) as SendMessageStreamEvent;
      } catch {
        throw new Error('The server returned an invalid message stream.');
      }

      if (event.type === 'status') onStatus?.(event.status, event.query);
      if (event.type === 'chunk') onChunk(event.content);
      if (event.type === 'done') {
        completed = {
          userMessage: event.userMessage,
          assistantMessage: event.assistantMessage,
        };
      }
      if (event.type === 'error') throw new ChatStreamError(event.error, event.code);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(processLine);
    }

    buffer += decoder.decode();
    processLine(buffer);

    if (!completed) throw new Error('The message stream ended before completion.');
    return completed;
  }

  acceptShoppingList(id: string, itemIds: string[]) {
    return this.http.post<ShoppingList>(`${this.baseUrl}/shopping-lists/${id}/accept`, { itemIds });
  }

  declineShoppingList(id: string) {
    return this.http.post<ShoppingList>(`${this.baseUrl}/shopping-lists/${id}/decline`, {});
  }

  // Health returns 503 when the model key is missing; we still want its body.
  async health(): Promise<Health | null> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return (await response.json()) as Health;
    } catch {
      return null;
    }
  }

  attachmentUrl(id: string) {
    return `${this.baseUrl}/attachments/${id}`;
  }
}

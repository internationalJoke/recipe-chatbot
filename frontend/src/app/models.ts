export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';
export type MessageStatus = 'PENDING' | 'COMPLETE' | 'FAILED';
export type ShoppingListStatus = 'PROPOSED' | 'ACCEPTED' | 'DECLINED';

export interface Attachment {
  id: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  note?: string;
}

export interface OrderLine {
  itemId: string;
  requested: string;
  product: string;
  packSize: string;
  packs: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface Order {
  id: string;
  store: string;
  lines: OrderLine[];
  missing: string[];
  totalCents: number;
  currency: string;
  createdAt: string;
}

export interface ShoppingList {
  id: string;
  status: ShoppingListStatus;
  items: ShoppingItem[];
  order: Order | null;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  model?: string;
  attachments: Attachment[];
  shoppingList?: ShoppingList | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
}

export interface Conversation extends ConversationSummary {
  messages: Message[];
}

export interface SendMessageResponse {
  userMessage: Message;
  assistantMessage: Message;
}

export interface Health {
  provider: 'gemini' | 'openrouter' | null;
  model: string | null;
  llm: string;
  error: string | null;
}

export type SendMessageStreamEvent =
  | { type: 'status'; status: 'answering' }
  | { type: 'chunk'; content: string }
  | ({ type: 'done' } & SendMessageResponse)
  | { type: 'error'; error: string };

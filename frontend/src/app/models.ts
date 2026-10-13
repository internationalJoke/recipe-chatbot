export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';
export type MessageStatus = 'PENDING' | 'COMPLETE' | 'FAILED';
export type ShoppingListStatus = 'PROPOSED' | 'ACCEPTED' | 'DECLINED';

export interface Attachment {
  id: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  /** Local blob URL shown while the message is still uploading. */
  previewUrl?: string;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  note?: string;
  searchTerm?: string;
  /** The user likely has it already, so it starts unticked. */
  have?: boolean;
}

export type StoreId = 'willys' | 'hemkop';

export interface OrderLine {
  itemId: string;
  /** Ingredient name and size; missing on plans saved before they existed. */
  name?: string;
  size?: string;
  requested: string;
  store: StoreId;
  storeName: string;
  product: string;
  amountLabel: string;
  lineTotalCents: number;
  url: string;
}

export interface StoreOffer {
  product: string;
  amountLabel: string;
  costCents: number;
  url: string;
}

export interface PriceComparison {
  currency: string;
  /** Missing on comparisons saved before dates were recorded. */
  comparedAt?: string;
  items: { itemId: string; name: string; offers: Partial<Record<StoreId, StoreOffer>> }[];
  stores: { store: StoreId; name: string; totalCents: number; missing: string[] }[];
  mix: { totalCents: number; missing: string[]; storesUsed: StoreId[] };
  recommendation: { plan: StoreId | 'mix'; label: string; totalCents: number; reason: string };
}

export interface Order {
  id: string;
  store: string;
  lines: OrderLine[];
  missing: string[];
  totalCents: number;
  currency: string;
  comparison?: PriceComparison | null;
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
  toolActivity?: ToolActivity[] | null;
  dishes?: Dish[] | null;
  selectedDishIds?: string[] | null;
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

export interface ToolActivity {
  tool: string;
  query?: string;
  sources: { title: string; url: string }[];
  error?: string;
}

export interface Dish {
  id: string;
  name: string;
  summary: string;
  servings?: number;
  minutes?: number;
  ingredients: { name: string; quantity?: number; unit?: string; have?: boolean }[];
  steps?: string[];
  imageUrl: string | null;
  /** Set for recipes from the recipe database. */
  recipeId?: number;
  missing?: string[];
}

export type StreamStatus = 'answering' | 'searching' | 'listing' | 'dishes' | 'using_tool';

export type SendMessageStreamEvent =
  | { type: 'status'; status: StreamStatus; query?: string }
  | { type: 'chunk'; content: string }
  | ({ type: 'done' } & SendMessageResponse)
  | { type: 'error'; error: string; code?: 'text_only' };

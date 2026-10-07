import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ChatService, ChatStreamError } from './chat.service';
import {
  Attachment,
  Conversation,
  ConversationSummary,
  Health,
  Message,
  ShoppingList,
} from './models';
import { FridgeCartoon } from './fridge-cartoon';
import { ShoppingListCard } from './shopping-list-card';

// The model's machine-readable list is hidden while it streams; the server strips it on save.
const LIST_TAG = '<shopping_list>';
const STOP_RELOAD_DELAY_MS = 800;

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, ShoppingListCard, FridgeCartoon],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly chat = inject(ChatService);

  @ViewChild('messageList') private messageList?: ElementRef<HTMLElement>;
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  readonly conversations = signal<ConversationSummary[]>([]);
  readonly activeConversation = signal<Conversation | null>(null);
  readonly selectedFiles = signal<File[]>([]);
  readonly loading = signal(false);
  readonly streaming = signal(false);
  readonly thinkingStatus = signal('Thinking…');
  readonly sidebarOpen = signal(false);
  readonly error = signal('');
  readonly health = signal<Health | null>(null);
  readonly viewedImage = signal<Attachment | null>(null);
  prompt = '';
  private abortController: AbortController | null = null;

  async ngOnInit() {
    void this.chat.health().then((health) => this.health.set(health));
    await this.refreshConversations();
    const first = this.conversations()[0];
    if (first) await this.selectConversation(first.id);
  }

  async refreshConversations() {
    try {
      this.conversations.set(await firstValueFrom(this.chat.listConversations()));
    } catch (error) {
      this.showError(error, 'Could not load conversation history.');
    }
  }

  async selectConversation(id: string) {
    if (this.loading()) return;
    this.error.set('');
    try {
      this.activeConversation.set(await firstValueFrom(this.chat.getConversation(id)));
      this.sidebarOpen.set(false);
      this.scrollToBottom();
    } catch (error) {
      this.showError(error, 'Could not open this conversation.');
    }
  }

  newConversation() {
    if (this.loading()) return;
    this.activeConversation.set(null);
    this.prompt = '';
    this.clearFiles();
    this.error.set('');
    this.sidebarOpen.set(false);
    this.messageList?.nativeElement.scrollTo({ top: 0 });
  }

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []).slice(0, 4);
    this.selectedFiles.set(files);
    input.value = '';
  }

  onPaste(event: ClipboardEvent) {
    const pastedImages = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (pastedImages.length === 0) return;

    event.preventDefault();
    const availableSlots = 4 - this.selectedFiles().length;
    const acceptedImages = pastedImages
      .filter((file) => file.size <= 10 * 1024 * 1024)
      .slice(0, Math.max(availableSlots, 0));

    if (acceptedImages.length === 0) {
      this.error.set(
        availableSlots <= 0
          ? 'You can attach at most 4 files.'
          : 'Pasted images must be 10 MB or smaller.',
      );
      return;
    }

    this.selectedFiles.update((files) => [...files, ...acceptedImages]);
    this.error.set(
      acceptedImages.length < pastedImages.length
        ? 'Some pasted images were skipped because of the file count or size limit.'
        : '',
    );
  }

  removeFile(index: number) {
    this.selectedFiles.update((files) => files.filter((_, current) => current !== index));
  }

  clearFiles() {
    this.selectedFiles.set([]);
    if (this.fileInput) this.fileInput.nativeElement.value = '';
  }

  modelLabel() {
    const health = this.health();
    if (!health) return 'Model offline';
    return health.model ? `${health.provider} · ${health.model}` : 'Model not configured';
  }

  onListChanged(messageId: string, list: ShoppingList) {
    this.activeConversation.update((conversation) =>
      conversation
        ? {
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id === messageId ? { ...message, shoppingList: list } : message,
            ),
          }
        : conversation,
    );
  }

  messageParts(raw: string): { text: string; url?: string }[] {
    const tagAt = raw.indexOf(LIST_TAG);
    const content = tagAt === -1 ? raw : raw.slice(0, tagAt).trimEnd();
    const parts: { text: string; url?: string }[] = [];
    const urlPattern = /https:\/\/[^\s]+/g;
    let offset = 0;
    for (const match of content.matchAll(urlPattern)) {
      if (match.index > offset) parts.push({ text: content.slice(offset, match.index) });
      parts.push({ text: match[0], url: match[0] });
      offset = match.index + match[0].length;
    }
    if (offset < content.length) parts.push({ text: content.slice(offset) });
    return parts;
  }

  async sendMessage() {
    const content = this.prompt.trim();
    const files = this.selectedFiles();
    if (this.loading() || (!content && files.length === 0)) return;

    let resendTextOnly = false;
    const abortController = new AbortController();
    this.abortController = abortController;
    this.loading.set(true);
    this.error.set('');
    this.thinkingStatus.set(
      files.some((file) => this.isImage(file.type)) ? 'I’m working on it…' : 'Thinking…',
    );
    // Show the user's files right away; the server copy replaces them after the reply.
    const previews = files.map((file, index) => ({
      id: `pending-file-${index}`,
      originalName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      previewUrl: URL.createObjectURL(file),
    }));
    const releasePreviews = () =>
      previews.forEach((preview) => URL.revokeObjectURL(preview.previewUrl));

    try {
      let conversationId = this.activeConversation()?.id;
      if (!conversationId) {
        const conversation = await firstValueFrom(this.chat.createConversation());
        conversationId = conversation.id;
        this.activeConversation.set({ ...conversation, messages: [] });
      }

      this.prompt = '';
      this.clearFiles();
      const requestId = Date.now();
      const optimisticMessage: Message = {
        id: `pending-user-${requestId}`,
        conversationId,
        role: 'USER',
        content,
        status: 'COMPLETE',
        attachments: previews,
        createdAt: new Date().toISOString(),
      };
      this.activeConversation.update((conversation) =>
        conversation
          ? { ...conversation, messages: [...conversation.messages, optimisticMessage] }
          : conversation,
      );
      this.scrollToBottom();

      const streamingMessageId = `pending-assistant-${requestId}`;
      await this.chat.sendMessage(
        conversationId,
        content,
        files,
        (chunk) => {
          this.streaming.set(true);
          this.activeConversation.update((conversation) => {
            if (!conversation || conversation.id !== conversationId) return conversation;

            const existingMessage = conversation.messages.find(
              (message) => message.id === streamingMessageId,
            );
            if (!existingMessage) {
              const streamingMessage: Message = {
                id: streamingMessageId,
                conversationId,
                role: 'ASSISTANT',
                content: chunk,
                status: 'PENDING',
                attachments: [],
                createdAt: new Date().toISOString(),
              };
              return { ...conversation, messages: [...conversation.messages, streamingMessage] };
            }

            return {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === streamingMessageId
                  ? { ...message, content: message.content + chunk }
                  : message,
              ),
            };
          });
          this.scrollToBottom();
        },
        abortController.signal,
      );
      this.activeConversation.set(await firstValueFrom(this.chat.getConversation(conversationId)));
      releasePreviews();
      await this.refreshConversations();
      this.scrollToBottom();
    } catch (error) {
      if (abortController.signal.aborted) {
        this.finishStoppedAnswer();
        return;
      }
      if (error instanceof ChatStreamError && error.code === 'text_only') {
        resendTextOnly = await this.dropImagesAfterTextOnlyError(content, files);
        releasePreviews();
        return;
      }
      this.prompt = content;
      this.selectedFiles.set(files);
      this.showError(error, 'The assistant could not answer. Check the backend and your API key.');
    } finally {
      if (this.abortController === abortController) this.abortController = null;
      this.loading.set(false);
      this.streaming.set(false);
      this.thinkingStatus.set('Thinking…');
      if (resendTextOnly) void this.resendWithNotice();
    }
  }

  stop() {
    this.abortController?.abort();
  }

  // Keep the partial answer on screen. The backend saves it after it notices the
  // closed connection, so reload a moment later to pick up the stored version.
  private finishStoppedAnswer() {
    this.activeConversation.update((conversation) =>
      conversation
        ? {
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.status === 'PENDING' ? { ...message, status: 'COMPLETE' } : message,
            ),
          }
        : conversation,
    );
    const conversationId = this.activeConversation()?.id;
    if (!conversationId) return;
    setTimeout(async () => {
      if (this.loading() || this.activeConversation()?.id !== conversationId) return;
      try {
        this.activeConversation.set(
          await firstValueFrom(this.chat.getConversation(conversationId)),
        );
        await this.refreshConversations();
      } catch {
        // The local view is already fine; the next send reloads anyway.
      }
    }, STOP_RELOAD_DELAY_MS);
  }

  // Resend the text, then show the notice unless the resend hit a different error.
  private async resendWithNotice() {
    const notice = this.error();
    await this.sendMessage();
    if (!this.error()) this.error.set(notice);
  }

  // The backend already deleted the image message. Remove the photos here too and,
  // if any text or text files are left, send them again automatically.
  private async dropImagesAfterTextOnlyError(content: string, files: File[]) {
    const textFiles = files.filter((file) => !this.isImage(file.type));
    this.prompt = content;
    this.selectedFiles.set(textFiles);

    const conversationId = this.activeConversation()?.id;
    if (conversationId) {
      try {
        this.activeConversation.set(
          await firstValueFrom(this.chat.getConversation(conversationId)),
        );
      } catch {
        // Keep the current view; the resend below reloads it anyway.
      }
    }

    const canResend = Boolean(content) || textFiles.length > 0;
    this.error.set(
      canResend
        ? 'This model supports text only. The image was removed and your text was sent.'
        : 'This model supports text only. The image was removed — please type a message.',
    );
    return canResend;
  }

  onComposerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.sendMessage();
    }
  }

  async deleteConversation(event: Event, id: string) {
    event.stopPropagation();
    if (this.loading() || !window.confirm('Delete this conversation and its uploaded files?'))
      return;

    try {
      await firstValueFrom(this.chat.deleteConversation(id));
      if (this.activeConversation()?.id === id) this.activeConversation.set(null);
      await this.refreshConversations();
    } catch (error) {
      this.showError(error, 'Could not delete this conversation.');
    }
  }

  openImage(attachment: Attachment) {
    this.viewedImage.set(attachment);
  }

  closeImage() {
    this.viewedImage.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closeImage();
  }

  attachmentUrl(attachment: Attachment) {
    return attachment.previewUrl ?? this.chat.attachmentUrl(attachment.id);
  }

  isImage(mimeType: string) {
    return mimeType.startsWith('image/');
  }

  formatDate(value: string) {
    const date = new Date(value);
    const today = new Date();
    return date.toDateString() === today.toDateString()
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  private scrollToBottom() {
    setTimeout(() => {
      this.messageList?.nativeElement.scrollTo({
        top: this.messageList.nativeElement.scrollHeight,
        behavior: 'smooth',
      });
    });
  }

  private showError(error: unknown, fallback: string) {
    const apiMessage = error instanceof HttpErrorResponse ? error.error?.error : undefined;
    const streamMessage = error instanceof Error ? error.message : undefined;
    this.error.set(typeof apiMessage === 'string' ? apiMessage : streamMessage || fallback);
  }
}

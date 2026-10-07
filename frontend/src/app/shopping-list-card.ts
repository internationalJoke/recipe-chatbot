import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ChatService } from './chat.service';
import { ShoppingList } from './models';

@Component({
  selector: 'app-shopping-list-card',
  templateUrl: './shopping-list-card.html',
  styleUrl: './shopping-list-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShoppingListCard {
  private readonly chat = inject(ChatService);

  readonly list = input.required<ShoppingList>();
  readonly changed = output<ShoppingList>();

  // Item ids the user unticked. Everything is selected by default.
  private readonly excluded = signal<ReadonlySet<string>>(new Set());
  readonly busy = signal(false);
  readonly error = signal('');

  readonly selectedCount = computed(
    () => this.list().items.filter((item) => !this.excluded().has(item.id)).length,
  );

  isSelected(id: string) {
    return !this.excluded().has(id);
  }

  toggle(id: string) {
    this.excluded.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async accept() {
    const itemIds = this.list()
      .items.filter((item) => this.isSelected(item.id))
      .map((item) => item.id);
    if (itemIds.length === 0) return;
    await this.run(() => firstValueFrom(this.chat.acceptShoppingList(this.list().id, itemIds)));
  }

  async decline() {
    await this.run(() => firstValueFrom(this.chat.declineShoppingList(this.list().id)));
  }

  money(cents: number, currency: string) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  }

  private async run(action: () => Promise<ShoppingList>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.changed.emit(await action());
    } catch (error) {
      const apiMessage = error instanceof HttpErrorResponse ? error.error?.error : undefined;
      this.error.set(typeof apiMessage === 'string' ? apiMessage : 'Could not reach the market. Try again.');
    } finally {
      this.busy.set(false);
    }
  }
}

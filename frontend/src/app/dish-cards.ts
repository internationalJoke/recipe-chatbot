import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { Dish } from './models';

// Dish ideas side by side: photo, facts, ingredients, and a pick toggle. The user can pick
// several dishes, then one button builds the shopping list for all of them.
@Component({
  selector: 'app-dish-cards',
  templateUrl: './dish-cards.html',
  styleUrl: './dish-cards.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DishCards {
  readonly dishes = input.required<Dish[]>();
  /** Dishes saved as picked on the server. */
  readonly selectedIds = input<readonly string[] | null | undefined>([]);
  readonly disabled = input(false);
  /** The shopping list for the pick is being built. */
  readonly busy = input(false);
  readonly chosen = output<string[]>();

  /** The current pick; starts from the saved one and changes as the user toggles cards. */
  readonly picked = linkedSignal<ReadonlySet<string>>(() => new Set(this.selectedIds() ?? []));

  readonly saved = computed(() => {
    const saved = this.selectedIds() ?? [];
    const picked = this.picked();
    return saved.length > 0 && saved.length === picked.size && saved.every((id) => picked.has(id));
  });

  /** Photos that failed to load fall back to the drawn placeholder. */
  readonly brokenImages = signal<ReadonlySet<string>>(new Set());

  toggle(id: string) {
    this.picked.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  submit() {
    // Keep the cards' order, not the order they were clicked.
    const ids = this.dishes()
      .map((dish) => dish.id)
      .filter((id) => this.picked().has(id));
    if (ids.length > 0) this.chosen.emit(ids);
  }

  submitLabel() {
    const count = this.picked().size;
    if (this.busy()) return 'Building your shopping list…';
    if (this.saved()) return 'Shopping list ready';
    if (count === 0) return 'Pick one or more dishes';
    return count === 1 ? 'Make this dish' : `Make these ${count} dishes`;
  }

  onImageError(id: string) {
    this.brokenImages.update((current) => new Set(current).add(id));
  }

  hasPhoto(dish: Dish) {
    return Boolean(dish.imageUrl) && !this.brokenImages().has(dish.id);
  }

  amount(ingredient: Dish['ingredients'][number]) {
    return [ingredient.quantity, ingredient.unit].filter((part) => part !== undefined && part !== '').join(' ');
  }
}

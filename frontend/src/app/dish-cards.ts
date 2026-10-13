import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { Dish } from './models';

// Dish ideas side by side: photo, facts, ingredients, and a "Make this" button.
@Component({
  selector: 'app-dish-cards',
  templateUrl: './dish-cards.html',
  styleUrl: './dish-cards.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DishCards {
  readonly dishes = input.required<Dish[]>();
  readonly selectedId = input<string | null | undefined>(null);
  readonly disabled = input(false);
  readonly chosen = output<Dish>();

  /** Photos that failed to load fall back to the drawn placeholder. */
  readonly brokenImages = signal<ReadonlySet<string>>(new Set());

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

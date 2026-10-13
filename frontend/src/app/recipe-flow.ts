import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { DishCards } from './dish-cards';
import { Message, ShoppingList } from './models';
import { ShoppingListCard } from './shopping-list-card';

export type FlowStep = 'recipes' | 'list' | 'prices';

const STEPS: FlowStep[] = ['recipes', 'list', 'prices'];
// A horizontal swipe must be at least this long, and wider than it is tall, to change tabs.
const SWIPE_MIN_PX = 50;

/** The step a reply has reached: recipes until a list exists, then the list, then prices. */
export function currentStep(message: Pick<Message, 'shoppingList'>): FlowStep {
  if (message.shoppingList?.status === 'ACCEPTED') return 'prices';
  return message.shoppingList ? 'list' : 'recipes';
}

// A recipe reply as three tabs: pick recipes, check the shopping list, compare prices.
// It moves to the next tab when a step is done; the user can go back by tab, arrow key, or swipe.
@Component({
  selector: 'app-recipe-flow',
  imports: [DishCards, ShoppingListCard],
  templateUrl: './recipe-flow.html',
  styleUrl: './recipe-flow.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeFlow {
  readonly message = input.required<Message>();
  readonly disabled = input(false);
  readonly busy = input(false);
  readonly chosen = output<string[]>();
  readonly listChanged = output<ShoppingList>();

  readonly reached = computed(() => currentStep(this.message()));
  /**
   * Follows the reached step, so finishing a step opens the next tab; clicks override it.
   * A new list (the user picked again) also counts, since its items get new ids.
   */
  private readonly progress = computed(() => {
    const items = this.message().shoppingList?.items.map((item) => item.id).join(',') ?? '';
    return `${this.reached()}|${items}`;
  });
  readonly active = linkedSignal<string, FlowStep>({ source: this.progress, computation: () => this.reached() });

  private swipeStart: { x: number; y: number } | null = null;

  enabled(step: FlowStep) {
    return STEPS.indexOf(step) <= STEPS.indexOf(this.reached());
  }

  open(step: FlowStep) {
    if (this.enabled(step)) this.active.set(step);
  }

  move(by: number) {
    const next = STEPS[STEPS.indexOf(this.active()) + by];
    if (next) this.open(next);
  }

  onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') this.move(1);
    else if (event.key === 'ArrowLeft') this.move(-1);
    else return;
    event.preventDefault();
  }

  onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'touch') this.swipeStart = { x: event.clientX, y: event.clientY };
  }

  onPointerUp(event: PointerEvent) {
    const start = this.swipeStart;
    this.swipeStart = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) this.move(dx < 0 ? 1 : -1);
  }

  listLabel() {
    const count = this.message().shoppingList?.items.length;
    return count ? `Shopping list · ${count}` : 'Shopping list';
  }

  pricesLabel() {
    const cmp = this.message().shoppingList?.order?.comparison;
    if (!cmp) return 'Prices';
    const total = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: cmp.currency }).format(
      cmp.recommendation.totalCents / 100,
    );
    return `Prices · ${total}`;
  }
}

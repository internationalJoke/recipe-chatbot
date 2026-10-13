import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ChatService } from './chat.service';
import { currentLocation, prefetchLocation } from './location';
import { Order, OrderLine, ShoppingItem, ShoppingList, StoreId } from './models';
import { STORE_BRANDS } from './store-logos';

const STORE_ORDER: StoreId[] = ['willys', 'hemkop'];

@Component({
  selector: 'app-shopping-list-card',
  templateUrl: './shopping-list-card.html',
  styleUrl: './shopping-list-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShoppingListCard {
  private readonly chat = inject(ChatService);

  readonly list = input.required<ShoppingList>();
  /** 'list' shows only the items, 'prices' only the comparison; 'all' shows whichever fits the status. */
  readonly view = input<'all' | 'list' | 'prices'>('all');
  readonly changed = output<ShoppingList>();

  // Item ids the user flipped. Items start ticked, except ones the user likely has already.
  private readonly flipped = signal<ReadonlySet<string>>(new Set());

  constructor() {
    // A list waiting for Compare: get the location ready if the user already allowed it.
    effect(() => {
      if (this.list().status === 'PROPOSED') void prefetchLocation();
    });
  }
  readonly busy = signal(false);
  /** Waiting for the browser's location before prices are checked. */
  readonly locating = signal(false);
  readonly error = signal('');

  readonly selectedCount = computed(() => this.list().items.filter((item) => this.isSelected(item.id)).length);

  /** Items the user already has are hidden; they can be shown to tick one back in. */
  readonly showHave = signal(false);
  readonly haveCount = computed(() => this.list().items.filter((item) => item.have).length);
  readonly visibleItems = computed(() => {
    const items = this.list().items;
    if (this.list().status !== 'PROPOSED' || this.showHave()) return items;
    // Keep an item visible if the user ticked it back in.
    return items.filter((item) => !item.have || this.isSelected(item.id));
  });

  isSelected(id: string) {
    const startsTicked = !this.list().items.find((item) => item.id === id)?.have;
    return this.flipped().has(id) ? !startsTicked : startsTicked;
  }

  toggle(id: string) {
    this.flipped.update((current) => {
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
    await this.run(async () => {
      this.locating.set(true);
      const location = await currentLocation().finally(() => this.locating.set(false));
      return firstValueFrom(this.chat.acceptShoppingList(this.list().id, itemIds, location));
    });
  }

  async decline() {
    await this.run(() => firstValueFrom(this.chat.declineShoppingList(this.list().id)));
  }

  /** Logos that failed to load; those stores show a text badge instead. */
  readonly brokenLogos = signal<ReadonlySet<StoreId>>(new Set());

  brand(store: StoreId) {
    return STORE_BRANDS[store];
  }

  onLogoError(store: StoreId) {
    this.brokenLogos.update((current) => new Set(current).add(store));
  }

  /** One list per store, always both stores side by side; a store may have nothing to buy. */
  storeGroups(order: Order) {
    return STORE_ORDER.map((store) => {
      const lines: OrderLine[] = order.lines.filter((line) => line.store === store);
      return { store, lines, totalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0) };
    });
  }

  /** Items the user kept ticked when comparing prices; the rest were unticked. */
  acceptedIds(order: Order): ReadonlySet<string> {
    const ids = order.comparison?.items.map((row) => row.itemId) ?? order.lines.map((line) => line.itemId);
    return new Set(ids);
  }

  /**
   * The store near the user whose prices were used: place ("Stockholm Skarpnäck", the logo
   * already says the chain), distance, and a map link. Only stores with an online shop have
   * prices, so `skipped` says when a closer one had to be passed over.
   */
  branchInfo(order: Order, store: StoreId) {
    const branch = order.comparison?.stores.find((s) => s.store === store)?.branch;
    if (!branch) return null;
    const chain = STORE_BRANDS[store].name;
    const place = branch.name.startsWith(chain) ? branch.name.slice(chain.length).trim() || branch.name : branch.name;
    const km = branch.distanceKm < 10 ? branch.distanceKm.toFixed(1).replace('.', ',') : Math.round(branch.distanceKm).toString();
    return {
      name: branch.name,
      place,
      km: `${km} km`,
      skipped: Boolean(branch.closerWithoutPrices),
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.name)}`,
    };
  }

  /** True when at least one store's prices are from a store near the user. */
  usedNearby(order: Order) {
    return Boolean(order.comparison?.stores.some((s) => s.branch));
  }

  pickedStore(order: Order, itemId: string): StoreId | undefined {
    return order.lines.find((line) => line.itemId === itemId)?.store;
  }

  /** English name, e.g. "Garlic". The Swedish search word is only used to find store products. */
  displayName(item: ShoppingItem) {
    return item.name.charAt(0).toUpperCase() + item.name.slice(1);
  }

  /** Store sizes in Swedish style: "60g" → "60 g", "≈0.16 kg" → "≈0,16 kg", "10p" → "10 st". */
  swedishSize(size: string) {
    return size
      .replace(/(\d)\.(\d)/g, '$1,$2')
      .replace(/(\d)\s*(kg|hg|g|ml|cl|dl|l)\b/gi, '$1 $2')
      .replace(/(\d)\s*-?p\b/gi, '$1 st');
  }

  /** e.g. "9 Oct 2026, 11:45" — prices change often, so the card says when they were fetched. */
  when(iso: string) {
    const date = new Date(iso);
    const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${day}, ${time}`;
  }

  money(cents: number, currency: string) {
    return new Intl.NumberFormat('sv-SE', { style: 'currency', currency }).format(cents / 100);
  }

  private async run(action: () => Promise<ShoppingList>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.changed.emit(await action());
    } catch (error) {
      const apiMessage = error instanceof HttpErrorResponse ? error.error?.error : undefined;
      this.error.set(typeof apiMessage === 'string' ? apiMessage : 'Could not check prices. Try again.');
    } finally {
      this.busy.set(false);
    }
  }
}

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { currentLocation } from './location';
import { HelperStatus, ShopId, ShopView } from './models';
import { ShopHelperService } from './shop-helper.service';
import { STORE_BRANDS } from './store-logos';

const POLL_MS = 1_000;
const ICA_BRAND = { name: 'ICA', color: '#e3000b', homeUrl: 'https://www.ica.se/handla' };

// Compares the list at Willys, Hemköp and ICA through the local shop helper, then fills the cart at
// the shop the user picks. Logins and carts happen in the helper's Chrome window; nothing is ordered.
@Component({
  selector: 'app-store-picker',
  templateUrl: './store-picker.html',
  styleUrl: './store-picker.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorePicker {
  private readonly helper = inject(ShopHelperService);

  readonly listId = input.required<string>();
  /** Whether the helper is running; the page then shows only this panel's prices. */
  readonly available = output<boolean>();

  readonly status = signal<HelperStatus | null>(null);
  /** The helper is not running on this computer. */
  readonly offline = signal(false);
  readonly error = signal('');
  readonly postcode = signal('');
  readonly starting = signal(false);

  /** The helper's status, only when it is about this list. */
  readonly mine = computed(() => {
    const status = this.status();
    return status && status.shoppingListId === this.listId() ? status : null;
  });
  readonly running = computed(() => {
    const phase = this.mine()?.phase;
    return this.starting() || phase === 'working' || phase === 'waiting';
  });
  /** The cheapest shop that has every item; the one to recommend. */
  readonly cheapest = computed(() => this.mine()?.shops.find((shop) => shop.missing.length === 0)?.shop ?? null);

  constructor() {
    effect(() => this.available.emit(!this.offline() && this.status() !== null));
    effect(() => {
      const area = this.status()?.area;
      if (area) this.helper.area.set(area);
    });
    void this.refresh();
    const timer = setInterval(() => {
      if (this.running()) void this.refresh();
    }, POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  async refresh() {
    try {
      this.status.set(await firstValueFrom(this.helper.status()));
      this.offline.set(false);
    } catch {
      this.offline.set(true);
    }
  }

  /** The list is in one shop's cart; the buy buttons stay off until the user compares again. */
  readonly filledShop = computed(() => {
    const cart = this.mine()?.cart;
    return cart && !cart.skipped ? cart.shop : null;
  });

  async compare() {
    this.starting.set(true);
    this.error.set('');
    try {
      const postcode = this.postcode().trim() || null;
      // A typed postcode wins; otherwise the browser's location, like the price check above.
      const location = postcode ? null : await currentLocation();
      this.status.set(await firstValueFrom(this.helper.compare(this.listId(), location, postcode)));
    } catch (error) {
      this.fail(error);
    } finally {
      this.starting.set(false);
    }
  }

  async answer(skip: boolean) {
    await this.call(() => firstValueFrom(this.helper.answer(skip)));
  }

  async buy(shop: ShopId) {
    await this.call(() => firstValueFrom(this.helper.buy(shop)));
  }

  brand(shop: ShopId) {
    return shop === 'ica' ? { ...ICA_BRAND, logoUrl: null } : STORE_BRANDS[shop];
  }

  /** "ICA Folkes Livs" → "Folkes Livs": the logo already names the chain. */
  place(view: ShopView) {
    if (!view.storeName) return 'Online prices';
    const name = view.storeName.startsWith(view.name) ? view.storeName.slice(view.name.length).trim() : view.storeName;
    return name || view.storeName;
  }

  itemCount(view: ShopView) {
    return view.lines.length + view.missing.length;
  }

  /** Store sizes in Swedish style: "0.35kg" → "350 g", "1kg" → "1 kg", "ca400g" → "ca 400 g". */
  size(text: string) {
    const grams = /^(?:≈)?0[.,](\d+)\s*kg$/i.exec(text.trim());
    if (grams) return `${Math.round(Number(`0.${grams[1]}`) * 1000)} g`;
    return text
      .replace(/(\d)\.(\d)/g, '$1,$2')
      .replace(/([a-z])(\d)/gi, '$1 $2')
      .replace(/(\d)\s*(kg|hg|g|ml|cl|dl|l)\b/gi, '$1 $2');
  }

  km(view: ShopView) {
    return view.distanceKm === null ? null : `${view.distanceKm.toFixed(1).replace('.', ',')} km`;
  }

  money(cents: number) {
    return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(cents / 100);
  }

  private async call(action: () => Promise<HelperStatus>) {
    this.error.set('');
    try {
      this.status.set(await action());
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown) {
    if (error instanceof HttpErrorResponse && error.status === 0) {
      this.offline.set(true);
      return;
    }
    const message = error instanceof HttpErrorResponse ? error.error?.error : undefined;
    this.error.set(typeof message === 'string' ? message : 'The shop helper did not answer. Try again.');
  }
}

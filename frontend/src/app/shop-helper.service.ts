import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { GeoPoint } from './location';
import { HelperStatus, Place, ShopId } from './models';

// Talks to the shop helper running on this computer (`npm run shop:helper` in backend/). It drives a
// visible Chrome window, because BankID logins and store carts cannot live inside our page.
@Injectable({ providedIn: 'root' })
export class ShopHelperService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:3200';
  /** Where the last price check searched for stores; the header shows it. */
  readonly area = signal<Place | null>(null);

  status() {
    return this.http.get<HelperStatus>(`${this.baseUrl}/status`);
  }

  compare(shoppingListId: string, location: GeoPoint | null, postcode: string | null) {
    return this.http.post<HelperStatus>(`${this.baseUrl}/compare`, { shoppingListId, location, postcode });
  }

  /** Answers the helper's question: done (e.g. logged in) or skip that shop. */
  answer(skip: boolean) {
    return this.http.post<HelperStatus>(`${this.baseUrl}/continue`, { skip });
  }

  buy(shop: ShopId) {
    return this.http.post<HelperStatus>(`${this.baseUrl}/buy`, { shop });
  }
}

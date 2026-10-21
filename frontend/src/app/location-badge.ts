import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { currentCity, locationAllowed } from './location';
import { ShopHelperService } from './shop-helper.service';

// Where stores are searched, in the header, e.g. "📍 Uppsala · 75230". After a price check it shows
// the place the helper searched near (a typed postcode wins); before that, the browser's city,
// which is what the helper uses when no postcode is typed. Asks for location only when clicked,
// unless the user already allowed it.
@Component({
  selector: 'app-location-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .badge { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface, #fff); color: inherit; font: 600 13px/1 inherit; white-space: nowrap; }
      button.badge { cursor: pointer; }
      button.badge:hover { border-color: var(--orange); }
      .muted { opacity: .6; }
    `,
  ],
  template: `
    @if (label(); as label) {
      <span class="badge" [title]="'Stores are searched near ' + label">📍 {{ label }}</span>
    } @else {
      @switch (state()) {
        @case ('looking') {
          <span class="badge muted">📍 Finding your city…</span>
        }
        @case ('unknown') {
          <button type="button" class="badge muted" (click)="locate()" title="Try again">📍 Location unavailable</button>
        }
        @default {
          <button type="button" class="badge" (click)="locate()">📍 Show my city</button>
        }
      }
    }
  `,
})
export class LocationBadge implements OnInit {
  private readonly helper = inject(ShopHelperService);
  readonly state = signal<'idle' | 'looking' | 'unknown'>('idle');
  private readonly browserCity = signal<string | null>(null);

  readonly label = computed(() => {
    const area = this.helper.area();
    if (area?.city || area?.postcode) return [area.city, area.postcode].filter(Boolean).join(' · ');
    return this.browserCity();
  });

  async ngOnInit() {
    if (await locationAllowed()) await this.locate();
  }

  async locate() {
    this.state.set('looking');
    const city = await currentCity();
    this.browserCity.set(city);
    this.state.set(city ? 'idle' : 'unknown');
  }
}

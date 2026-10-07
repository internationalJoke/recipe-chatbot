import { ChangeDetectionStrategy, Component, input } from '@angular/core';

// A puzzled cook in front of an open fridge. Pure SVG + CSS animation, no library.
@Component({
  selector: 'app-fridge-cartoon',
  templateUrl: './fridge-cartoon.html',
  styleUrl: './fridge-cartoon.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.small]': "size() === 'sm'", 'aria-hidden': 'true' },
})
export class FridgeCartoon {
  readonly size = input<'lg' | 'sm'>('lg');
}

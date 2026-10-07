import { ChangeDetectionStrategy, Component } from '@angular/core';

// App logo: a fridge crisper drawer full of fruit and veg. Pure SVG.
@Component({
  selector: 'app-produce-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  styles: [':host { display: block; width: 100%; height: 100%; } svg { display: block; width: 100%; height: 100%; }'],
  template: `
    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <!-- Drawer back -->
      <rect x="0" y="0" width="48" height="48" rx="13" fill="#eaf7e6" />
      <!-- Greens and pepper at the back -->
      <circle cx="11" cy="17" r="6" fill="#3f9b4b" />
      <circle cx="16" cy="13" r="5.5" fill="#52b05a" />
      <circle cx="7" cy="12" r="4.5" fill="#52b05a" />
      <path d="M31 9 q6 -1 9 4 q2 6 -2 11 q-4 3 -8 0 q-4 -5 -1 -12 Z" fill="#ef4b3f" />
      <path d="M33 8 q1 -4 4 -4" stroke="#2e7d3a" stroke-width="2" fill="none" stroke-linecap="round" />
      <!-- Fruit in front -->
      <ellipse cx="22" cy="24" rx="7.5" ry="5.5" fill="#ffd23f" transform="rotate(-20 22 24)" />
      <circle cx="12" cy="31" r="8" fill="#ff9f1c" />
      <circle cx="10" cy="28" r="1.6" fill="#ffc46b" />
      <circle cx="26" cy="33" r="7.5" fill="#e2483b" />
      <path d="M26 26 q1 -3 3 -3.5" stroke="#6b3f22" stroke-width="1.6" fill="none" stroke-linecap="round" />
      <circle cx="38" cy="31" r="7" fill="#7cc242" />
      <circle cx="36" cy="29" r="1.5" fill="#b4e07c" />
      <!-- Clear drawer front -->
      <rect x="2" y="30" width="44" height="16" rx="7" fill="#ffffff" fill-opacity="0.55" />
      <rect x="2" y="30" width="44" height="3" rx="1.5" fill="#ffffff" fill-opacity="0.9" />
      <rect x="18" y="36" width="12" height="3" rx="1.5" fill="#cfe3d2" />
    </svg>
  `,
})
export class ProduceLogo {}

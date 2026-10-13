import { StoreId } from './models';

// Logos are served by our backend, which saves them in the database (see lib/stores/logos.ts).
// Both are wordmarks of the same shape. If one fails to load, a colored text badge shows instead.
// Bump ?v= when the logo source changes, so browsers drop their cached copy.
export const STORE_BRANDS: Record<
  StoreId,
  { name: string; logoUrl: string; color: string; homeUrl: string; /** Logo already spells the name. */ wordmark: boolean }
> = {
  willys: {
    name: 'Willys',
    logoUrl: '/api/stores/willys/logo?v=2',
    color: '#d6202b',
    homeUrl: 'https://www.willys.se',
    wordmark: true,
  },
  hemkop: {
    name: 'Hemköp',
    logoUrl: '/api/stores/hemkop/logo?v=2',
    color: '#e2502b',
    homeUrl: 'https://www.hemkop.se',
    wordmark: true,
  },
};

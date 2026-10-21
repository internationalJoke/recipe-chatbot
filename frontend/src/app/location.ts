// The browser's location, used to pick the nearest stores and to show the city in the header. Null when the user
// says no, the browser has no location, or it takes too long; prices then use the default stores.
export type GeoPoint = { lat: number; lon: number };

const TIMEOUT_MS = 8_000;
const MAX_AGE_MS = 10 * 60 * 1000;

let early: Promise<GeoPoint | null> | null = null;

/**
 * Starts the lookup ahead of time, but only when the user already allowed location, so no
 * permission prompt appears before they click Compare. The first lookup can take seconds.
 */
export async function prefetchLocation() {
  if (early || typeof navigator === 'undefined' || !navigator.permissions) return;
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (status.state === 'granted' && !early) early = lookUp();
  } catch {
    // Permissions API not available: the lookup simply starts on click.
  }
}

/** The location, reusing an early lookup when there is one. */
export function currentLocation(): Promise<GeoPoint | null> {
  const pending = early;
  early = null;
  return pending ?? lookUp();
}

function lookUp(): Promise<GeoPoint | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
    );
  });
}

const CITY_URL = 'https://nominatim.openstreetmap.org/reverse';

/** True when the user already allowed location, so asking for it shows no prompt. */
export async function locationAllowed(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.permissions) return false;
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted';
  } catch {
    return false;
  }
}

/** The city or town at a point, e.g. "Uppsala", from OpenStreetMap's Nominatim; null if unknown. */
export async function cityAt(point: GeoPoint): Promise<string | null> {
  try {
    const url = `${CITY_URL}?lat=${point.lat}&lon=${point.lon}&format=json&zoom=10&accept-language=en`;
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const address = ((await response.json()) as { address?: Record<string, string> }).address ?? {};
    return address['city'] ?? address['town'] ?? address['village'] ?? address['municipality'] ?? null;
  } catch {
    return null;
  }
}

/** The user's city, for the header. Null when location is refused or the city is unknown. */
export async function currentCity(): Promise<string | null> {
  const point = await lookUp();
  return point ? cityAt(point) : null;
}

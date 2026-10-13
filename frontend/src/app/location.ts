// The browser's location, used only to pick the nearest Willys and Hemköp. Null when the user
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

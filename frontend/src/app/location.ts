// The browser's location, used only to pick the nearest Willys and Hemköp. Null when the user
// says no, the browser has no location, or it takes too long; prices then use the default stores.
export type GeoPoint = { lat: number; lon: number };

const TIMEOUT_MS = 8_000;
const MAX_AGE_MS = 10 * 60 * 1000;

export function currentLocation(): Promise<GeoPoint | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
    );
  });
}

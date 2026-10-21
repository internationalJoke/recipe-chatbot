import { z } from "zod";
import type { Location } from "@/lib/stores/branches";

// Postcode ↔ rough coordinates, to find the nearest stores.
// Uses OpenStreetMap's free Nominatim service (one request per run, as its usage policy asks).

const LOOKUP_URL = "https://nominatim.openstreetmap.org";
const TIMEOUT_MS = 10_000;

const searchSchema = z.array(z.object({ lat: z.coerce.number(), lon: z.coerce.number() }));
const reverseSchema = z.object({
  address: z.object({
    postcode: z.string().optional(),
    city: z.string().optional(),
    town: z.string().optional(),
    village: z.string().optional(),
    municipality: z.string().optional(),
  }),
});

export type Place = { postcode: string | null; city: string | null };

/** "753 20" → "75320"; null if it is not five digits. */
export function normalizePostcode(input: string): string | null {
  const digits = input.replace(/\s/g, "");
  return /^\d{5}$/.test(digits) ? digits : null;
}

async function lookup(path: string, fetchFn: typeof fetch): Promise<unknown> {
  try {
    const response = await fetchFn(`${LOOKUP_URL}/${path}`, {
      headers: { Accept: "application/json", "User-Agent": "RecipeBox course project (store finder)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function locatePostcode(postcode: string, fetchFn: typeof fetch = fetch): Promise<Location | null> {
  const parsed = searchSchema.safeParse(await lookup(`search?postalcode=${postcode}&country=se&format=json&limit=1`, fetchFn));
  const first = parsed.success ? parsed.data[0] : undefined;
  return first ? { lat: first.lat, lon: first.lon } : null;
}

/** The Swedish postcode and the city or town at a location, e.g. { postcode: "75230", city: "Uppsala" }. */
export async function placeAt(location: Location, fetchFn: typeof fetch = fetch): Promise<Place> {
  const path = `reverse?lat=${location.lat}&lon=${location.lon}&format=json&zoom=18&accept-language=en`;
  const parsed = reverseSchema.safeParse(await lookup(path, fetchFn));
  if (!parsed.success) return { postcode: null, city: null };
  const { postcode, city, town, village, municipality } = parsed.data.address;
  return { postcode: postcode ? normalizePostcode(postcode) : null, city: city ?? town ?? village ?? municipality ?? null };
}

/** The Swedish postcode at a location, e.g. "11120"; null if there is none. */
export async function postcodeAt(location: Location, fetchFn: typeof fetch = fetch): Promise<string | null> {
  return (await placeAt(location, fetchFn)).postcode;
}

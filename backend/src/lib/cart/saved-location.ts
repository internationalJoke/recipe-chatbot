import { z } from "zod";
import type { Location } from "@/lib/stores/branches";

// The rough location the web app saved when the user accepted a list (see checkout.ts).
// Only today's is used: people move, so yesterday's location may point to the wrong city.

const nearSchema = z.object({ near: z.object({ lat: z.number(), lon: z.number() }) });

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function savedLocationFromToday(order: { comparison: unknown; createdAt: Date } | null, now = new Date()): Location | null {
  if (!order || !sameDay(order.createdAt, now)) return null;
  const saved = nearSchema.safeParse(order.comparison);
  return saved.success ? saved.data.near : null;
}

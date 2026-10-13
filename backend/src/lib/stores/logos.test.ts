import { describe, expect, it, vi } from "vitest";
import { STORES, type StoreId } from "@/lib/stores/axfood";
import { downloadLogo, getStoreLogo, LOGO_MAX_AGE_MS, type Logo, type LogoStore } from "@/lib/stores/logos";

const png = (bytes = 10) => new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png" } });

function memoryDb(initial?: { mimeType: string; data: Uint8Array; fetchedAt: Date; sourceUrl: string }) {
  let row = initial ?? null;
  const saves: Logo[] = [];
  const db: LogoStore = {
    find: async () => row,
    save: async (_store: StoreId, logo: Logo, sourceUrl: string) => {
      saves.push(logo);
      row = { ...logo, fetchedAt: new Date(), sourceUrl };
    },
  };
  return { db, saves };
}

describe("getStoreLogo", () => {
  it("downloads once and then serves the saved copy", async () => {
    const { db, saves } = memoryDb();
    const fetchFn = vi.fn(async () => png());
    await getStoreLogo("willys", { db, fetchFn });
    const second = await getStoreLogo("willys", { db, fetchFn });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(saves).toHaveLength(1);
    expect(second?.mimeType).toBe("image/png");
  });

  it("refreshes an old logo, and keeps the old copy when the refresh fails", async () => {
    const old = { mimeType: "image/png", data: new Uint8Array([1]), fetchedAt: new Date(0), sourceUrl: STORES.hemkop.logoUrl };
    const { db } = memoryDb(old);
    const failing = vi.fn(async () => new Response("no", { status: 403 }));
    const result = await getStoreLogo("hemkop", { db, fetchFn: failing, now: () => LOGO_MAX_AGE_MS + 1 });
    expect(failing).toHaveBeenCalledOnce();
    expect(result).toBe(old);
  });

  it("downloads again when the logo source URL changed", async () => {
    const { db, saves } = memoryDb({ mimeType: "image/png", data: new Uint8Array([1]), fetchedAt: new Date(), sourceUrl: "https://old" });
    await getStoreLogo("willys", { db, fetchFn: async () => png() });
    expect(saves).toHaveLength(1);
  });

  it("returns null when there is no copy and the download fails", async () => {
    const { db } = memoryDb();
    expect(await getStoreLogo("willys", { db, fetchFn: async () => new Response("no", { status: 500 }) })).toBeNull();
  });
});

describe("downloadLogo", () => {
  it("rejects non-images and oversized files", async () => {
    await expect(downloadLogo("u", async () => new Response("<html>", { headers: { "Content-Type": "text/html" } }))).rejects.toThrow(/type/);
    await expect(downloadLogo("u", async () => png(300 * 1024))).rejects.toThrow(/size/);
    await expect(downloadLogo("u", async () => png())).resolves.toMatchObject({ mimeType: "image/png" });
  });
});

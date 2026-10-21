import { afterEach, describe, expect, it, vi } from "vitest";
import { clearBranchCache, distanceKm, nearestBranches, parseBranches, roughLocation } from "@/lib/stores/branches";
import { clearSessionCache, mergeCookies, storeSessionCookie } from "@/lib/stores/session";

const site = (storeId: string, name: string, latitude: number, longitude: number, onlineStore = true) => ({
  storeId,
  name,
  geoPoint: { latitude, longitude },
  address: { town: "Town" },
  onlineStore,
});

const UPPSALA = { lat: 59.8586, lon: 17.6389 };

afterEach(() => {
  clearBranchCache();
  clearSessionCache();
});

describe("branches", () => {
  it("measures distance on the earth", () => {
    expect(distanceKm({ lat: 59.3293, lon: 18.0686 }, UPPSALA)).toBeCloseTo(64, 0);
  });

  it("rounds a location to about a kilometre before it is saved", () => {
    expect(roughLocation({ lat: 59.332612, lon: 18.064911 })).toEqual({ lat: 59.33, lon: 18.06 });
  });

  it("skips stores without coordinates", () => {
    expect(parseBranches([site("1", "A", 59, 17), { storeId: "2", name: "B" }, null])).toHaveLength(1);
    expect(parseBranches({ nope: true })).toEqual([]);
  });

  it("returns the nearest stores first and caches the store list", async () => {
    const list = [site("far", "Willys Luleå", 65.58, 22.15), site("near", "Willys Uppsala", 59.85, 17.66), site("mid", "Willys Solna", 59.36, 18.0)];
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(list)));
    const nearest = await nearestBranches("willys", UPPSALA, 2, { fetchFn });
    expect(nearest.map((b) => b.id)).toEqual(["near", "mid"]);
    expect(nearest[0].distanceKm).toBeLessThan(2);
    expect(nearest[0].closerWithoutPrices).toBe(false);
    await nearestBranches("willys", UPPSALA, 2, { fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("stores without online prices", () => {
  it("are skipped, and the card can say a closer store had none", async () => {
    const list = [site("shop", "Hemköp Älvsjö", 59.85, 17.65, false), site("web", "Hemköp Skanstull", 59.36, 18.0)];
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(list)));
    const [nearest] = await nearestBranches("hemkop", UPPSALA, 3, { fetchFn });
    expect(nearest).toMatchObject({ id: "web", closerWithoutPrices: true });
  });
});

describe("store session", () => {
  const withCookie = (body: unknown, cookie?: string, status = 200) => {
    const headers = new Headers();
    if (cookie) headers.append("Set-Cookie", `${cookie}; Path=/; HttpOnly`);
    return new Response(JSON.stringify(body), { status, headers });
  };

  it("keeps the latest value of each cookie", () => {
    const jar = new Map<string, string>();
    mergeCookies(jar, withCookie({}, "JSESSIONID=a"));
    mergeCookies(jar, withCookie({}, "JSESSIONID=b"));
    expect(jar.get("JSESSIONID")).toBe("b");
  });

  it("activates the store with the CSRF token and the session cookie", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const path = new URL(String(url)).pathname;
      if (path === "/") return withCookie("", "JSESSIONID=s1");
      if (path.endsWith("/csrf-token")) return withCookie("tok");
      if (path.endsWith("/store/activate")) return withCookie({});
      return withCookie({ storeId: "2193" });
    });
    expect(await storeSessionCookie("willys", "2193", { fetchFn: fetchFn as typeof fetch })).toBe("JSESSIONID=s1");
    const activate = calls.find((c) => c.url.includes("/store/activate"))!;
    expect(activate.init?.method).toBe("POST");
    expect((activate.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok");
    expect((activate.init?.headers as Record<string, string>).Cookie).toBe("JSESSIONID=s1");
  });

  it("returns null when the site keeps another store active", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/csrf-token")) return withCookie("tok");
      if (path.endsWith("/store/active")) return withCookie({ storeId: "2110" });
      return withCookie({});
    });
    expect(await storeSessionCookie("hemkop", "4798", { fetchFn: fetchFn as typeof fetch })).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { locatePostcode, normalizePostcode, postcodeAt } from "@/lib/cart/postcode";

describe("normalizePostcode", () => {
  it("accepts five digits with or without a space", () => {
    expect(normalizePostcode("753 20")).toBe("75320");
    expect(normalizePostcode(" 75320 ")).toBe("75320");
  });

  it("rejects anything else", () => {
    expect(normalizePostcode("7532")).toBeNull();
    expect(normalizePostcode("abcde")).toBeNull();
    expect(normalizePostcode("")).toBeNull();
  });
});

describe("locatePostcode", () => {
  const reply = (body: unknown, ok = true) => vi.fn<typeof fetch>(async () => ({ ok, json: async () => body }) as Response);

  it("returns the postcode's coordinates", async () => {
    const fetchFn = reply([{ lat: "59.8590493", lon: "17.6395840" }]);
    await expect(locatePostcode("75320", fetchFn)).resolves.toEqual({ lat: 59.8590493, lon: 17.639584 });
    expect(String(fetchFn.mock.calls[0][0])).toContain("postalcode=75320");
  });

  it("returns null when the postcode is unknown or the lookup fails", async () => {
    await expect(locatePostcode("99999", reply([]))).resolves.toBeNull();
    await expect(locatePostcode("75320", reply(null, false))).resolves.toBeNull();
    await expect(locatePostcode("75320", vi.fn(async () => { throw new Error("offline"); }))).resolves.toBeNull();
  });
});

describe("postcodeAt", () => {
  const reply = (body: unknown, ok = true) => vi.fn<typeof fetch>(async () => ({ ok, json: async () => body }) as Response);

  it("returns the postcode at a location", async () => {
    const fetchFn = reply({ address: { postcode: "111 20", city: "Stockholm" } });
    await expect(postcodeAt({ lat: 59.33, lon: 18.06 }, fetchFn)).resolves.toBe("11120");
    expect(String(fetchFn.mock.calls[0][0])).toContain("reverse?lat=59.33&lon=18.06");
  });

  it("returns null when there is no Swedish postcode or the lookup fails", async () => {
    await expect(postcodeAt({ lat: 0, lon: 0 }, reply({ error: "Unable to geocode" }))).resolves.toBeNull();
    await expect(postcodeAt({ lat: 59, lon: 18 }, reply(null, false))).resolves.toBeNull();
    await expect(postcodeAt({ lat: 59, lon: 18 }, vi.fn<typeof fetch>(async () => { throw new Error("offline"); }))).resolves.toBeNull();
  });
});

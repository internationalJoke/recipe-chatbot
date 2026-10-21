import { describe, expect, it } from "vitest";
import { icaPageLoggedIn, isAxfoodCustomer, loginScreen } from "@/lib/cart/sessions";

describe("isAxfoodCustomer", () => {
  it("is true for a real customer and false for the anonymous session", () => {
    expect(isAxfoodCustomer({ uid: "a1b2c3", name: "Zhiping" })).toBe(true);
    expect(isAxfoodCustomer({ uid: "anonymous", name: "anonymous" })).toBe(false);
  });

  it("is false for anything unexpected", () => {
    expect(isAxfoodCustomer(null)).toBe(false);
    expect(isAxfoodCustomer({ uid: "" })).toBe(false);
    expect(isAxfoodCustomer("<html>")).toBe(false);
  });
});

describe("icaPageLoggedIn", () => {
  it("is false when ICA's page offers 'Logga in'", () => {
    expect(icaPageLoggedIn('<header><button class="x"><span>Logga in</span></button></header><main>ICA</main>')).toBe(false);
  });

  it("is true when ICA's page shows the user instead", () => {
    expect(icaPageLoggedIn('<header><button class="x"><span>Zhiping</span></button></header><main>ICA Handla Online</main>')).toBe(true);
  });

  it("is false for a page that is not ICA's normal page", () => {
    expect(icaPageLoggedIn("<title>Human Verification</title>")).toBe(false);
    expect(icaPageLoggedIn("")).toBe(false);
  });
});

describe("loginScreen", () => {
  it("sees the store's 'no account' answer", () => {
    expect(loginScreen("https://www.willys.se/anvandare/inloggning", "Inget konto hittades\nDu har inte ett konto hos oss.")).toBe("no-account");
  });

  it("is open on a login page", () => {
    expect(loginScreen("https://www.willys.se/anvandare/inloggning", "Logga in med BankID")).toBe("open");
    expect(loginScreen("https://ims.icagruppen.se/authn/authenticate/bankid", "")).toBe("open");
  });

  it("is closed once the tab is back on a normal page", () => {
    expect(loginScreen("https://www.willys.se/", "Veckans erbjudanden")).toBe("closed");
  });
});

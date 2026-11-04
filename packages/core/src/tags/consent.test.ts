import { afterEach, describe, expect, it, vi } from "vitest";
import { consentModeSignals, createConsentStore, isStrictConsentRegion } from "./consent";

const clearCookies = () => {
  for (const c of document.cookie.split("; ")) {
    const name = c.split("=")[0];
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
};

afterEach(() => {
  clearCookies();
  vi.restoreAllMocks();
});

describe("createConsentStore", () => {
  it("is undecided until the visitor sets a decision, then reads it back", () => {
    const store = createConsentStore({ policyVersion: "1" });
    expect(store.get()).toBeNull();
    store.set({ analytics: true, marketing: false });
    expect(store.get()).toMatchObject({ essential: true, analytics: true, marketing: false, v: "1" });
  });

  it("treats a decision under another policy version as unset", () => {
    createConsentStore({ policyVersion: "1" }).set({ analytics: true, marketing: true });
    expect(createConsentStore({ policyVersion: "2" }).get()).toBeNull();
  });

  it("treats a malformed or incomplete cookie as unset", () => {
    const store = createConsentStore({ policyVersion: "1", cookieName: "c" });
    document.cookie = "c=not-json; path=/";
    expect(store.get()).toBeNull();
    document.cookie = `c=${encodeURIComponent(JSON.stringify({ analytics: true, v: "1" }))}; path=/`;
    expect(store.get()).toBeNull();
    document.cookie = `c=${encodeURIComponent(JSON.stringify({ analytics: true, marketing: false, v: "1" }))}; path=/`;
    expect(store.get()?.ts).toBe(0);
  });

  it("notifies every store sharing the cookie name, and stops after unsubscribe", () => {
    const writer = createConsentStore({ policyVersion: "1" });
    const reader = createConsentStore({ policyVersion: "1" });
    const listener = vi.fn();
    const off = reader.subscribe(listener);
    writer.set({ analytics: false, marketing: false });
    off();
    writer.set({ analytics: true, marketing: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("asks the banner to reopen through its open event", () => {
    const store = createConsentStore({ policyVersion: "1", cookieName: "site-consent" });
    const listener = vi.fn();
    window.addEventListener("site-consent:open", listener);
    store.openSettings();
    window.removeEventListener("site-consent:open", listener);
    expect(store.openEvent).toBe("site-consent:open");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("refuses a cookie name that would break the cookie string or the lookup", () => {
    expect(() => createConsentStore({ policyVersion: "1", cookieName: "a;b" })).toThrow(/Invalid consent cookie name/);
  });
});

describe("isStrictConsentRegion", () => {
  const zone = (timeZone: string) =>
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({ resolvedOptions: () => ({ timeZone }) } as Intl.DateTimeFormat);

  it("is strict for Europe and the two EEA zones outside Europe/*", () => {
    zone("Europe/Berlin");
    expect(isStrictConsentRegion()).toBe(true);
    zone("Atlantic/Reykjavik");
    expect(isStrictConsentRegion()).toBe(true);
    zone("Asia/Nicosia");
    expect(isStrictConsentRegion()).toBe(true);
  });

  it("is not strict elsewhere, and strict when the zone can't be read", () => {
    zone("America/New_York");
    expect(isStrictConsentRegion()).toBe(false);
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("no Intl");
    });
    expect(isStrictConsentRegion()).toBe(true);
  });
});

describe("consentModeSignals", () => {
  it("maps analytics to analytics_storage and marketing to the ad signals", () => {
    expect(consentModeSignals({ analytics: true, marketing: false })).toEqual({
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  });
});

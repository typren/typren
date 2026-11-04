import { afterEach, describe, expect, it, vi } from "vitest";
import { createGa4Adapter, createGtmAdapter, createMetaPixelAdapter, createScriptAdapter } from "./adapters";

afterEach(() => {
  delete window.dataLayer;
  delete window.gtag;
  delete window.fbq;
});

describe("createGtmAdapter", () => {
  it("loads the container under marketing consent, gated by default", () => {
    const gtm = createGtmAdapter({ containerId: "GTM-ABC123" });
    expect(gtm).toMatchObject({ name: "gtm", category: "marketing", consentMode: false });
    expect(gtm.scripts()[0].inline).toContain("'GTM-ABC123'");
  });

  it("pushes events onto the dataLayer", () => {
    createGtmAdapter({ containerId: "GTM-ABC123" }).track?.("cta_click", { label: "Start" });
    expect(window.dataLayer).toEqual([{ event: "cta_click", label: "Start" }]);
  });

  it("refuses an ID that isn't a container ID, since it lands in script source", () => {
    expect(() => createGtmAdapter({ containerId: "GTM-1');alert(1)//" })).toThrow(/Invalid GTM container ID/);
  });
});

describe("createGa4Adapter", () => {
  it("loads gtag under analytics consent and honours Consent Mode", () => {
    const ga4 = createGa4Adapter({ measurementId: "G-XYZ9" });
    expect(ga4).toMatchObject({ category: "analytics", consentMode: true });
    expect(ga4.scripts()[0].src).toBe("https://www.googletagmanager.com/gtag/js?id=G-XYZ9");
  });

  it("sends events through gtag", () => {
    window.gtag = vi.fn();
    createGa4Adapter({ measurementId: "G-XYZ9" }).track?.("sign_up", { method: "github" });
    expect(window.gtag).toHaveBeenCalledWith("event", "sign_up", { method: "github" });
  });
});

describe("createMetaPixelAdapter", () => {
  it("inits the pixel and sends standard events as track, others as trackCustom", () => {
    const meta = createMetaPixelAdapter({ pixelId: "1234567890" });
    expect(meta.scripts()[0].inline).toContain("fbq('init','1234567890')");
    window.fbq = vi.fn();
    meta.track?.("Lead");
    meta.track?.("cta_click", { label: "x" });
    expect(window.fbq).toHaveBeenNthCalledWith(1, "track", "Lead", undefined);
    expect(window.fbq).toHaveBeenNthCalledWith(2, "trackCustom", "cta_click", { label: "x" });
  });

  it("refuses a non-numeric pixel ID", () => {
    expect(() => createMetaPixelAdapter({ pixelId: "12a" })).toThrow(/Invalid Meta pixel ID/);
  });
});

describe("createScriptAdapter", () => {
  it("loads one https script under its category", () => {
    const hubspot = createScriptAdapter({ name: "hubspot", src: "https://js.hs-scripts.com/1.js", category: "marketing" });
    expect(hubspot.scripts()).toEqual([{ id: "typren-hubspot", src: "https://js.hs-scripts.com/1.js" }]);
  });

  it("refuses a plain-http src and an unsafe name", () => {
    expect(() => createScriptAdapter({ name: "x", src: "http://example.com/a.js", category: "analytics" })).toThrow(/https/);
    expect(() => createScriptAdapter({ name: "X Y", src: "https://example.com/a.js", category: "analytics" })).toThrow(/Invalid/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGa4Adapter,
  createGtmAdapter,
  createHubSpotAdapter,
  createLinkedInInsightAdapter,
  createMetaPixelAdapter,
  createScriptAdapter,
} from "./adapters";

afterEach(() => {
  delete window.dataLayer;
  delete window.gtag;
  delete window.fbq;
  delete window._hsq;
  delete window.lintrk;
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

describe("createHubSpotAdapter", () => {
  it("loads the portal's tracking script, from the EU host for an EU portal", () => {
    expect(createHubSpotAdapter({ portalId: "123456" }).scripts()).toEqual([
      { id: "hs-script-loader", src: "https://js.hs-scripts.com/123456.js" },
    ]);
    expect(createHubSpotAdapter({ portalId: "1", region: "eu1" }).scripts()[0].src).toBe("https://js-eu1.hs-scripts.com/1.js");
  });

  it("sends events as custom behavioral events", () => {
    const hubspot = createHubSpotAdapter({ portalId: "1" });
    hubspot.track?.("pe1_demo_requested", { plan: "pro" });
    hubspot.track?.("pe1_viewed");
    expect(window._hsq).toEqual([
      ["trackCustomBehavioralEvent", { name: "pe1_demo_requested", properties: { plan: "pro" } }],
      ["trackCustomBehavioralEvent", { name: "pe1_viewed", properties: {} }],
    ]);
  });

  it("refuses a non-numeric portal ID", () => {
    expect(() => createHubSpotAdapter({ portalId: "1.js?x" })).toThrow(/Invalid HubSpot portal ID/);
  });
});

describe("createLinkedInInsightAdapter", () => {
  it("registers the partner and loads the Insight tag", () => {
    const [script] = createLinkedInInsightAdapter({ partnerId: "123" }).scripts();
    expect(script.inline).toContain("push('123')");
    expect(script.src).toBe("https://snap.licdn.com/li.lms-analytics/insight.min.js");
  });

  it("sends only mapped events, as their conversion ID", () => {
    window.lintrk = vi.fn();
    const linkedin = createLinkedInInsightAdapter({ partnerId: "123", conversions: { Lead: 987 } });
    linkedin.track?.("Lead");
    linkedin.track?.("cta_click");
    linkedin.track?.("toString");
    expect(window.lintrk).toHaveBeenCalledOnce();
    expect(window.lintrk).toHaveBeenCalledWith("track", { conversion_id: 987 });
  });

  it("refuses a non-numeric partner ID", () => {
    expect(() => createLinkedInInsightAdapter({ partnerId: "1');x('" })).toThrow(/Invalid LinkedIn partner ID/);
  });
});

describe("createScriptAdapter", () => {
  it("loads one https script under its category", () => {
    const hotjar = createScriptAdapter({ name: "hotjar", src: "https://static.hotjar.com/c/hotjar.js", category: "analytics" });
    expect(hotjar.scripts()).toEqual([{ id: "typren-hotjar", src: "https://static.hotjar.com/c/hotjar.js" }]);
  });

  it("refuses a plain-http src and an unsafe name", () => {
    expect(() => createScriptAdapter({ name: "x", src: "http://example.com/a.js", category: "analytics" })).toThrow(/https/);
    expect(() => createScriptAdapter({ name: "X Y", src: "https://example.com/a.js", category: "analytics" })).toThrow(/Invalid/);
  });
});

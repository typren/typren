import { afterEach, describe, expect, it, vi } from "vitest";
import { createTagEngine } from "./engine";
import { createGa4Adapter, createGtmAdapter, type TagAdapter, type TagProps } from "./adapters";

const ga4 = createGa4Adapter({ measurementId: "G-TEST" });
const gtm = createGtmAdapter({ containerId: "GTM-TEST" });
const ids = (scripts: { id: string }[]) => scripts.map((s) => s.id);

afterEach(() => {
  document.cookie = "typren-consent=; path=/; max-age=0";
});

describe("createTagEngine scripts", () => {
  const engine = createTagEngine({ policyVersion: "1", adapters: [ga4, gtm] });

  it("defaults to regional Consent Mode", () => {
    expect(engine.consentMode).toBe("regional");
  });

  it("loads nothing before opt-in in a strict region", () => {
    expect(engine.scripts(null, true)).toEqual([]);
  });

  it("loads only the granted categories after opt-in in a strict region", () => {
    expect(ids(engine.scripts({ analytics: true, marketing: false }, true))).toEqual(["typren-ga4"]);
    expect(ids(engine.scripts({ analytics: true, marketing: true }, true))).toEqual(["typren-ga4", "typren-gtm"]);
  });

  it("outside strict regions, loads Consent Mode tags at once behind a denied default", () => {
    const scripts = engine.scripts(null, false);
    expect(ids(scripts)).toEqual(["typren-consent-mode", "typren-ga4"]);
    expect(scripts[0].inline).toContain(`"analytics_storage":"denied"`);
    expect(scripts[0].inline).not.toContain("'update'");
  });

  it("bakes a returning visitor's decision into the Consent Mode default", () => {
    const scripts = engine.scripts({ analytics: true, marketing: true }, false);
    expect(ids(scripts)).toEqual(["typren-consent-mode", "typren-ga4", "typren-gtm"]);
    expect(scripts[0].inline).toContain(`gtag('consent','update',{"analytics_storage":"granted"`);
  });

  it("in strict mode treats every region as strict", () => {
    const strict = createTagEngine({ policyVersion: "1", adapters: [ga4], consentMode: "strict" });
    expect(strict.scripts(null, false)).toEqual([]);
  });

  it("refuses two adapters with one name", () => {
    expect(() => createTagEngine({ policyVersion: "1", adapters: [gtm, gtm] })).toThrow(/Two tag adapters/);
  });
});

describe("createTagEngine enabled and track", () => {
  const spy = (name: string, category: TagAdapter["category"]) => ({
    name,
    category,
    scripts: () => [],
    track: vi.fn<(event: string, props?: TagProps) => void>(),
  });

  it("only runs on the production host, and never when disabled", () => {
    expect(createTagEngine({ policyVersion: "1", adapters: [] }).enabled()).toBe(true);
    expect(createTagEngine({ policyVersion: "1", adapters: [], productionHost: location.hostname }).enabled()).toBe(true);
    expect(createTagEngine({ policyVersion: "1", adapters: [], productionHost: "www.example.com" }).enabled()).toBe(false);
    expect(createTagEngine({ policyVersion: "1", adapters: [], disabled: true }).enabled()).toBe(false);
  });

  it("drops events without consent and sends them only to granted categories", () => {
    const a = spy("a", "analytics");
    const m = spy("m", "marketing");
    const engine = createTagEngine({ policyVersion: "1", adapters: [a, m] });
    engine.track("cta_click");
    expect(a.track).not.toHaveBeenCalled();
    engine.consent.set({ analytics: true, marketing: false });
    engine.track("cta_click", { label: "x" });
    expect(a.track).toHaveBeenCalledWith("cta_click", { label: "x" });
    expect(m.track).not.toHaveBeenCalled();
  });

  it("sends nothing off the production host even with consent", () => {
    const a = spy("a", "analytics");
    const engine = createTagEngine({ policyVersion: "1", adapters: [a], productionHost: "www.example.com" });
    engine.consent.set({ analytics: true, marketing: true });
    engine.track("cta_click");
    expect(a.track).not.toHaveBeenCalled();
  });
});

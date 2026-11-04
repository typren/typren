import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { TyprenTags } from "./typren-tags";
import { createTagEngine } from "../tags/engine";
import { createGa4Adapter, createGtmAdapter } from "../tags/adapters";
import type * as Consent from "../tags/consent";

const region = vi.hoisted(() => ({ strict: true }));
vi.mock("../tags/consent", async (importOriginal) => ({
  ...(await importOriginal<typeof Consent>()),
  isStrictConsentRegion: () => region.strict,
}));

vi.mock("next/script", () => ({
  default: ({ id, src, children }: { id: string; src?: string; children?: string }) => (
    <script data-testid={id} data-src={src}>
      {children}
    </script>
  ),
}));

const engine = (opts: Partial<Parameters<typeof createTagEngine>[0]> = {}) =>
  createTagEngine({
    policyVersion: "1",
    adapters: [createGa4Adapter({ measurementId: "G-TEST" }), createGtmAdapter({ containerId: "GTM-TEST" })],
    ...opts,
  });
const ids = (c: HTMLElement) => [...c.querySelectorAll("script")].map((s) => s.dataset.testid);

afterEach(() => {
  cleanup();
  region.strict = true;
  delete window.gtag;
  document.cookie = "typren-consent=; path=/; max-age=0";
});

describe("TyprenTags", () => {
  it("renders nothing before consent in a strict region", () => {
    const { container } = render(<TyprenTags engine={engine()} />);
    expect(ids(container)).toEqual([]);
  });

  it("loads the granted tags, including an inline tag's src, as soon as the visitor decides", () => {
    const e = engine();
    const { container } = render(<TyprenTags engine={e} />);
    act(() => e.consent.set({ analytics: true, marketing: true }));
    expect(ids(container)).toEqual(["typren-ga4", "typren-ga4-src", "typren-gtm"]);
  });

  it("outside strict regions loads Consent Mode tags at once and pushes a later decision to gtag", () => {
    region.strict = false;
    const e = engine();
    const { container } = render(<TyprenTags engine={e} />);
    expect(ids(container)).toEqual(["typren-consent-mode", "typren-ga4", "typren-ga4-src"]);
    window.gtag = vi.fn();
    act(() => e.consent.set({ analytics: true, marketing: false }));
    expect(window.gtag).toHaveBeenCalledWith("consent", "update", expect.objectContaining({ analytics_storage: "granted" }));
  });

  it("renders nothing when disabled or off the production host", () => {
    const e = engine({ disabled: true });
    e.consent.set({ analytics: true, marketing: true });
    expect(ids(render(<TyprenTags engine={e} />).container)).toEqual([]);
    expect(ids(render(<TyprenTags engine={engine({ productionHost: "www.example.com" })} />).container)).toEqual([]);
  });

  it("puts no tag in the server HTML, even for a decided visitor", () => {
    const e = engine();
    e.consent.set({ analytics: true, marketing: true });
    expect(renderToString(<TyprenTags engine={e} />)).toBe("");
  });
});

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageActions, PageContent, PageFlows, PageInfo, Slice } from "@typren/core";
import { createCanvasSession } from "@typren/core/ui/canvas";
import { HELLO_TIMEOUT, canvasSrc, diffSlices, keySlices, underPrefix, useCanvasDocument, usePageCanvas, type Keyed } from "./page-canvas";
import { TyprenStudio, type TyprenStudioHost } from "./typren-studio";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const s = (heading: string): Slice => ({ slice: "hero", heading });

describe("keySlices", () => {
  it("keeps keys by identity, takes over a replaced slice's position, and mints the rest", () => {
    let n = 0;
    const fresh = () => `new${n++}`;
    const [a, b, c] = [s("a"), s("b"), s("c")];
    const prev = keySlices([], [a, b, c], fresh);
    expect(prev.map((e) => e.key)).toEqual(["new0", "new1", "new2"]);
    // Reorder: identity wins.
    expect(keySlices(prev, [c, a, b], fresh).map((e) => e.key)).toEqual(["new2", "new0", "new1"]);
    // A prop edit replaces b at its position.
    expect(keySlices(prev, [a, s("b2"), c], fresh).map((e) => e.key)).toEqual(["new0", "new1", "new2"]);
    // A duplicate is a new slice, even of the last one.
    expect(keySlices(prev, [a, b, c, { ...c }], fresh).map((e) => e.key)).toEqual(["new0", "new1", "new2", "new3"]);
    // The same object twice keeps its key once.
    expect(keySlices(prev, [a, a], fresh).map((e) => e.key)).toEqual(["new0", "new1"]);
  });
});

describe("diffSlices", () => {
  it("turns any edit into ops the canvas applies to the same order, mounting only what is new", () => {
    let n = 0;
    const fresh = () => `k${n++}`;
    const root = document.createElement("div");
    const mounts: string[] = [];
    const renderer = {
      name: "t",
      mount: (el: HTMLElement, _c: unknown, p: Record<string, unknown>) => {
        mounts.push(String(p.heading));
        el.textContent = String(p.heading);
        return { update: (q: Record<string, unknown>) => void (el.textContent = String(q.heading)), unmount: () => {} };
      },
    };
    const post = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    const canvas = createCanvasSession({ renderer, registry: { hero: 1 }, root, post });
    let slices = Array.from({ length: 6 }, (_, i) => s(`h${i}`));
    let keyed: Keyed[] = keySlices([], slices, fresh);
    canvas.receive({ type: "document", rev: 0, slices: keyed });
    let seed = 7;
    const rand = (max: number) => (seed = (seed * 48271) % 2147483647) % max;
    for (let rev = 1; rev <= 200; rev++) {
      const next = [...slices];
      const i = rand(next.length || 1);
      const kind = rand(4);
      if (kind === 0 && next.length) next.splice(i, 1);
      else if (kind === 1) next.splice(i, 0, s(`n${rev}`));
      else if (kind === 2 && next.length) next.splice(rand(next.length), 0, ...next.splice(i, 1));
      else if (next.length) next[i] = s(`e${rev}`);
      const nextKeyed = keySlices(keyed, next, fresh);
      canvas.receive({ type: "patch", rev, base: rev - 1, ops: diffSlices(keyed, nextKeyed) });
      [slices, keyed] = [next, nextKeyed];
      expect(post.mock.calls.filter(([m]) => m.type === "resync")).toEqual([]);
      expect(Array.from(root.children, (el) => el.textContent)).toEqual(next.map((x) => x.heading));
    }
    // Inserts mount; edits, moves and removes never do.
    expect(mounts.every((h) => /^(h|n)/.test(h))).toBe(true);
  });

  it("sends nothing for no change", () => {
    const k = keySlices([], [s("a")], () => "a");
    expect(diffSlices(k, k)).toEqual([]);
  });
});

describe("helpers", () => {
  it("builds the canvas URL with page mode and the nonce in the fragment", () => {
    expect(canvasSrc("http://site.test/typren/section/", "abc")).toBe("http://site.test/typren/section/?page#typren=abc");
    expect(canvasSrc("http://site.test/x?y=1", "abc")).toBe("http://site.test/x?y=1&page#typren=abc");
  });

  it("matches nested-layout prefixes by whole segment", () => {
    expect(underPrefix("/blog/post", ["/blog"])).toBe(true);
    expect(underPrefix("/blog", ["/blog/"])).toBe(true);
    expect(underPrefix("/blogger", ["/blog"])).toBe(false);
    expect(underPrefix("/", undefined)).toBe(false);
    expect(underPrefix("/", ["/"])).toBe(true);
    expect(underPrefix("/about", ["/"])).toBe(false);
  });
});

const SITE = "http://site.test";
const canvasFrame = () => document.querySelector<HTMLIFrameElement>('iframe[title="Page canvas"]');
const realFrame = () => document.querySelector<HTMLIFrameElement>('iframe[title="Live preview"]')!;
const say = (frame: HTMLIFrameElement, data: Record<string, unknown>, { nonce = frame.dataset.typrenNonce, origin = SITE } = {}) =>
  act(() => void window.dispatchEvent(new MessageEvent("message", { data: { __typren: true, ...data, nonce }, source: frame.contentWindow, origin })));

describe("usePageCanvas", () => {
  function Harness({ slices, slug = "home", url = `${SITE}/typren/section` }: { slices?: Slice[]; slug?: string; url?: string }) {
    const canvas = usePageCanvas({ url, mounted: true });
    useCanvasDocument(canvas, { slug, locale: "en", slices });
    return canvas.keep ? (
      <iframe title="Page canvas" ref={canvas.frameRef} src={canvas.src} data-typren-nonce={canvas.nonce} data-ready={String(canvas.ready)} />
    ) : null;
  }

  it("gives up waiting after the timeout but keeps the frame for a late hello", () => {
    vi.useFakeTimers();
    render(<Harness slices={[s("a")]} />);
    const frame = canvasFrame()!;
    expect(frame.getAttribute("src")).toMatch(/\/typren\/section\?page#typren=[0-9a-f]{32}$/);
    act(() => void vi.advanceTimersByTime(HELLO_TIMEOUT));
    expect(frame.dataset.ready).toBe("false");
    const posted = vi.spyOn(frame.contentWindow!, "postMessage");
    say(frame, { type: "hello", protocol: 1, renderers: ["react"], server: false });
    expect(posted).toHaveBeenCalledWith(expect.objectContaining({ type: "document", rev: 1, nonce: frame.dataset.typrenNonce }), SITE);
  });

  it("drops the frame when the canvas says it cannot render", () => {
    render(<Harness slices={[s("a")]} />);
    say(canvasFrame()!, { type: "hello", protocol: 1, renderers: [], server: false });
    expect(canvasFrame()).toBeNull();
  });

  it("sends the document on hello, patches per change, the document again on resync, and is ready once painted", () => {
    const a = s("a");
    const { rerender } = render(<Harness slices={[a]} />);
    const frame = canvasFrame()!;
    const posted = vi.spyOn(frame.contentWindow!, "postMessage");
    const last = () => posted.mock.calls.at(-1)![0] as Record<string, unknown>;
    // Unsigned, foreign-origin and foreign-window messages do nothing.
    say(frame, { type: "hello", protocol: 1, renderers: ["react"] }, { nonce: "" });
    say(frame, { type: "hello", protocol: 1, renderers: ["react"] }, { origin: "http://evil.test" });
    act(() => void window.dispatchEvent(new MessageEvent("message", { data: { __typren: true, type: "hello", protocol: 1, renderers: ["r"], nonce: frame.dataset.typrenNonce }, source: window, origin: SITE })));
    expect(posted).not.toHaveBeenCalled();

    say(frame, { type: "hello", protocol: 1, renderers: ["react"], server: false });
    expect(last()).toMatchObject({ type: "document", rev: 1, page: "home", locale: "en", slices: [{ slice: a }] });
    expect(frame.dataset.ready).toBe("false");
    say(frame, { type: "rendered", rev: 1, ms: 3 });
    expect(frame.dataset.ready).toBe("true");

    const key = (last().slices as Keyed[])[0]!.key;
    rerender(<Harness slices={[s("a2")]} />);
    expect(last()).toMatchObject({ type: "patch", rev: 2, base: 1, ops: [{ op: "set", key, slice: s("a2") }] });
    say(frame, { type: "resync", rev: 1 });
    expect(last()).toMatchObject({ type: "document", rev: 3 });
    rerender(<Harness slices={[s("b")]} slug="terms" />);
    expect(last()).toMatchObject({ type: "document", rev: 4, page: "terms" });
  });
});

describe("the shell with a page canvas", () => {
  const actions = { saveDraft: vi.fn(async () => ({ ok: true as const, version: "v1" })) } as unknown as PageActions & PageFlows;
  const host: TyprenStudioHost = {
    actions,
    sliceNames: ["hero"],
    defaults: {},
    previewPath: SITE,
    previewUrl: (slug) => (slug === "home" ? `${SITE}/` : `${SITE}/${slug}/`),
    sectionPreviewUrl: `${SITE}/typren/section/`,
    nestedLayouts: ["/blog"],
  };
  const pages: PageInfo[] = [
    { slug: "home", title: "Home", hasDraft: false, locales: ["en"] },
    { slug: "blog/post", title: "Post", hasDraft: false, locales: ["en"] },
  ];
  const page: PageContent = { meta: {}, slices: [s("Hi")], body: "" };
  const shell = (slug = "home", locale?: string) => (
    <TyprenStudio host={host} pages={pages} sectionId="pages" slug={slug} page={page} locale={locale} onNavigate={() => {}} onReload={() => {}} />
  );

  it("falls back to the real route, reloading it into edit mode, when the canvas never says hello", () => {
    vi.useFakeTimers();
    render(shell());
    const real = realFrame();
    expect(canvasFrame()).toBeTruthy();
    act(() => void vi.advanceTimersByTime(HELLO_TIMEOUT));
    act(() => screen.getByRole("button", { name: "Edit" }).click());
    expect(canvasFrame()!.getAttribute("aria-hidden")).toBe("true");
    act(() => void vi.advanceTimersByTime(500));
    expect(realFrame()).not.toBe(real);
    expect(realFrame().getAttribute("src")).toBe(`${SITE}/?v=1`);
  });

  it("edits on the canvas with no navigation once it has painted the page", () => {
    vi.useFakeTimers();
    const { rerender } = render(shell());
    const real = realFrame();
    const frame = canvasFrame()!;
    const posted = vi.spyOn(frame.contentWindow!, "postMessage");
    say(frame, { type: "hello", protocol: 1, renderers: ["react"], server: false });
    say(frame, { type: "rendered", rev: 1, ms: 4 });
    act(() => screen.getByRole("button", { name: "Edit" }).click());
    expect(frame.getAttribute("aria-hidden")).toBeNull();
    expect(real.getAttribute("aria-hidden")).toBe("true");
    expect(posted).toHaveBeenCalledWith(expect.objectContaining({ type: "edit" }), SITE);
    act(() => void vi.advanceTimersByTime(1000));
    expect(realFrame()).toBe(real);
    expect(canvasFrame()).toBe(frame);
    const src = frame.getAttribute("src");
    expect(src).toMatch(/\?page#typren=/);
    // A locale switch is a document; neither frame loads anything.
    const realSrc = real.getAttribute("src");
    rerender(shell("home", "fr"));
    expect(posted).toHaveBeenCalledWith(expect.objectContaining({ type: "document", locale: "fr" }), SITE);
    expect(canvasFrame()).toBe(frame);
    expect(frame.getAttribute("src")).toBe(src);
    expect(realFrame()).toBe(real);
    expect(real.getAttribute("src")).toBe(realSrc);
    // Back to browsing: the real route again, caught up to the locale.
    act(() => screen.getByRole("button", { name: "Edit" }).click());
    expect(realFrame().getAttribute("aria-hidden")).toBeNull();
    expect(realFrame().getAttribute("src")).toContain("locale=fr");
  });

  it("keeps a nested-layout page on its real route", () => {
    render(shell("blog/post"));
    const frame = canvasFrame()!;
    const posted = vi.spyOn(frame.contentWindow!, "postMessage");
    say(frame, { type: "hello", protocol: 1, renderers: ["react"], server: false });
    act(() => screen.getByRole("button", { name: "Edit" }).click());
    expect(posted).not.toHaveBeenCalledWith(expect.objectContaining({ type: "document" }), SITE);
    expect(frame.getAttribute("aria-hidden")).toBe("true");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MultiSectionCanvas, toPlaces } from "./section-canvas-multi";
import type { CmsConfig } from "../types";

const STUDIO = "http://127.0.0.1:4321";
const registry = {
  hero: ({ heading, href, body }: { heading?: string; href?: string; body?: unknown }) => (
    <a href={href} data-body={JSON.stringify(body ?? null)}>
      {heading}
    </a>
  ),
} as unknown as CmsConfig["registry"];
const place = (key: string, slice?: unknown) => ({ key, left: 10, top: 20, width: 256, height: 192, radius: 8, slice });
const send = (data: unknown, { origin = STUDIO, source = window as MessageEventSource | null } = {}) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
  });
const sections = () => document.getElementById("typren-sections");
let posted: ReturnType<typeof vi.spyOn>;
const last = () => posted.mock.calls.at(-1)! as [Record<string, unknown>, string];

beforeEach(() => {
  posted = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  // jsdom lays nothing out; give every rendered section a height.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("MultiSectionCanvas", () => {
  it("stays inert without a valid studio origin or in a production build", () => {
    for (const origin of [undefined, "*", "null", `${STUDIO}/path`]) {
      render(<MultiSectionCanvas origin={origin} registry={registry} />);
      expect(sections(), String(origin)).toBeNull();
      cleanup();
    }
    vi.stubEnv("NODE_ENV", "production");
    render(<MultiSectionCanvas origin={STUDIO} registry={registry} />);
    expect(sections()).toBeNull();
    expect(posted).not.toHaveBeenCalled();
  });

  it("says hello to the studio's origin only, with its colour scheme", async () => {
    render(<MultiSectionCanvas origin={STUDIO} rendered={{}} />);
    await waitFor(() => expect(posted).toHaveBeenCalled());
    const [data, origin] = last();
    expect(origin).toBe(STUDIO);
    expect(data).toMatchObject({ __typren: true, type: "sections", ready: [], missing: [] });
    expect(typeof data.colorScheme).toBe("string");
  });

  it("draws server-rendered sections at the posted places and reports the keys it lacks", async () => {
    render(<MultiSectionCanvas origin={STUDIO} rendered={{ a: <p>Server A</p> }} />);
    await waitFor(() => expect(sections()).toBeTruthy());
    send({ __typren: true, type: "sections", items: [place("a", { slice: "ignored" }), place("b")] });
    await waitFor(() => expect(last()[0]).toMatchObject({ ready: ["a"], missing: ["b"] }));
    const box = sections()!.querySelector<HTMLElement>('[data-typren-section="a"]')!;
    expect(box.textContent).toBe("Server A");
    expect(box.parentElement!.style).toMatchObject({ left: "10px", top: "20px", width: "256px", height: "192px", borderRadius: "8px", opacity: "1" });
    // 400px tall at 1280 wide fits a 256 x 192 tile by width: 0.2.
    expect(box.style.transform).toBe("scale(0.2)");
  });

  it("re-measures a section when it resizes and stops watching on unmount", async () => {
    const observers: { cb: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect = vi.fn();
        constructor(cb: () => void) {
          observers.push({ cb, disconnect: this.disconnect });
        }
        observe() {}
      },
    );
    const { unmount } = render(<MultiSectionCanvas origin={STUDIO} rendered={{ a: <p>Server A</p> }} />);
    await waitFor(() => expect(sections()).toBeTruthy());
    send({ __typren: true, type: "sections", items: [place("a")] });
    await waitFor(() => expect(observers).toHaveLength(1));
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(1600);
    act(() => observers[0].cb());
    // Cropped to one 800px screen, which re-centres it: (192 - 800 * 0.2) / 2.
    const box = sections()!.querySelector<HTMLElement>('[data-typren-section="a"]')!;
    expect(box.style.top).toBe("16px");
    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("ignores messages from another origin, another window or without the marker", async () => {
    render(<MultiSectionCanvas origin={STUDIO} rendered={{ a: <p>A</p> }} />);
    await waitFor(() => expect(sections()).toBeTruthy());
    const items = [place("a")];
    send({ __typren: true, type: "sections", items }, { origin: "https://evil.test" });
    send({ __typren: true, type: "sections", items }, { source: null });
    send({ type: "sections", items });
    send({ __typren: true, type: "rects", items });
    expect(sections()!.childElementCount).toBe(0);
  });

  it("renders posted slices in the client form, cleaned like the query, and unknown ones as missing", async () => {
    render(<MultiSectionCanvas origin={STUDIO} registry={registry} />);
    await waitFor(() => expect(sections()).toBeTruthy());
    send({
      __typren: true,
      type: "sections",
      items: [
        place("a", { slice: "hero", heading: "Hi", href: "javascript:alert(1)", body: { dangerouslySetInnerHTML: { __html: "<b>x</b>" } } }),
        place("b", { slice: "toString" }),
        place("c", "hero"),
      ],
    });
    await waitFor(() => expect(last()[0]).toMatchObject({ ready: ["a"], missing: ["b", "c"] }));
    const link = sections()!.querySelector("a")!;
    expect(link.textContent).toBe("Hi");
    expect(link.getAttribute("href")).toBeNull();
    expect(link.dataset.body).toBe("{}");
  });
});

describe("toPlaces", () => {
  it("keeps well-formed places, clamping numbers and dropping the rest", () => {
    expect(
      toPlaces([
        { key: "a", left: -5, top: Infinity, width: "9", height: 1e9, radius: 4, slice: { slice: "x" } },
        { key: 1 },
        null,
        { key: "x".repeat(65) },
      ])
    ).toEqual([{ key: "a", left: 0, top: 0, width: 0, height: 100_000, radius: 4, slice: { slice: "x" } }]);
    expect(toPlaces("nope")).toEqual([]);
  });
});

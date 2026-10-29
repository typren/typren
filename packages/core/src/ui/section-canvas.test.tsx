import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { createSectionCanvas } from "./section-canvas";
import { MultiSectionCanvas } from "./section-canvas-multi";
import { CanvasUnavailable } from "./canvas";

const bridge = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock("./preview-bridge.vanilla", async (real) => ({ ...(await real<object>()), initPreviewBridge: bridge }));

const Canvas = createSectionCanvas({
  hero: ({ heading }: { heading: string }) => <h1>{heading}</h1>,
} as Parameters<typeof createSectionCanvas>[0]);
const q = (slice?: string) => Promise.resolve({ slice });
type Multi = { type: unknown; props: { origin?: string; rendered: Record<string, { props: unknown }> } };
const open = () => {
  vi.stubEnv("TYPREN_PREVIEW", "1");
  vi.stubEnv("NODE_ENV", "development");
};

beforeEach(() => {
  open();
  vi.stubEnv("TYPREN_STUDIO_ORIGIN", "http://127.0.0.1:4321");
  bridge.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("createSectionCanvas", () => {
  it("renders nothing, and never reads searchParams, when the gate is closed", async () => {
    const sp = new Proxy({}, { get: () => { throw new Error("read"); } }) as Promise<never>;
    vi.stubEnv("TYPREN_PREVIEW", "");
    expect(await Canvas({ searchParams: sp })).toBeNull();
    open();
    vi.stubEnv("NODE_ENV", "production");
    expect(await Canvas({ searchParams: sp })).toBeNull();
    expect(bridge).not.toHaveBeenCalled();
  });

  it("renders a valid slice at index 0 with its props", async () => {
    const { container } = render(await Canvas({ searchParams: q(JSON.stringify({ slice: "hero", heading: "Hi" })) }));
    expect(container.querySelector('[data-typren-index="0"] h1')?.textContent).toBe("Hi");
  });

  it.each([
    ["missing", undefined],
    ["empty slice", '{"slice":""}'],
    ["bad JSON", "{x"],
    ["non-object", "[1]"],
    ["unknown slice", '{"slice":"nope"}'],
    ["inherited key", '{"slice":"toString"}'],
  ])("still mounts the bridge for %s", async (_n, raw) => {
    const { container } = render(await Canvas({ searchParams: q(raw) }));
    expect(container.querySelector("[data-typren-index]")).toBeNull();
    expect(bridge).toHaveBeenCalledWith("http://127.0.0.1:4321", undefined);
  });

  it("uses the first value of a repeated slice param", async () => {
    const { container } = render(await Canvas({ searchParams: Promise.resolve({ slice: [JSON.stringify({ slice: "hero", heading: "A" }), "x"] }) }));
    expect(container.querySelector("h1")?.textContent).toBe("A");
  });

  it("hands a client canvas the studio origin without reading searchParams", async () => {
    const sp = new Proxy({}, { get: () => { throw new Error("read"); } }) as Promise<never>;
    const Client = vi.fn(({ origin }: { origin?: string }) => <p>{origin}</p>);
    const ClientCanvas = createSectionCanvas(Client);
    const { container } = render(await ClientCanvas({ searchParams: sp }));
    expect(container.textContent).toBe("http://127.0.0.1:4321");
    vi.stubEnv("NODE_ENV", "production");
    expect(await ClientCanvas({ searchParams: sp })).toBeNull();
  });

  it("renders every valid slice of ?slices= by key, for the many-section canvas", async () => {
    const slices = JSON.stringify({ a: { slice: "hero", heading: "A", href: "javascript:x" }, b: { slice: "nope" } });
    const el = (await Canvas({ searchParams: Promise.resolve({ slices, slice: '{"slice":"hero"}' }) })) as unknown as Multi;
    expect(el.type).toBe(MultiSectionCanvas);
    expect(el.props.origin).toBe("http://127.0.0.1:4321");
    expect(Object.keys(el.props.rendered)).toEqual(["a"]);
    expect(el.props.rendered.a!.props).toEqual({ slice: "hero", heading: "A" });
    expect(bridge).not.toHaveBeenCalled();
  });

  it("answers ?page with no client renderer, so the studio frames the real route", async () => {
    const el = (await Canvas({ searchParams: Promise.resolve({ page: "" }) })) as unknown as Multi;
    expect(el.type).toBe(CanvasUnavailable);
    expect(el.props.origin).toBe("http://127.0.0.1:4321");
  });
});

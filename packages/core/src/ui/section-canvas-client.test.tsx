import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createClientSectionCanvas } from "./section-canvas-client";

const bridge = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock("./preview-bridge.vanilla", async (real) => ({ ...(await real<object>()), initPreviewBridge: bridge }));

const Canvas = createClientSectionCanvas({
  hero: ({ heading }: { heading: string }) => <h1>{heading}</h1>,
} as Parameters<typeof createClientSectionCanvas>[0]);
const at = (search: string) => window.history.replaceState(null, "", `/typren/section${search}`);

afterEach(() => {
  cleanup();
  at("");
  bridge.mockClear();
});

describe("createClientSectionCanvas", () => {
  it("renders the slice from the page's own query, at index 0", async () => {
    at(`?slice=${encodeURIComponent(JSON.stringify({ slice: "hero", heading: "Hi" }))}`);
    const { container } = render(<Canvas origin="http://127.0.0.1:4321" />);
    await waitFor(() => expect(container.querySelector('[data-typren-index="0"] h1')?.textContent).toBe("Hi"));
    expect(bridge).toHaveBeenCalledWith("http://127.0.0.1:4321", undefined);
  });

  it.each([
    ["missing", ""],
    ["unknown slice", `?slice=${encodeURIComponent('{"slice":"nope"}')}`],
    ["inherited key", `?slice=${encodeURIComponent('{"slice":"toString"}')}`],
    ["bad JSON", "?slice=%7Bx"],
  ])("still mounts the bridge for %s", (_n, search) => {
    at(search);
    const { container } = render(<Canvas origin="http://127.0.0.1:4321" />);
    expect(container.querySelector("[data-typren-index]")).toBeNull();
    expect(bridge).toHaveBeenCalledWith("http://127.0.0.1:4321", undefined);
  });

  it("hands ?slices= to the many-section canvas instead of the bridge", async () => {
    at(`?slices=%7B%7D&slice=${encodeURIComponent(JSON.stringify({ slice: "hero", heading: "Hi" }))}`);
    const { container } = render(<Canvas origin="http://127.0.0.1:4321" />);
    await waitFor(() => expect(document.getElementById("typren-sections")).toBeTruthy());
    expect(container.querySelector("[data-typren-index]")).toBeNull();
    expect(bridge).not.toHaveBeenCalled();
  });

  it("never reads the query without a studio origin or in a production build", async () => {
    at(`?slice=${encodeURIComponent(JSON.stringify({ slice: "hero", heading: "Hi" }))}`);
    const bare = render(<Canvas />);
    await new Promise((r) => setTimeout(r, 0));
    expect(bare.container.querySelector("[data-typren-index]")).toBeNull();
    bare.unmount();
    vi.stubEnv("NODE_ENV", "production");
    try {
      const { container } = render(<Canvas origin="http://127.0.0.1:4321" />);
      await new Promise((r) => setTimeout(r, 0));
      expect(container.querySelector("[data-typren-index]")).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

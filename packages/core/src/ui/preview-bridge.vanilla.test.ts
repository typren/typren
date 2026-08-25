import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initPreviewBridge } from "./preview-bridge.vanilla";

let cleanup: (() => void) | null = null;

beforeEach(() => {
  document.body.innerHTML = '<div data-typren-index="0">block</div>';
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
});

describe("initPreviewBridge origin handshake", () => {
  it("defaults to window.location.origin when no allowedOrigin is given (same-origin local setups unchanged)", () => {
    const postMessage = vi.spyOn(window.parent, "postMessage");
    cleanup = initPreviewBridge();

    document.querySelector("[data-typren-index]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][1]).toBe(window.location.origin);
  });

  it("posts to the explicit allowedOrigin when the host provides one, never '*'", () => {
    const postMessage = vi.spyOn(window.parent, "postMessage");
    const hostOrigin = "https://dashboard.typren.example";
    cleanup = initPreviewBridge(hostOrigin);

    document.querySelector("[data-typren-index]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessage).toHaveBeenCalledTimes(1);
    const targetOrigin = postMessage.mock.calls[0][1];
    expect(targetOrigin).toBe(hostOrigin);
    expect(targetOrigin).not.toBe("*");
  });

  it("accepts an inbound message only from the configured allowedOrigin", () => {
    const hostOrigin = "https://dashboard.typren.example";
    cleanup = initPreviewBridge(hostOrigin);

    window.dispatchEvent(
      new MessageEvent("message", { data: { __typren: true, type: "theme", theme: "dark" }, origin: "https://evil.example" })
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    window.dispatchEvent(
      new MessageEvent("message", { data: { __typren: true, type: "theme", theme: "dark" }, origin: hostOrigin })
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("rejects messages from the page's own origin once a different allowedOrigin is configured", () => {
    const hostOrigin = "https://dashboard.typren.example";
    cleanup = initPreviewBridge(hostOrigin);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { __typren: true, type: "theme", theme: "dark" },
        origin: window.location.origin,
      })
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

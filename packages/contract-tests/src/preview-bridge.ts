import { describe, expect, it, vi } from "vitest";

/**
 * Preview-bridge protocol (packages/core/src/ui/preview-bridge.vanilla.ts).
 * Every message carries `__typren: true`; both sides check `event.origin`
 * against their own origin before touching `d`. Mirrors the four message
 * shapes the bridge and packages/editor/src/{editor-shell,device-preview}.tsx
 * actually send today.
 */
export type BridgeMessage =
  | { __typren: true; type: "select"; index: number | null }
  | { __typren: true; type: "edit"; index: number; before: string; after: string }
  | { __typren: true; type: "theme"; theme: "dark" | "light" }
  | { __typren: true; type: "scrollTo"; index: number; reveal?: boolean };

export const BRIDGE_MESSAGE_FIXTURES: BridgeMessage[] = [
  { __typren: true, type: "select", index: 2 },
  { __typren: true, type: "select", index: null },
  { __typren: true, type: "edit", index: 1, before: "Old copy", after: "New copy" },
  { __typren: true, type: "theme", theme: "dark" },
  { __typren: true, type: "scrollTo", index: 3, reveal: false },
];

/** What `initPreviewBridge` (packages/core/src/ui/preview-bridge.vanilla.ts)
 *  returns: attach listeners, return a cleanup function. */
export type InitPreviewBridge = () => () => void;

/**
 * Runnable conformance suite for the bridge's iframe-side half: builds a
 * minimal DOM (`[data-typren-index]` blocks), attaches the bridge under test,
 * and asserts the outgoing `postMessage` shape on click plus the bridge's own
 * same-origin check on incoming messages. Needs `environment: "jsdom"`, where
 * `window.parent === window` for a top-level document, so spying on
 * `window.parent.postMessage` observes what the bridge sends.
 *
 * Does not cover the editor-shell (dashboard) side of the protocol — that
 * half has no vanilla, framework-free entry point to call the same way, and
 * duplicating packages/editor/src/editor-shell.tsx's own logic here would be
 * speculative rather than a contract check.
 */
export function createPreviewBridgeContractSuite(initPreviewBridge: InitPreviewBridge) {
  function attach(index: number): { block: HTMLElement; cleanup: () => void } {
    const block = document.createElement("div");
    block.setAttribute("data-typren-index", String(index));
    block.textContent = "Block";
    document.body.appendChild(block);
    const detach = initPreviewBridge();
    return {
      block,
      cleanup: () => {
        detach();
        block.remove();
      },
    };
  }

  const click = (target: Element) => target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

  describe("preview-bridge protocol", () => {
    it("posts a select message shaped like the fixture when a block is clicked", () => {
      const { block, cleanup } = attach(2);
      const postMessage = vi.spyOn(window.parent, "postMessage");
      click(block);
      expect(postMessage).toHaveBeenCalledWith({ __typren: true, type: "select", index: 2 }, window.location.origin);
      postMessage.mockRestore();
      cleanup();
    });

    it("posts index: null when the page background (not a block) is clicked", () => {
      const { cleanup } = attach(0);
      const postMessage = vi.spyOn(window.parent, "postMessage");
      click(document.body);
      expect(postMessage).toHaveBeenCalledWith({ __typren: true, type: "select", index: null }, window.location.origin);
      postMessage.mockRestore();
      cleanup();
    });

    it("applies an incoming same-origin theme message and ignores a foreign-origin one", () => {
      const { cleanup } = attach(0);
      const themeMsg = BRIDGE_MESSAGE_FIXTURES.find((m) => m.type === "theme")!;

      window.dispatchEvent(new MessageEvent("message", { data: themeMsg, origin: "https://evil.test" }));
      expect(document.documentElement.classList.contains("dark")).toBe(false);

      window.dispatchEvent(new MessageEvent("message", { data: themeMsg, origin: window.location.origin }));
      expect(document.documentElement.classList.contains("dark")).toBe(true);

      document.documentElement.classList.remove("dark");
      cleanup();
    });

    it("ignores a same-origin message with no __typren marker", () => {
      const { cleanup } = attach(0);
      const postMessage = vi.spyOn(window.parent, "postMessage");
      window.dispatchEvent(
        new MessageEvent("message", { data: { type: "select", index: 1 }, origin: window.location.origin })
      );
      expect(postMessage).not.toHaveBeenCalled();
      postMessage.mockRestore();
      cleanup();
    });
  });
}

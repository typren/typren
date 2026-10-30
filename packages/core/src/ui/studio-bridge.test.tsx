import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { StudioBridge } from "./studio-bridge";

const bridge = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock("./preview-bridge.vanilla", () => ({ initPreviewBridge: bridge }));

afterEach(() => {
  cleanup();
  bridge.mockClear();
});

describe("StudioBridge", () => {
  it("does nothing without an origin", () => {
    render(<StudioBridge />);
    expect(bridge).not.toHaveBeenCalled();
  });

  it("starts the bridge for its origin and stops it on unmount", () => {
    const stop = vi.fn();
    bridge.mockReturnValueOnce(stop);
    const { unmount } = render(<StudioBridge origin="http://127.0.0.1:1" />);
    expect(bridge).toHaveBeenCalledWith("http://127.0.0.1:1", undefined);
    unmount();
    expect(stop).toHaveBeenCalled();
  });
});

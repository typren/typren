import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DevicePreview,
  DeviceToggle,
  MIN_PREVIEW_WIDTH,
  fromFrame,
  postToFrame,
  presetAt,
  snapPoints,
  snapWidth,
  stopAtSnap,
  widthLabel,
} from "./device-preview";

const frameAt = (src: string) => {
  const f = document.createElement("iframe");
  f.src = src;
  document.body.append(f);
  return f;
};
const msg = (source: MessageEventSource | null, origin: string) => new MessageEvent("message", { source, origin });

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("fromFrame and postToFrame", () => {
  it("trust a cross-origin frame only at its own origin, and post to that origin", () => {
    const f = frameAt("http://site.test/about/");
    expect(fromFrame(msg(f.contentWindow, "http://site.test"), f)).toBe(true);
    expect(fromFrame(msg(f.contentWindow, "http://evil.test"), f)).toBe(false);
    expect(fromFrame(msg(window, "http://site.test"), f)).toBe(false);
    expect(fromFrame(msg(f.contentWindow, "http://site.test"), null)).toBe(false);
    const post = vi.spyOn(f.contentWindow!, "postMessage");
    postToFrame(f, { a: 1 });
    expect(post).toHaveBeenCalledWith({ a: 1 }, "http://site.test");
  });

  it("expect a same-origin frame's sandboxed, opaque origin", () => {
    const f = frameAt("/preview/home");
    expect(fromFrame(msg(f.contentWindow, "null"), f)).toBe(true);
    expect(fromFrame(msg(f.contentWindow, window.location.origin), f)).toBe(false);
    const post = vi.spyOn(f.contentWindow!, "postMessage");
    postToFrame(f, { a: 1 });
    expect(post).toHaveBeenCalledWith({ a: 1 }, "*");
  });
});

describe("DevicePreview resizing", () => {
  const preview = (device: "tablet" | "mobile" | "desktop" = "tablet") => (
    <DevicePreview src="http://site.test/" device={device} reloadKey={0} />
  );
  const handle = () => screen.getByRole("separator", { name: "Resize preview" });
  const width = () => (handle().parentElement as HTMLElement).style.width;

  it("steps with the arrow keys, jumps with Home, and resets on double-click", () => {
    render(preview());
    expect(width()).toBe("820px");
    expect(handle().getAttribute("aria-valuenow")).toBe("820");
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(width()).toBe("830px");
    fireEvent.keyDown(handle(), { key: "ArrowLeft", shiftKey: true });
    expect(width()).toBe("820px");
    fireEvent.keyDown(handle(), { key: "Home" });
    expect(width()).toBe(`${MIN_PREVIEW_WIDTH}px`);
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(width()).toBe(`${MIN_PREVIEW_WIDTH}px`);
    fireEvent.keyDown(handle(), { key: "Tab" });
    fireEvent.doubleClick(handle());
    expect(width()).toBe("820px");
  });

  it("follows a drag at twice the pointer's travel and shows the width while dragging", () => {
    render(preview());
    Object.defineProperty(handle().parentElement, "offsetWidth", { configurable: true, value: 820 });
    fireEvent.pointerDown(handle(), { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 550, pointerId: 1 });
    expect(width()).toBe("920px");
    expect(screen.getByText("920 px")).toBeTruthy();
    fireEvent.pointerUp(handle(), { pointerId: 1 });
    expect(screen.getByText("920 px").className).toContain("opacity-0");
    fireEvent.pointerMove(handle(), { clientX: 900 });
    expect(width()).toBe("920px");
  });

  it("keeps a dragged width across a remount, and drops it when the preset changes", () => {
    const { unmount } = render(preview());
    fireEvent.doubleClick(handle());
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    unmount();
    const { rerender } = render(preview());
    expect(width()).toBe("830px");
    rerender(preview("mobile"));
    expect(width()).toBe("390px");
    rerender(preview("desktop"));
    expect(width()).toBe("100%");
    fireEvent.keyDown(handle(), { key: "End" });
    fireEvent.keyDown(handle(), { key: "Home" });
    expect(width()).toBe(`${MIN_PREVIEW_WIDTH}px`);
  });
});

describe("snapping math", () => {
  it("lists preset and common widths within range, deduped and sorted", () => {
    expect(snapPoints(1000)).toEqual([360, 390, 768, 820, 1000]);
    expect(snapPoints(1100)).toEqual([360, 390, 768, 820, 1024, 1100]);
    expect(snapPoints(1200)).toEqual([360, 390, 768, 820, 1024, 1200]);
    expect(snapPoints(Infinity)).toContain(1440);
  });

  it("holds a width within 12px and lets go beyond it", () => {
    const pts = [768, 820];
    expect(snapWidth(780, pts)).toBe(768);
    expect(snapWidth(756, pts)).toBe(768);
    expect(snapWidth(755, pts)).toBe(755);
    expect(snapWidth(794, pts)).toBe(794);
    expect(snapWidth(810, pts)).toBe(820);
    expect(snapWidth(500, pts)).toBe(500);
  });

  it("stops a keyboard step at the first snap point it crosses", () => {
    const pts = [768, 820];
    expect(stopAtSnap(760, 780, pts)).toBe(768);
    expect(stopAtSnap(830, 780, pts)).toBe(820);
    expect(stopAtSnap(830, 700, pts)).toBe(820);
    expect(stopAtSnap(700, 830, pts)).toBe(768);
    expect(stopAtSnap(768, 778, pts)).toBe(778);
    expect(stopAtSnap(760, 768, pts)).toBe(768);
  });

  it("names presets in the label", () => {
    expect(presetAt(390, 1000)).toBe("mobile");
    expect(presetAt(820, 1000)).toBe("tablet");
    expect(presetAt(1000, 1000)).toBe("desktop");
    expect(presetAt(900, 1000)).toBeNull();
    expect(widthLabel(820, 1000)).toBe("Tablet · 820");
    expect(widthLabel(820, 1000, 700)).toBe("Tablet · 700");
    expect(widthLabel(900, 1000)).toBe("900 px");
  });
});

describe("DevicePreview snapping and toggle sync", () => {
  const Harness = ({ initial = "tablet" as "tablet" | "mobile" | "desktop" }) => {
    const [device, setDevice] = useState(initial);
    return (
      <>
        <DeviceToggle device={device} onChange={setDevice} />
        <DevicePreview src="http://site.test/" device={device} reloadKey={0} />
      </>
    );
  };
  const handle = () => screen.getByRole("separator", { name: "Resize preview" });
  const width = () => (handle().parentElement as HTMLElement).style.width;
  const pressed = () =>
    screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.getAttribute("aria-label"));

  it("sticks to a snap width while dragging and labels it", () => {
    render(<Harness />);
    Object.defineProperty(handle().parentElement, "offsetWidth", { configurable: true, value: 820 });
    fireEvent.pointerDown(handle(), { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 520, pointerId: 1 });
    expect(width()).toBe("860px");
    fireEvent.pointerMove(handle(), { clientX: 497, pointerId: 1 });
    expect(width()).toBe("820px");
    expect(screen.getByText("Tablet · 820")).toBeTruthy();
    fireEvent.pointerUp(handle(), { pointerId: 1 });
  });

  it("selects the preset a custom width lands on, and none off-preset", () => {
    render(<Harness initial="mobile" />);
    expect(pressed()).toEqual(["Mobile"]);
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(width()).toBe("400px");
    expect(pressed()).toEqual([]);
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(width()).toBe("390px");
    expect(pressed()).toEqual(["Mobile"]);
  });

  it("clears a custom width when a preset is picked, even the same one", () => {
    render(<Harness initial="mobile" />);
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expect(width()).toBe("390px");
    fireEvent.click(screen.getByRole("button", { name: "Tablet" }));
    expect(width()).toBe("820px");
    expect(pressed()).toEqual(["Tablet"]);
  });

  it("shows the labelled size for a second after a preset pick, then hides it", () => {
    vi.useFakeTimers();
    try {
      render(<Harness initial="mobile" />);
      expect(screen.getByText("Mobile · 390").className).toContain("opacity-0");
      fireEvent.click(screen.getByRole("button", { name: "Tablet" }));
      expect(screen.getByText("Tablet · 820").className).toContain("opacity-100");
      act(() => void vi.advanceTimersByTime(1000));
      expect(screen.getByText("Tablet · 820").className).toContain("opacity-0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rolls the number toward its target when motion is allowed", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    try {
      render(<Harness initial="mobile" />);
      fireEvent.click(screen.getByRole("button", { name: "Tablet" }));
      act(() => void vi.advanceTimersByTime(20));
      expect(screen.getByText(/^Tablet · /).textContent).not.toBe("Tablet · 820");
      act(() => void vi.advanceTimersByTime(900));
      expect(screen.getByText("Tablet · 820")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useReveal } from "./reveal";

function Probe() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} style={{ "--typren-reveal-radius": "100px" } as React.CSSProperties}>
      <button className="typren-grain" data-testid="near" />
      <button className="typren-grain" data-testid="far" />
      <iframe title="preview" />
    </div>
  );
}

const rect = (left: number, top: number) => ({ left, top, right: left + 50, bottom: top + 20, width: 50, height: 20, x: left, y: top }) as DOMRect;

describe("useReveal", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lights only surfaces within the radius and clears them on leave", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (cb(0), 0));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const view = render(<Probe />);
    const near = view.getByTestId("near");
    const far = view.getByTestId("far");
    near.getBoundingClientRect = () => rect(0, 0);
    far.getBoundingClientRect = () => rect(500, 500);
    window.dispatchEvent(new Event("resize"));
    near.dispatchEvent(new MouseEvent("pointermove", { clientX: 60, clientY: 10, bubbles: true }));
    expect(near.style.getPropertyValue("--rx")).toBe("60px");
    expect(far.style.getPropertyValue("--rx")).toBe("");
    near.parentElement!.dispatchEvent(new Event("pointerleave"));
    expect(near.style.getPropertyValue("--rx")).toBe("");
  });

  it("clears when the pointer moves into the preview iframe, not between surfaces", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (cb(0), 0));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const view = render(<Probe />);
    const near = view.getByTestId("near");
    near.getBoundingClientRect = () => rect(0, 0);
    window.dispatchEvent(new Event("resize"));
    near.dispatchEvent(new MouseEvent("pointermove", { clientX: 60, clientY: 10, bubbles: true }));
    near.dispatchEvent(new MouseEvent("pointerout", { relatedTarget: view.getByTestId("far"), bubbles: true }));
    expect(near.style.getPropertyValue("--rx")).toBe("60px");
    near.dispatchEvent(new MouseEvent("pointerout", { relatedTarget: view.getByTitle("preview"), bubbles: true }));
    expect(near.style.getPropertyValue("--rx")).toBe("");
  });

  it("does nothing for coarse pointers or reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const view = render(<Probe />);
    const near = view.getByTestId("near");
    near.dispatchEvent(new MouseEvent("pointermove", { clientX: 1, clientY: 1, bubbles: true }));
    expect(near.style.getPropertyValue("--rx")).toBe("");
  });
});

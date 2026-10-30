import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasOverlay, toRects, toScroll, type SliceRect } from "./canvas-overlay";

afterEach(cleanup);

const rects: SliceRect[] = [
  { index: 0, top: -100, left: 0, width: 390, height: 400 },
  { index: 1, top: 300, left: 20, width: 350, height: 200 },
];

function mount(active: number, selected = active, count = 2, onSave?: (i: number) => void) {
  render(
    <CanvasOverlay
      rects={rects}
      active={active}
      selected={selected}
      count={count}
      sliceNames={["hero"]}
      portal={null}
      formOpen={false}
      form={null}
      onFormOpenChange={vi.fn()}
      onInsert={vi.fn()}
      onLayers={vi.fn()}
      onDuplicate={vi.fn()}
      onSave={onSave}
      onMove={vi.fn()}
      onRemove={vi.fn()}
    />
  );
}

describe("toRects", () => {
  it("keeps well-formed rects and drops the rest", () => {
    const good = { index: 2, top: 1, left: 2, width: 3, height: 4 };
    expect(toRects([good, { ...good, index: 1.5 }, { ...good, top: "1" }, { ...good, width: Infinity }, null])).toEqual([
      good,
    ]);
    expect(toRects({ 0: good })).toEqual([]);
  });

  it("reads the scroll a rects post was measured at, or none from an older bridge", () => {
    expect(toScroll({ scrollX: 0, scrollY: 12 })).toEqual({ x: 0, y: 12 });
    expect(toScroll({ scrollY: 12 })).toBeNull();
    expect(toScroll({ scrollX: 0, scrollY: NaN })).toBeNull();
  });
});

describe("CanvasOverlay", () => {
  it("positions the outline, the Add section pill and the controls from the active slice's rect", () => {
    mount(1);
    expect(screen.getByTestId("outline-1").getAttribute("style")).toBe("top: 300px; left: 20px; width: 350px; height: 200px;");
    const pill = screen.getByRole("combobox", { name: "Add section above" }).closest(".absolute") as HTMLElement;
    expect([pill.style.top, pill.style.left]).toEqual(["300px", "195px"]);
    const toolbar = screen.getByRole("toolbar", { name: "Section" });
    expect([toolbar.style.top, toolbar.style.left]).toEqual(["calc(max(300px, var(--scroll-y, 0px)) + 8px)", "362px"]);
    const layers = screen.getByRole("button", { name: "Show in sections list" });
    expect([layers.style.top, layers.style.left]).toEqual(["calc(max(300px, var(--scroll-y, 0px)) + 8px)", "28px"]);
  });

  it("keeps the controls on screen while the slice is scrolled partly above the viewport", () => {
    mount(0);
    // max() against the page's scroll top, which the layer keeps in --scroll-y.
    expect(screen.getByRole("toolbar", { name: "Section" }).style.top).toBe("calc(max(-100px, var(--scroll-y, 0px)) + 8px)");
  });

  it("follows the page's scroll with one transform, leaving the outlines to the page", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    render(
      <CanvasOverlay
        rects={rects}
        scroll={{ x: 0, y: 40 }}
        frame={{ current: frame }}
        active={1}
        selected={0}
        count={2}
        sliceNames={["hero"]}
        portal={null}
        formOpen={false}
        form={null}
        onFormOpenChange={vi.fn()}
        onInsert={vi.fn()}
        onLayers={vi.fn()}
        onDuplicate={vi.fn()}
        onMove={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.queryByTestId("outline-1")).toBeNull();
    const layer = screen.getByRole("toolbar", { name: "Section" }).parentElement!;
    expect(layer.style.transform).toBe("translate(0px, -40px)");
    const say = (data: unknown, source: MessageEventSource | null) =>
      act(() => void window.dispatchEvent(new MessageEvent("message", { data, source, origin: "null" })));
    say({ __typren: true, type: "scroll", x: 0, y: 260 }, frame.contentWindow);
    expect(layer.style.transform).toBe("translate(0px, -260px)");
    expect(layer.style.getPropertyValue("--scroll-y")).toBe("260px");
    say({ __typren: true, type: "scroll", x: 0, y: 999 }, window);
    say({ __typren: true, type: "scroll", x: "0", y: 999 }, frame.contentWindow);
    expect(layer.style.transform).toBe("translate(0px, -260px)");
    frame.remove();
  });

  it("outlines the selected slice too when the pointer is on another one", () => {
    mount(1, 0);
    expect(screen.getByTestId("outline-0")).toBeTruthy();
    expect(screen.getByTestId("outline-1")).toBeTruthy();
  });

  it("draws nothing for a stale rect past the last slice", () => {
    mount(1, 1, 1);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("disables the phase-3 actions and the moves that would leave the list", () => {
    mount(0);
    const disabled = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-disabled") === "true";
    expect(disabled("View layouts (coming soon)")).toBe(true);
    expect(disabled("Save to Sections")).toBe(true);
    expect(disabled("Move up")).toBe(true);
    expect(disabled("Move down")).toBe(false);
  });

  it("saves the active slice to Sections when the host has a library", () => {
    const onSave = vi.fn();
    mount(1, 1, 2, onSave);
    screen.getByRole("button", { name: "Save to Sections" }).click();
    expect(onSave).toHaveBeenCalledWith(1);
  });
});

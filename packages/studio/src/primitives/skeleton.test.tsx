import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Loading, RowsSkeleton, Skeleton, TileGridSkeleton } from "./skeleton";

afterEach(cleanup);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Skeleton", () => {
  it("is hidden from assistive tech and takes the size it is given", () => {
    const { container } = render(<Skeleton className="h-9 w-24" />);
    const el = container.firstElementChild!;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("h-9");
    expect(el.className).toContain("motion-reduce:animate-none");
  });
});

describe("Loading", () => {
  it("keeps the skeleton's space but invisible for the first 150ms, then shows it", () => {
    render(<Loading ready={false} skeleton={<Skeleton className="h-9" />}>done</Loading>);
    const busy = screen.getByRole("status");
    expect(busy.className).toContain("invisible");
    act(() => void vi.advanceTimersByTime(150));
    expect(busy.className).not.toContain("invisible");
  });

  it("swaps to the content and fades it in once ready", () => {
    const animate = vi.fn();
    Element.prototype.animate = animate;
    const { rerender } = render(<Loading ready={false} skeleton={<Skeleton />}>done</Loading>);
    rerender(<Loading ready skeleton={<Skeleton />}>done</Loading>);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("done")).toBeTruthy();
    expect(animate).toHaveBeenCalledOnce();
    expect(animate.mock.calls[0]![1]).toMatchObject({ duration: 180 });
  });

  it("does not animate content that never waited", () => {
    const animate = vi.fn();
    Element.prototype.animate = animate;
    render(<Loading ready skeleton={<Skeleton />}>done</Loading>);
    expect(animate).not.toHaveBeenCalled();
  });

  it("skips the fade under reduced motion", () => {
    const animate = vi.fn();
    Element.prototype.animate = animate;
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { rerender } = render(<Loading ready={false} skeleton={<Skeleton />}>done</Loading>);
    rerender(<Loading ready skeleton={<Skeleton />}>done</Loading>);
    expect(animate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("list and grid skeletons", () => {
  it("draw rows at the real rows' height", () => {
    const { container } = render(<RowsSkeleton count={3} />);
    const rows = container.querySelectorAll('[data-slot="skeleton"]');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.className).toContain("h-[var(--typren-control-h)]");
  });

  it("draw one tile and one name line per cell, in the real grids' columns", () => {
    const a = render(<TileGridSkeleton min="9rem" aspect="square" count={3} />);
    expect(a.container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6);
    expect(a.container.firstElementChild!.className).toContain("minmax(9rem,1fr)");
    expect(a.container.querySelector(".aspect-square")).toBeTruthy();
    a.unmount();
    const t = render(<TileGridSkeleton min="13rem" aspect="4/3" count={2} />);
    expect(t.container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
    expect(t.container.firstElementChild!.className).toContain("minmax(13rem,1fr)");
    expect(t.container.querySelector(".aspect-\\[4\\/3\\]")).toBeTruthy();
  });
});

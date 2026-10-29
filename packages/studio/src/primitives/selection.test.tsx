import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { SelectionList } from "./selection";

// jsdom has no layout: a row's offsetTop comes from data-top, and its offsetParent is its parent.
beforeAll(() => {
  const top = (el: HTMLElement) => Number(el.dataset.top ?? 0);
  Object.defineProperty(HTMLElement.prototype, "offsetTop", { get() { return top(this); }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { get() { return 40; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { get() { return this.parentElement; }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const list = (current: string, hidden = false) => (
  <SelectionList>
    <div hidden={hidden}>
      {["a", "b"].map((id, i) => (
        <button key={id} data-top={i * 40} aria-current={id === current ? "page" : undefined}>
          {id}
        </button>
      ))}
    </div>
  </SelectionList>
);
const fill = (c: HTMLElement) => c.querySelector<HTMLElement>("span.typren-selected");

describe("SelectionList", () => {
  it("places the fill on first mount without a transition, then glides on a change", async () => {
    const { container, rerender } = render(list("a"));
    expect(fill(container)?.style.transform).toBe("translate(0px, 0px)");
    expect(fill(container)?.className).not.toContain("duration-[280ms]");
    const now = performance.now();
    vi.spyOn(performance, "now").mockReturnValue(now + 1000);
    rerender(list("b"));
    await waitFor(() => expect(fill(container)?.style.transform).toBe("translate(0px, 40px)"));
    expect(fill(container)?.className).toContain("duration-[280ms]");
  });

  it("jumps rather than glides while the page is still loading", async () => {
    const { container, rerender } = render(list("a"));
    rerender(list("b"));
    await waitFor(() => expect(fill(container)?.style.transform).toBe("translate(0px, 40px)"));
    expect(fill(container)?.className).not.toContain("duration-[280ms]");
  });

  it("has no fill while the selected row sits in a closed group", () => {
    const { container } = render(list("a", true));
    expect(fill(container)).toBeNull();
  });

  it("turns the transition off under reduced motion", async () => {
    const { container, rerender } = render(list("a"));
    rerender(list("b"));
    await waitFor(() => expect(fill(container)?.className).toContain("motion-reduce:transition-none"));
  });
});

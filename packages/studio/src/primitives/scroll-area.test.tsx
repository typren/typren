import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScrollArea } from "./scroll-area";

afterEach(cleanup);

describe("ScrollArea", () => {
  it.each(["vertical", "horizontal", "both"] as const)("renders its content with %s scrollbars", (scrollbars) => {
    render(<ScrollArea scrollbars={scrollbars} viewportStyle={{ paddingRight: 4 }}>content</ScrollArea>);
    const viewport = screen.getByText("content").closest<HTMLElement>("[data-slot=scroll-area-viewport]");
    expect(viewport?.style.paddingRight).toBe("4px");
  });

  it("contains overscroll only on the axes it scrolls", () => {
    render(<ScrollArea scrollbars="horizontal">wide</ScrollArea>);
    const viewport = screen.getByText("wide").closest("[data-slot=scroll-area-viewport]")!;
    expect(viewport.className).toContain("overscroll-x-contain");
    expect(viewport.className).not.toMatch(/overscroll-(y-)?contain/);
  });
});

import { describe, it, expect } from "vitest";
import { renderSlicesAsMarkdown } from "./markdown-render";
import type { Slice } from "../types";

describe("renderSlicesAsMarkdown", () => {
  it("flattens heading/body, stripping markdown emphasis markers", () => {
    const slices: Slice[] = [{ slice: "hero", heading: "**Big** deal", body: "Some **bold** body" }];
    expect(renderSlicesAsMarkdown(slices)).toBe("Big deal\nSome bold body");
  });

  it("flattens a repeating item shape (e.g. faq's items) as 'title: body' lines", () => {
    const slices: Slice[] = [
      {
        slice: "faq",
        items: [
          { question: "Q1", answer: "A1" },
          { question: "Q2", answer: "A2" },
        ],
      },
    ];
    expect(renderSlicesAsMarkdown(slices)).toBe("Q1: A1\nQ2: A2");
  });

  it("joins multiple slices with a blank line, skipping slices with no renderable output", () => {
    const slices: Slice[] = [
      { slice: "hero", heading: "H1" },
      { slice: "logoWall", logos: [] },
      { slice: "hero", heading: "H2" },
    ];
    expect(renderSlicesAsMarkdown(slices)).toBe("H1\n\nH2");
  });

  it("uses a per-slice override when provided", () => {
    const slices: Slice[] = [{ slice: "custom", note: "x" }];
    const out = renderSlicesAsMarkdown(slices, { custom: (props) => `custom:${props.note}` });
    expect(out).toBe("custom:x");
  });
});

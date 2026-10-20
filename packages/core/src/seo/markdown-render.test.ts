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

  it("degrades on malformed repeating props instead of throwing", () => {
    const bad = (props: Record<string, unknown>) => ({ slice: "x", heading: "H", ...props }) as Slice;
    expect(renderSlicesAsMarkdown([bad({ columns: { a: 1 } })])).toBe("H");
    expect(renderSlicesAsMarkdown([bad({ items: [null, 3, "s", { title: "T", body: "B" }] })])).toBe("H\nT: B");
    expect(renderSlicesAsMarkdown([bad({ columns: "nope", cards: [{ title: "C" }] })])).toBe("H\nC");
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

  it("does not resolve Object.prototype's own members as an override for an unregistered slice", () => {
    const slices: Slice[] = [{ slice: "toString", heading: "H" }];
    expect(renderSlicesAsMarkdown(slices, { custom: () => "unused" })).toBe("H");
  });
});

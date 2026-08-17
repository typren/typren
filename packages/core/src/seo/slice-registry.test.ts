import { describe, it, expect } from "vitest";
import { collectSliceJsonLd } from "./slice-registry";
import type { Slice } from "../types";
import type { SliceJsonLd } from "./types";

const registry: Record<string, SliceJsonLd> = {
  faq: (props) => ({ "@type": "FAQPage", count: (props.items as unknown[]).length }),
  multi: () => [{ "@type": "A" }, { "@type": "B" }],
  broken: () => {
    throw new Error("bad props");
  },
};

describe("collectSliceJsonLd", () => {
  it("skips slices with no registry entry", () => {
    const slices: Slice[] = [{ slice: "hero", heading: "x" }];
    expect(collectSliceJsonLd(slices, registry)).toEqual([]);
  });

  it("collects a single object result and flattens an array result", () => {
    const slices: Slice[] = [
      { slice: "faq", items: [1, 2] },
      { slice: "multi" },
    ];
    expect(collectSliceJsonLd(slices, registry)).toEqual([
      { "@type": "FAQPage", count: 2 },
      { "@type": "A" },
      { "@type": "B" },
    ]);
  });

  it("swallows a throwing slice fn instead of breaking the page", () => {
    const slices: Slice[] = [{ slice: "broken" }];
    expect(collectSliceJsonLd(slices, registry)).toEqual([]);
  });

  it("defaults to an empty registry", () => {
    expect(collectSliceJsonLd([{ slice: "faq", items: [] }])).toEqual([]);
  });
});

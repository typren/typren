import { describe, it, expect } from "vitest";
import { resolveSections, DEFAULT_SECTIONS } from "./sections";
import type { Section } from "./sections";

describe("resolveSections back-compat", () => {
  it("omitted sections resolve to the default trio", () => {
    expect(resolveSections({})).toEqual(
      DEFAULT_SECTIONS.map((s) => ({
        raw: s,
        id: s.kind,
        label: s.label,
        kind: s.kind,
        group: s.kind === "settings" ? "other" : "content",
        icon: undefined,
      }))
    );
  });

  it("empty sections array also resolves to the default trio", () => {
    expect(resolveSections({ sections: [] })).toEqual(resolveSections({}));
  });
});

describe("resolveSections custom section validation", () => {
  it("throws when a custom section provides neither element nor mount", () => {
    const sections: Section[] = [{ kind: "custom", label: "Analytics" }];
    expect(() => resolveSections({ sections })).toThrow(/exactly one of element\/mount/);
  });

  it("throws when a custom section provides both element and mount", () => {
    const sections: Section[] = [
      { kind: "custom", label: "Analytics", element: "my-panel", mount: () => {} },
    ];
    expect(() => resolveSections({ sections })).toThrow(/exactly one of element\/mount/);
  });

  it("accepts a custom section with exactly one of element/mount", () => {
    const withElement: Section[] = [{ kind: "custom", label: "Analytics", element: "my-panel" }];
    const withMount: Section[] = [{ kind: "custom", label: "Analytics", mount: () => {} }];
    expect(() => resolveSections({ sections: withElement })).not.toThrow();
    expect(() => resolveSections({ sections: withMount })).not.toThrow();
  });
});

describe("resolveSections duplicate id guard", () => {
  it("throws on duplicate explicit ids", () => {
    const sections: Section[] = [
      { kind: "collection", id: "authors", label: "Authors", dir: "content/authors", schema: {} },
      { kind: "collection", id: "authors", label: "Authors 2", dir: "content/authors2", schema: {} },
    ];
    expect(() => resolveSections({ sections })).toThrow(/duplicate section id/);
  });

  it("throws on duplicate implicit ids (two default-id pages sections)", () => {
    const sections: Section[] = [
      { kind: "pages", label: "Pages" },
      { kind: "pages", label: "Pages Again" },
    ];
    expect(() => resolveSections({ sections })).toThrow(/duplicate section id/);
  });
});

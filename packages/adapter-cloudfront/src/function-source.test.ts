import { describe, expect, it, vi } from "vitest";
import { readFunctionSource } from "./function-source";

describe("readFunctionSource", () => {
  it("defaults to the trailing-slash function", () => {
    const source = readFunctionSource();
    expect(source).toMatch(/Directory index rewrite/);
  });

  it("selects the bare-URL function when trailingSlash is false", () => {
    const source = readFunctionSource({ trailingSlash: false });
    expect(source).toMatch(/DEFAULT export shape/);
  });

  it("templates an empty passthrough object when no segments are given", () => {
    expect(readFunctionSource()).toContain('var EXTRA_PASSTHROUGH = {};');
  });

  it("templates validated segments as a JSON object literal", () => {
    const source = readFunctionSource({ extraPassthroughSegments: ["feed", "manifest"] });
    expect(source).toContain('var EXTRA_PASSTHROUGH = {"feed":true,"manifest":true};');
  });

  it("rejects a segment with unsafe characters instead of templating it in raw", () => {
    expect(() => readFunctionSource({ extraPassthroughSegments: ["feed/evil"] })).toThrow(/invalid --extra-passthrough segment/);
  });

  // The templating boundary: a segment is spliced into published JS source via
  // JSON.stringify, never string concatenation, so even a segment carrying
  // quotes/backslashes/script-breaking text can't escape its object literal.
  // Validation already rejects all of these (none are bare path-segment
  // characters), which is the primary defense; this also pins the mechanism.
  it.each([
    'a"; evil(); "',
    "a\\b",
    "</script><script>evil()</script>",
    "a' + evil() + '",
  ])("rejects the injection-shaped segment %j rather than templating it", (segment) => {
    expect(() => readFunctionSource({ extraPassthroughSegments: [segment] })).toThrow(/invalid --extra-passthrough segment/);
  });

  it("throws if a function file is missing its template placeholder (should be unreachable in practice)", async () => {
    vi.resetModules();
    vi.doMock("node:fs", () => {
      const fakeFs = { readFileSync: () => "// no placeholder in this source" };
      return { ...fakeFs, default: fakeFs };
    });
    try {
      const mod = await import("./function-source");
      expect(() => mod.readFunctionSource()).toThrow(/missing its passthrough template placeholder/);
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });

  it("produces source that is still valid, executable JS with templated segments", () => {
    const source = readFunctionSource({ extraPassthroughSegments: ["feed"] });
    const body = source.replace(/^import .*\n/m, "");
    // Constructing the Function must not throw a SyntaxError; if templating
    // ever broke out of the object literal this would fail here.
    expect(() => new Function("cf", `${body}\nreturn handler;`)({ kvs: () => ({ get: async () => undefined }) })).not.toThrow();
  });
});

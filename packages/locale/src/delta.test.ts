import { describe, expect, it } from "vitest";
import { diff, merge, assertCompatible } from "./delta";
import type { Catalog } from "./types";

describe("diff/merge round trip", () => {
  it("allowRemove applies removals, default keeps them", () => {
    const baked: Catalog = { A: { Old: "old value", Kept: "kept" } };
    const next: Catalog = { A: { Kept: "kept", New: "new value" } };

    const delta = diff(baked, next);
    expect(delta.changed).toEqual({ "A.New": "new value" });
    expect(delta.removed).toEqual(["A.Old"]);

    const withRemove = merge(baked, delta, { allowRemove: true });
    expect(withRemove).toEqual(next);

    const withoutRemove = merge(baked, delta);
    expect((withoutRemove.A as Catalog).Old).toBe("old value"); // removed key remains
    expect((withoutRemove.A as Catalog).New).toBe("new value"); // changed key applied

    // baked itself must never be mutated
    expect(baked).toEqual({ A: { Old: "old value", Kept: "kept" } });
  });

  it("returns a new object reference (for reactive re-render)", () => {
    const baked: Catalog = { A: "a" };
    const merged = merge(baked, { changed: {}, removed: [] });
    expect(merged).not.toBe(baked);
    expect(merged).toEqual(baked);
  });
});

describe("assertCompatible", () => {
  it("checks the {var} arg-set is unchanged", () => {
    expect(assertCompatible("Hello {name}", "Hi there {name}")).toBe(true);
    expect(assertCompatible("Hello {name}", "{count} left")).toBe(false);
    expect(assertCompatible("no vars here", "still none")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { diff, merge, isPlaceholderCompatible } from "./delta";
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

  it("detects removal of a key that shadows an Object.prototype member (hasOwn, not `in`)", () => {
    const from: Catalog = { toString: "custom", A: "a" };
    const to: Catalog = { A: "a" };
    // `"toString" in toFlat` is always true via the prototype chain, which
    // would silently swallow the removal.
    expect(diff(from, to).removed).toEqual(["toString"]);
  });
});

describe("prototype-pollution guards", () => {
  it("flatten (via diff) skips __proto__/constructor/prototype keys entirely", () => {
    const from: Catalog = { greet: "hi" };
    const to: Catalog = JSON.parse('{"greet":"hi","__proto__":{"polluted":"yes"},"constructor":{"x":"y"},"prototype":{"z":"w"}}');
    expect(diff(from, to)).toEqual({ changed: {}, removed: [] });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("merge skips a changed path with a dangerous segment (setPath guard)", () => {
    const baked: Catalog = { A: "a" };
    const merged = merge(baked, { changed: { "__proto__.polluted": "yes", "nested.constructor.x": "y", B: "b" }, removed: [] });
    expect(merged).toEqual({ A: "a", B: "b" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>).x).toBeUndefined();
  });

  it("merge skips a removed path with a dangerous segment (deletePath guard)", () => {
    const baked: Catalog = { A: "a" };
    const merged = merge(baked, { changed: {}, removed: ["__proto__.polluted", "constructor"] }, { allowRemove: true });
    expect(merged).toEqual({ A: "a" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("isPlaceholderCompatible", () => {
  it("checks the {var} arg-set is unchanged", () => {
    expect(isPlaceholderCompatible("Hello {name}", "Hi there {name}")).toBe(true);
    expect(isPlaceholderCompatible("Hello {name}", "{count} left")).toBe(false);
    expect(isPlaceholderCompatible("no vars here", "still none")).toBe(true);
  });
});

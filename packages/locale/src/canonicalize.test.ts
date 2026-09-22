import { describe, expect, it } from "vitest";
import { canonicalize, hashCatalog } from "./canonicalize";
import type { Catalog } from "./types";

describe("hashCatalog", () => {
  it("is deterministic across reparse and key order", () => {
    const catalog: Catalog = { B: "second", A: { z: "one", y: "two" } };
    const reparsed: Catalog = JSON.parse(JSON.stringify(catalog));
    const reordered: Catalog = { A: { y: "two", z: "one" }, B: "second" };

    expect(hashCatalog(catalog)).toBe(hashCatalog(reparsed));
    expect(hashCatalog(catalog)).toBe(hashCatalog(reordered));
    expect(hashCatalog(catalog)).toHaveLength(16);
  });

  it("changes when a leaf value changes", () => {
    const a: Catalog = { Greeting: { Hello: "hi" } };
    const b: Catalog = { Greeting: { Hello: "hey" } };
    expect(hashCatalog(a)).not.toBe(hashCatalog(b));
  });
});

describe("canonicalize", () => {
  it("normalizes line endings and unicode form", () => {
    const withCrlf: Catalog = { a: "line1\r\nline2" };
    const withLf: Catalog = { a: "line1\nline2" };
    expect(canonicalize(withCrlf)).toBe(canonicalize(withLf));
  });
});

import { describe, expect, it } from "vitest";
import { canonicalize, hashCatalog } from "./canonicalize";
import type { Catalog } from "./types";

describe("hashCatalog", () => {
  it("is deterministic across reparse and key order", async () => {
    const catalog: Catalog = { B: "second", A: { z: "one", y: "two" } };
    const reparsed: Catalog = JSON.parse(JSON.stringify(catalog));
    const reordered: Catalog = { A: { y: "two", z: "one" }, B: "second" };

    expect(await hashCatalog(catalog)).toBe(await hashCatalog(reparsed));
    expect(await hashCatalog(catalog)).toBe(await hashCatalog(reordered));
  });

  it("is the full untruncated sha256 hex digest", async () => {
    const hash = await hashCatalog({ A: "a" });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a leaf value changes", async () => {
    const a: Catalog = { Greeting: { Hello: "hi" } };
    const b: Catalog = { Greeting: { Hello: "hey" } };
    expect(await hashCatalog(a)).not.toBe(await hashCatalog(b));
  });

  it("excludes a __proto__ subtree consistently from hash and serialization", async () => {
    const polluted: Catalog = JSON.parse('{"greet":"hi","__proto__":{"polluted":"yes"}}');
    const clean: Catalog = { greet: "hi" };

    // The dangerous key is EXCLUDED from both, same hash, same bytes, so
    // the published bytes and the content address never disagree about it.
    expect(canonicalize(polluted)).toBe(canonicalize(clean));
    expect(await hashCatalog(polluted)).toBe(await hashCatalog(clean));
    expect(canonicalize(polluted)).not.toContain("polluted");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("canonicalize", () => {
  it("normalizes line endings and unicode form", () => {
    const withCrlf: Catalog = { a: "line1\r\nline2" };
    const withLf: Catalog = { a: "line1\nline2" };
    expect(canonicalize(withCrlf)).toBe(canonicalize(withLf));
  });
});

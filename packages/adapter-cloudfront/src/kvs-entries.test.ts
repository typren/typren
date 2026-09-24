import { describe, expect, it } from "vitest";
import { toKvsEntries, KVS_MAX_KEY_BYTES, KVS_MAX_VALUE_BYTES } from "./kvs-entries";
import type { RedirectEntry } from "@typren/core";

describe("toKvsEntries", () => {
  it("maps from/to into key/value pairs, emitting the canonical trailing-slash target", () => {
    const entries: RedirectEntry[] = [{ from: "/old", to: "/new", slug: "new" }];
    expect(toKvsEntries(entries)).toEqual([{ key: "/old", value: "/new/" }]);
  });

  it("emits the site root as a bare '/'", () => {
    const entries: RedirectEntry[] = [{ from: "/old-home", to: "/", slug: "home" }];
    expect(toKvsEntries(entries)).toEqual([{ key: "/old-home", value: "/" }]);
  });

  it("passes external URL targets through verbatim, no slash appended", () => {
    const entries: RedirectEntry[] = [
      { from: "/press", to: "https://example.com/story", slug: "map:m.json" },
    ];
    expect(toKvsEntries(entries)).toEqual([{ key: "/press", value: "https://example.com/story" }]);
  });

  it("carries a query or fragment through the slash canonicalization intact", () => {
    const entries: RedirectEntry[] = [
      { from: "/old", to: "/new?utm=1", slug: "map:m.json" },
      { from: "/old2", to: "/new/?keep=1", slug: "map:m.json" },
      { from: "/old3", to: "/new#section", slug: "map:m.json" },
    ];
    expect(toKvsEntries(entries).map((e) => e.value)).toEqual(["/new/?utm=1", "/new/?keep=1", "/new/#section"]);
  });

  it("appendSlash: false emits on-site targets verbatim (bare-URL-canonical sites)", () => {
    const entries: RedirectEntry[] = [{ from: "/old", to: "/new", slug: "map:m.json" }];
    expect(toKvsEntries(entries, { appendSlash: false })).toEqual([{ key: "/old", value: "/new" }]);
  });

  it("stores the key percent-encoded, the form the edge sees", () => {
    const entries: RedirectEntry[] = [{ from: "/café page", to: "/new", slug: "map:m.json" }];
    expect(toKvsEntries(entries)[0].key).toBe("/caf%C3%A9%20page");
  });

  it("leaves on-site file targets and already-slashed targets untouched", () => {
    const entries: RedirectEntry[] = [
      { from: "/old-report", to: "/docs/report.pdf", slug: "map:m.json" },
      { from: "/old-hub", to: "/hub/", slug: "map:m.json" },
    ];
    expect(toKvsEntries(entries)).toEqual([
      { key: "/old-report", value: "/docs/report.pdf" },
      { key: "/old-hub", value: "/hub/" },
    ]);
  });

  it("throws when a key exceeds the KVS byte limit", () => {
    const from = `/${"a".repeat(KVS_MAX_KEY_BYTES)}`;
    const entries: RedirectEntry[] = [{ from, to: "/new", slug: "new" }];
    expect(() => toKvsEntries(entries)).toThrow(/512-byte key limit/);
  });

  it("throws when a value exceeds the KVS byte limit, counting the appended slash", () => {
    const to = `/${"a".repeat(KVS_MAX_VALUE_BYTES - 1)}`;
    const entries: RedirectEntry[] = [{ from: "/old", to, slug: "new" }];
    expect(() => toKvsEntries(entries)).toThrow(/1024-byte value limit/);
  });
});

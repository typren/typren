import { describe, expect, it } from "vitest";
import { toKvEntries, KV_MAX_KEY_BYTES } from "./kv-entries";
import type { RedirectEntry } from "@typren/core";

// The pair-building logic itself (trailing-slash canonicalization,
// appendSlash, percent-encoding) is @typren/core's toRedirectPairs and is
// tested there; this covers what's actually Cloudflare-specific: wrapping it
// with the KV key byte limit.
describe("toKvEntries", () => {
  it("maps from/to into key/value pairs, emitting the canonical trailing-slash target", () => {
    const entries: RedirectEntry[] = [{ from: "/old", to: "/new", slug: "new" }];
    expect(toKvEntries(entries)).toEqual([{ key: "/old", value: "/new/" }]);
  });

  it("emits targets verbatim with appendSlash: false", () => {
    const entries: RedirectEntry[] = [{ from: "/old", to: "/new", slug: "new" }];
    expect(toKvEntries(entries, { appendSlash: false })).toEqual([{ key: "/old", value: "/new" }]);
  });

  it("throws when a key exceeds the KV byte limit", () => {
    const from = `/${"a".repeat(KV_MAX_KEY_BYTES)}`;
    const entries: RedirectEntry[] = [{ from, to: "/new", slug: "new" }];
    expect(() => toKvEntries(entries)).toThrow(/512-byte key limit/);
  });
});

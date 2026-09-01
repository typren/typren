import { describe, expect, it } from "vitest";
import { toKvsEntries, KVS_MAX_KEY_BYTES, KVS_MAX_VALUE_BYTES } from "./kvs-entries";
import type { RedirectEntry } from "@typren/core";

describe("toKvsEntries", () => {
  it("maps from/to into key/value pairs", () => {
    const entries: RedirectEntry[] = [{ from: "/old", to: "/new", slug: "new" }];
    expect(toKvsEntries(entries)).toEqual([{ key: "/old", value: "/new" }]);
  });

  it("throws when a key exceeds the KVS byte limit", () => {
    const from = `/${"a".repeat(KVS_MAX_KEY_BYTES)}`;
    const entries: RedirectEntry[] = [{ from, to: "/new", slug: "new" }];
    expect(() => toKvsEntries(entries)).toThrow(/512-byte key limit/);
  });

  it("throws when a value exceeds the KVS byte limit", () => {
    const to = `/${"a".repeat(KVS_MAX_VALUE_BYTES)}`;
    const entries: RedirectEntry[] = [{ from: "/old", to, slug: "new" }];
    expect(() => toKvsEntries(entries)).toThrow(/1024-byte value limit/);
  });
});

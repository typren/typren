import { describe, expect, it, vi } from "vitest";
import { syncRedirects, KVS_UPDATE_BATCH_SIZE } from "./sync";
import type { KvsClient, KvsPair } from "./types";

/** Stand-in KvsClient over an in-memory map, so sync.ts's diff/chunk/ETag
 *  logic is tested without touching real AWS. ETag is just a counter,
 *  bumped on every write, and `updateKeys` rejects a stale one — the same
 *  CAS contract the real store enforces. */
function fakeKvsClient(seed: Record<string, string> = {}, status = "READY") {
  const store = new Map(Object.entries(seed));
  let etag = "etag-0";
  const updateKeysCalls: Array<{ etag: string; puts: KvsPair[]; deletes: string[] }> = [];

  const client: KvsClient = {
    async describeStore() {
      return { arn: "arn:aws:cloudfront::store/fake", status };
    },
    async listKeys() {
      return { items: [...store.entries()].map(([key, value]) => ({ key, value })), etag };
    },
    async updateKeys(_arn, ifMatch, puts, deletes) {
      if (ifMatch !== etag) throw new Error(`stale ETag: expected ${etag}, got ${ifMatch}`);
      updateKeysCalls.push({ etag: ifMatch, puts, deletes });
      for (const { key, value } of puts) store.set(key, value);
      for (const key of deletes) store.delete(key);
      etag = `etag-${updateKeysCalls.length}`;
      return { etag };
    },
  };
  return { client, store, updateKeysCalls };
}

describe("syncRedirects", () => {
  it("reports no-op and writes nothing when already in sync", async () => {
    const { client, updateKeysCalls } = fakeKvsClient({ "/old": "/new" });
    const result = await syncRedirects(client, "store", new Map([["/old", "/new"]]));
    expect(result).toEqual({ puts: [], deletes: [], applied: false });
    expect(updateKeysCalls).toHaveLength(0);
  });

  it("computes puts for new/changed keys and deletes for keys no longer wanted", async () => {
    const { client, store } = fakeKvsClient({ "/stale": "/x", "/changed": "/old-target" });
    const want = new Map([
      ["/changed", "/new-target"],
      ["/fresh", "/y"],
    ]);
    const result = await syncRedirects(client, "store", want);
    expect(result.applied).toBe(true);
    expect(result.puts).toEqual(
      expect.arrayContaining([
        { key: "/changed", value: "/new-target" },
        { key: "/fresh", value: "/y" },
      ])
    );
    expect(result.deletes).toEqual(["/stale"]);
    expect([...store.entries()]).toEqual(
      expect.arrayContaining([
        ["/changed", "/new-target"],
        ["/fresh", "/y"],
      ])
    );
    expect(store.has("/stale")).toBe(false);
  });

  it("dry-run computes the diff without writing", async () => {
    const { client, store, updateKeysCalls } = fakeKvsClient({ "/stale": "/x" });
    const result = await syncRedirects(client, "store", new Map([["/fresh", "/y"]]), { dryRun: true });
    expect(result.applied).toBe(false);
    expect(result.puts).toEqual([{ key: "/fresh", value: "/y" }]);
    expect(result.deletes).toEqual(["/stale"]);
    expect(updateKeysCalls).toHaveLength(0);
    expect(store.has("/stale")).toBe(true); // untouched
  });

  it("throws when the store isn't READY", async () => {
    const { client } = fakeKvsClient({}, "PROVISIONING");
    await expect(syncRedirects(client, "store", new Map())).rejects.toThrow(/is PROVISIONING, not READY/);
  });

  it("chunks a changeset larger than the 50-change API cap, chaining the ETag through each call", async () => {
    const want = new Map(Array.from({ length: 120 }, (_, i) => [`/p${i}`, `/t${i}`]));
    const { client, store, updateKeysCalls } = fakeKvsClient({});
    const result = await syncRedirects(client, "store", want);

    expect(result.applied).toBe(true);
    // 120 puts / 50 per call = 3 calls.
    expect(updateKeysCalls).toHaveLength(3);
    expect(updateKeysCalls[0].puts).toHaveLength(KVS_UPDATE_BATCH_SIZE);
    expect(updateKeysCalls[1].puts).toHaveLength(KVS_UPDATE_BATCH_SIZE);
    expect(updateKeysCalls[2].puts).toHaveLength(20);

    // Each call's ETag is the previous call's returned ETag (chained, not reused).
    expect(updateKeysCalls[0].etag).toBe("etag-0");
    expect(updateKeysCalls[1].etag).toBe("etag-1");
    expect(updateKeysCalls[2].etag).toBe("etag-2");

    expect(store.size).toBe(120);
  });

  it("propagates a client error instead of silently swallowing it", async () => {
    const client: KvsClient = {
      describeStore: vi.fn().mockRejectedValue(new Error("boom")),
      listKeys: vi.fn(),
      updateKeys: vi.fn(),
    };
    await expect(syncRedirects(client, "store", new Map())).rejects.toThrow("boom");
  });
});

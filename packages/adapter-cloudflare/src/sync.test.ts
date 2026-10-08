import { describe, expect, it, vi } from "vitest";
import { syncRedirects } from "./sync";
import type { KvClient } from "./types";

/** Stand-in KvClient over an in-memory map, so sync.ts's diff logic is
 *  tested without touching a real Cloudflare account. */
function fakeKvClient(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  const putManyCalls: { key: string; value: string }[][] = [];
  const deleteManyCalls: string[][] = [];

  const client: KvClient = {
    async listKeys() {
      return [...store.keys()];
    },
    async putMany(pairs) {
      putManyCalls.push(pairs);
      for (const { key, value } of pairs) store.set(key, value);
    },
    async deleteMany(keys) {
      deleteManyCalls.push(keys);
      for (const key of keys) store.delete(key);
    },
  };
  return { client, store, putManyCalls, deleteManyCalls };
}

describe("syncRedirects", () => {
  it("re-puts the wanted map and deletes nothing when already in sync", async () => {
    const { client, putManyCalls, deleteManyCalls } = fakeKvClient({ "/old": "/new" });
    const result = await syncRedirects(client, new Map([["/old", "/new"]]));
    expect(result).toEqual({ puts: [{ key: "/old", value: "/new" }], deletes: [], applied: true });
    // Still re-puts the wanted pair under the hood (KV put is idempotent,
    // see sync.ts's ponytail note); only the SET of keys is diffed.
    expect(putManyCalls).toEqual([[{ key: "/old", value: "/new" }]]);
    expect(deleteManyCalls).toHaveLength(0);
  });

  it("puts every wanted pair and deletes keys no longer wanted", async () => {
    const { client, store } = fakeKvClient({ "/stale": "/x", "/kept": "/y" });
    const want = new Map([
      ["/kept", "/y"],
      ["/fresh", "/z"],
    ]);
    const result = await syncRedirects(client, want);
    expect(result).toEqual({
      puts: [
        { key: "/kept", value: "/y" },
        { key: "/fresh", value: "/z" },
      ],
      deletes: ["/stale"],
      applied: true,
    });
    expect([...store.entries()]).toEqual(expect.arrayContaining([["/kept", "/y"], ["/fresh", "/z"]]));
    expect(store.has("/stale")).toBe(false);
  });

  it("dry-run computes the diff without writing", async () => {
    const { client, store, putManyCalls, deleteManyCalls } = fakeKvClient({ "/stale": "/x" });
    const result = await syncRedirects(client, new Map([["/fresh", "/y"]]), { dryRun: true });
    expect(result).toEqual({ puts: [{ key: "/fresh", value: "/y" }], deletes: ["/stale"], applied: false });
    expect(putManyCalls).toHaveLength(0);
    expect(deleteManyCalls).toHaveLength(0);
    expect(store.has("/stale")).toBe(true); // untouched
  });

  it("refuses to delete every live key when the desired state is empty", async () => {
    const { client, store } = fakeKvClient({ "/a": "/x", "/b": "/y" });
    await expect(syncRedirects(client, new Map())).rejects.toThrow(/refusing to delete all 2 live/);
    expect(store.size).toBe(2); // nothing was written

    // dry-run still reports the would-be wipe without the guard tripping
    const dry = await syncRedirects(client, new Map(), { dryRun: true });
    expect(dry).toEqual({ puts: [], deletes: ["/a", "/b"], applied: false });

    // the explicit escape hatch really does unpublish everything
    const wiped = await syncRedirects(client, new Map(), { allowEmpty: true });
    expect(wiped).toEqual({ puts: [], deletes: ["/a", "/b"], applied: true });
    expect(store.size).toBe(0);
  });

  it("no-ops cleanly when both the store and the desired state are empty", async () => {
    const { client, putManyCalls, deleteManyCalls } = fakeKvClient({});
    const result = await syncRedirects(client, new Map());
    expect(result).toEqual({ puts: [], deletes: [], applied: false });
    expect(putManyCalls).toHaveLength(0);
    expect(deleteManyCalls).toHaveLength(0);
  });

  it("propagates a client error instead of silently swallowing it", async () => {
    const client: KvClient = {
      listKeys: vi.fn().mockRejectedValue(new Error("boom")),
      putMany: vi.fn(),
      deleteMany: vi.fn(),
    };
    await expect(syncRedirects(client, new Map())).rejects.toThrow("boom");
  });
});

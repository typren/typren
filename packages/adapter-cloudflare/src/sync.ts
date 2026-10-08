import type { KvClient } from "./types";

export type SyncOptions = {
  dryRun?: boolean;
  /** Permit a sync whose desired state is EMPTY to delete every live key.
   *  Off by default: an empty `want` is far more often a wrong cwd or a
   *  mistyped flag than a real intention to unpublish every redirect
   *  (mirrors `@typren/adapter-cloudfront`'s `syncRedirects`). */
  allowEmpty?: boolean;
};

export type SyncResult = {
  /** Keys newly appearing in the desired state (not previously live). */
  put: string[];
  /** Live keys no longer wanted. */
  deleted: string[];
  /** Keys live in both the current store and the desired state. */
  unchanged: number;
};

/**
 * Idempotent sync of `want` into the Workers KV namespace behind `client`.
 *
 * ponytail: Workers KV's own `list` only returns keys, not values (and a
 * per-key `get` to diff values would be one more `wrangler` call per
 * existing key, O(n) subprocess spawns). Instead of diffing values, every
 * wanted pair is re-put unconditionally on every sync (KV `put` is
 * idempotent) and only the key SETS are diffed, to compute `deleted` and to
 * report `put`/`unchanged` for a human-readable CLI/dry-run summary. Write
 * volume is the full redirect map on every sync, fine under KV's free tier
 * for maps up to roughly 1000 entries; upgrade path if that ever matters is
 * a `get`-based value diff, same shape as adapter-cloudfront's `sync.ts`.
 */
export async function syncRedirects(client: KvClient, want: Map<string, string>, opts: SyncOptions = {}): Promise<SyncResult> {
  const live = new Set(await client.listKeys());

  const put = [...want.keys()].filter((key) => !live.has(key));
  const unchanged = [...want.keys()].filter((key) => live.has(key)).length;
  const deleted = [...live].filter((key) => !want.has(key));

  if (want.size === 0 && deleted.length > 0 && !opts.allowEmpty && !opts.dryRun) {
    throw new Error(
      `typren: refusing to delete all ${deleted.length} live redirect(s) because the desired state is empty — ` +
        `usually a wrong working directory or a missing --map. Pass --allow-empty if unpublishing everything is intended.`
    );
  }

  if (opts.dryRun) {
    return { put, deleted, unchanged };
  }

  // Puts before deletes: a partially failed sync (process killed mid-write)
  // then leaves stale-but-still-redirecting keys rather than a 404 for a
  // live page, and re-running converges either way.
  if (want.size > 0) {
    await client.putMany([...want].map(([key, value]) => ({ key, value })));
  }
  if (deleted.length > 0) {
    await client.deleteMany(deleted);
  }

  return { put, deleted, unchanged };
}

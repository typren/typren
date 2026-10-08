import type { KvClient, KvPair } from "./types";

export type SyncOptions = {
  dryRun?: boolean;
  /** Permit a sync whose desired state is EMPTY to delete every live key.
   *  Off by default: an empty `want` is far more often a wrong cwd or a
   *  mistyped flag than a real intention to unpublish every redirect
   *  (mirrors `@typren/adapter-cloudfront`'s `syncRedirects`). */
  allowEmpty?: boolean;
};

// Same shape as `@typren/adapter-cloudfront`'s SyncResult, so tooling that
// drives either adapter reads one result type.
export type SyncResult = {
  /** Every wanted pair: this sync re-puts the whole map (see below). */
  puts: KvPair[];
  /** Live keys no longer wanted. */
  deletes: string[];
  /** False for `dryRun` and for an empty store with nothing wanted, either way nothing was written. */
  applied: boolean;
};

/**
 * Idempotent sync of `want` into the Workers KV namespace behind `client`.
 *
 * ponytail: Workers KV's own `list` only returns keys, not values (and a
 * per-key `get` to diff values would be one more `wrangler` call per
 * existing key, O(n) subprocess spawns). Instead of diffing values, every
 * wanted pair is re-put unconditionally on every sync (KV `put` is
 * idempotent) and only the key SETS are diffed, to compute `deletes`. Write
 * volume is the full redirect map on every sync, fine under KV's free tier
 * for maps up to roughly 1000 entries; upgrade path if that ever matters is
 * a `get`-based value diff, same shape as adapter-cloudfront's `sync.ts`.
 */
export async function syncRedirects(client: KvClient, want: Map<string, string>, opts: SyncOptions = {}): Promise<SyncResult> {
  const live = new Set(await client.listKeys());

  const puts = [...want].map(([key, value]) => ({ key, value }));
  const deletes = [...live].filter((key) => !want.has(key));

  if (want.size === 0 && deletes.length > 0 && !opts.allowEmpty && !opts.dryRun) {
    throw new Error(
      `typren: refusing to delete all ${deletes.length} live redirect(s) because the desired state is empty — ` +
        `usually a wrong working directory or a missing --map. Pass --allow-empty if unpublishing everything is intended.`
    );
  }

  if (opts.dryRun) {
    return { puts, deletes, applied: false };
  }

  // Puts before deletes: a partially failed sync (process killed mid-write)
  // then leaves stale-but-still-redirecting keys rather than a 404 for a
  // live page, and re-running converges either way.
  if (puts.length > 0) {
    await client.putMany(puts);
  }
  if (deletes.length > 0) {
    await client.deleteMany(deletes);
  }

  return { puts, deletes, applied: puts.length > 0 || deletes.length > 0 };
}

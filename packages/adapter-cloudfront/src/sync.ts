import type { KvsClient, KvsPair } from "./types";

// The CloudFront KVS UpdateKeys API caps a single request at 50 combined
// puts+deletes. https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_UpdateKeys.html
export const KVS_UPDATE_BATCH_SIZE = 50;

export type SyncOptions = {
  dryRun?: boolean;
};

export type SyncResult = {
  puts: KvsPair[];
  deletes: string[];
  /** False for both "already in sync" and `dryRun` — either way nothing was written. */
  applied: boolean;
};

/**
 * Idempotent diff-sync of `want` into the CloudFront KeyValueStore named
 * `storeName`: computes puts (new or changed keys) and deletes (live keys no
 * longer wanted), no-ops when there's nothing to do, and otherwise chunks the
 * change list at the API's 50-change cap, chaining each write's returned
 * ETag into the next (an ETag is single-use — reusing a stale one 412s).
 * `dryRun` computes and returns the diff without writing.
 */
export async function syncRedirects(client: KvsClient, storeName: string, want: Map<string, string>, opts: SyncOptions = {}): Promise<SyncResult> {
  const store = await client.describeStore(storeName);
  if (store.status !== "READY") {
    throw new Error(`typren: KeyValueStore "${storeName}" is ${store.status}, not READY — try again shortly.`);
  }

  const { items: live, etag: initialEtag } = await client.listKeys(store.arn);
  const liveMap = new Map(live.map(({ key, value }) => [key, value]));

  const puts = [...want].filter(([key, value]) => liveMap.get(key) !== value).map(([key, value]) => ({ key, value }));
  const deletes = [...liveMap.keys()].filter((key) => !want.has(key));

  if ((puts.length === 0 && deletes.length === 0) || opts.dryRun) {
    return { puts, deletes, applied: false };
  }

  const changes: Array<{ put?: KvsPair; del?: string }> = [...puts.map((put) => ({ put })), ...deletes.map((del) => ({ del }))];
  let etag = initialEtag;
  for (let i = 0; i < changes.length; i += KVS_UPDATE_BATCH_SIZE) {
    const batch = changes.slice(i, i + KVS_UPDATE_BATCH_SIZE);
    const batchPuts = batch.filter((c): c is { put: KvsPair } => c.put !== undefined).map((c) => c.put);
    const batchDeletes = batch.filter((c): c is { del: string } => c.del !== undefined).map((c) => c.del);
    ({ etag } = await client.updateKeys(store.arn, etag, batchPuts, batchDeletes));
  }

  return { puts, deletes, applied: true };
}

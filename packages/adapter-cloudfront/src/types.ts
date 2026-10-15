/** One live key/value pair in a CloudFront KeyValueStore. */
export type KvsPair = { key: string; value: string };

/**
 * The data-plane operations `sync.ts` needs against a CloudFront
 * KeyValueStore. Injected everywhere (never constructed by the sync engine
 * itself) so the diff/chunk/ETag-chain logic is unit-testable without real
 * AWS. `createAwsCliKvsClient` (aws-cli-clients.ts) is the real
 * implementation.
 */
export interface KvsClient {
  /** Resolves a store name to its ARN + status ("READY", "PROVISIONING", ...). */
  describeStore(name: string): Promise<{ arn: string; status: string }>;
  /** Every live key/value pair, plus the ETag to CAS the first write against. */
  listKeys(arn: string): Promise<{ items: KvsPair[]; etag: string }>;
  /** Applies at most 50 puts/deletes in one call, CAS'd on `etag`. Returns the
   *  new ETag so a caller chunking a larger changeset can chain the next call. */
  updateKeys(arn: string, etag: string, puts: KvsPair[], deletes: string[]): Promise<{ etag: string }>;
}

/** A cache behavior target for `setViewerRequestFunction`: `"default"` for
 *  the distribution's `DefaultCacheBehavior`, or a `CacheBehavior`'s own
 *  `PathPattern` string (must already exist on the distribution). */
export type CacheBehaviorTarget = string;

/**
 * The control-plane operations `bootstrap.ts` needs. Kept to exactly the
 * calls bootstrap makes, see that file for why each whole-object-write
 * AWS API (function config, `FunctionAssociations`) is collapsed behind a
 * single guarded method instead of exposing the raw AWS shapes here.
 */
export interface CloudFrontClient {
  /** Names of viewer-request functions currently associated with ANY cache
   *  behavior on the distribution (the default behavior and every
   *  `CacheBehaviors` entry), de-duplicated. A distribution with extra
   *  behaviors (`/assets/*`, `/api/*`) can carry a different function on one
   *  of them even when the default looks clean, so the already-attached
   *  guard in bootstrap.ts must see the whole distribution, not just the
   *  behavior it's about to touch. */
  getAttachedFunctionNames(distributionId: string): Promise<string[]>;
  createKeyValueStore(name: string, comment: string): Promise<{ arn: string; status: string }>;
  /** Creates the function if absent, else updates it (code + KVS association
   *  is a whole-object write either way), then publishes DEVELOPMENT -> LIVE.
   *  Returns the published function's ARN, ready to associate. */
  upsertFunction(name: string, code: string, kvsArn: string, comment: string): Promise<{ arn: string }>;
  /** Associates `functionArn` as the viewer-request function on each of
   *  `behaviors` (or literally `"*"` for every behavior, default included),
   *  REPLACING whatever viewer-request function was on each targeted
   *  behavior and keeping associations for other event types there
   *  (`FunctionAssociations` is a whole-list write covering every event
   *  type, not an append; see redirects.function.js's own doc comment).
   *  Throws if a named behavior other than `"default"` doesn't exist on the
   *  distribution (a typo'd `--behavior` must fail loud, not silently skip). */
  setViewerRequestFunction(distributionId: string, functionArn: string, behaviors: CacheBehaviorTarget[] | "*"): Promise<void>;
}

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

/**
 * The control-plane operations `bootstrap.ts` needs. Kept to exactly the
 * four calls bootstrap makes — see that file for why each whole-object-write
 * AWS API (function config, `FunctionAssociations`) is collapsed behind a
 * single guarded method instead of exposing the raw AWS shapes here.
 */
export interface CloudFrontClient {
  /** Names of viewer-request functions currently associated with the
   *  distribution's default cache behavior (empty if none). */
  getAttachedFunctionNames(distributionId: string): Promise<string[]>;
  createKeyValueStore(name: string, comment: string): Promise<{ arn: string; status: string }>;
  /** Creates the function if absent, else updates it (code + KVS association
   *  is a whole-object write either way), then publishes DEVELOPMENT -> LIVE.
   *  Returns the published function's ARN, ready to associate. */
  upsertFunction(name: string, code: string, kvsArn: string, comment: string): Promise<{ arn: string }>;
  /** Associates `functionArn` as the distribution's viewer-request function,
   *  REPLACING whatever was there (`FunctionAssociations` is a whole-list
   *  write, not an append — see redirects.function.js's own doc comment). */
  setViewerRequestFunction(distributionId: string, functionArn: string): Promise<void>;
}

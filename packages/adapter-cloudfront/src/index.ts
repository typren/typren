// CloudFront host adapter: the canonical viewer-request function, the
// redirects()->KVS sync engine, and the guarded distribution bootstrap. The
// `typren-cloudfront` CLI (cli.ts) wires these to the AWS-CLI-backed default
// clients; every piece here takes an injected KvsClient/CloudFrontClient so
// a host can swap in its own (or a test can fake it) without touching AWS.
export { readFunctionSource } from "./function-source";
export { toKvsEntries, KVS_MAX_KEY_BYTES, KVS_MAX_VALUE_BYTES } from "./kvs-entries";
export { syncRedirects, KVS_UPDATE_BATCH_SIZE, type SyncOptions, type SyncResult } from "./sync";
export { bootstrapDistribution, DEFAULT_FUNCTION_NAME, type BootstrapOptions, type BootstrapResult } from "./bootstrap";
export { scanContentStore } from "./content-scan";
export { createAwsCliKvsClient, createAwsCliCloudFrontClient } from "./aws-cli-clients";
export type { KvsClient, CloudFrontClient, KvsPair } from "./types";

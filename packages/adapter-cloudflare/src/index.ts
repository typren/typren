// Cloudflare Workers + Static Assets host adapter: `wrangler.jsonc`
// rendering, the redirects()->KV sync engine, and the `typren-cloudflare`
// CLI's building blocks. The CLI (cli.ts) wires these to the wrangler-CLI-
// backed default client; `syncRedirects` takes an injected `KvClient` so a
// host can swap in its own (or a test can fake it) without touching
// Cloudflare. The Worker itself is the separate `"./worker"` export, kept
// out of this entry point so it never drags `@typren/core`'s root (and its
// node/jsdom/sharp dependencies) into a wrangler bundle.
export { renderWranglerConfig, type RenderWranglerConfigOptions } from "./wrangler-config";
export { toKvEntries, KV_MAX_KEY_BYTES, type ToKvEntriesOptions } from "./kv-entries";
export { syncRedirects, type SyncOptions, type SyncResult } from "./sync";
export { createWranglerKvClient, runWrangler, createRedirectsNamespace, deploy, REDIRECTS_BINDING, REDIRECTS_NAMESPACE } from "./wrangler-cli";
// Host-agnostic redirect sourcing lives in @typren/core; re-exported here so
// this package's CLI/tests can import everything from one place.
export { scanContentStore, loadRedirectMap, mergeRedirectEntries, type RedirectMapEntry } from "@typren/core";
export type { KvClient, KvPair, Env } from "./types";

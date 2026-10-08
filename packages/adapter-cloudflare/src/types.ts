/**
 * Minimal shape of the Worker's `env` this adapter needs: the Static Assets
 * binding every Workers+Assets project gets, and the optional KV binding for
 * redirects (absent on a site deployed before `bootstrap` has created the
 * namespace, see worker.ts). Kept local instead of depending on
 * `@cloudflare/workers-types`, a type-only dependency not worth adding for
 * two method signatures already shaped by the fetch/KV standards.
 */
export type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  REDIRECTS?: { get(key: string): Promise<string | null> };
};

/** The data-plane operations `sync.ts` needs against a Workers KV namespace.
 *  Injected everywhere (never constructed by the sync engine itself) so the
 *  diff logic is unit-testable without a real Cloudflare account.
 *  `createWranglerKvClient` (wrangler-cli.ts) is the real implementation,
 *  shelling out to `wrangler kv`. No `get`/value-read method: sync.ts
 *  re-puts every wanted pair rather than diffing values, see its own doc
 *  comment for why. */
export type KvPair = { key: string; value: string };

export interface KvClient {
  listKeys(): Promise<string[]>;
  putMany(pairs: KvPair[]): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
}

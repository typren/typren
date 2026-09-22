import type { Catalog, Manifest } from "../types";
import { diff, merge } from "../delta";
import { hashCatalog } from "../canonicalize";

/**
 * Minimal storage contract, shaped like `localStorage` (`getItem`/`setItem`)
 * so real `localStorage` can be passed straight through with no adapter.
 * `removeItem`/`key`/`length` are OPTIONAL — a plain two-method object still
 * satisfies the type — and only enable best-effort eviction of stale cache
 * entries when present (real `localStorage` has all three).
 */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
  key?(index: number): string | null;
  readonly length?: number;
}

function createMemoryStorage(): KVStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

/**
 * Defaults to real `localStorage` when present (browser/jsdom), else an
 * in-memory stand-in (SSR, or a worker with no Storage global). Accessing
 * `localStorage` itself can throw in some private-mode browsers, not just
 * reading/writing it, so the probe is guarded too.
 */
function defaultStorage(): KVStorage {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // fall through to memory
  }
  return createMemoryStorage();
}

// Cache reads/writes get their own try/catch, separate from the outer
// fail-to-baked guard in loadMessages: a private-window write failure (quota
// exceeded, storage disabled) must not discard an already-verified merge —
// caching is best-effort, the returned catalog isn't contingent on it.
function safeGet(storage: KVStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: KVStorage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false; // best-effort cache; swallow (private window / quota exceeded)
  }
}

/**
 * Best-effort removal of this {app,lang}'s cache entries from OTHER build
 * versions — every deploy changes the cache key, so without eviction old
 * entries accumulate in localStorage forever. Skipped entirely when the
 * storage doesn't expose enumeration (plain getItem/setItem objects).
 */
function evictStaleEntries(storage: KVStorage, prefix: string, keep: string): void {
  if (typeof storage.key !== "function" || typeof storage.removeItem !== "function") return;
  try {
    const stale: string[] = [];
    const length = storage.length ?? 0;
    for (let i = 0; i < length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix) && key !== keep) stale.push(key);
    }
    for (const key of stale) storage.removeItem(key);
  } catch {
    // best-effort; never let eviction disturb an already-successful load
  }
}

interface CacheEntry {
  hash: string;
  catalog: Catalog;
}

/** A corrupt/garbage cached value (bad JSON, wrong shape) is a cache miss, not an error — the next safeSet repairs it. */
function parseCacheEntry(raw: string): CacheEntry | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as CacheEntry).hash === "string" &&
      typeof (parsed as CacheEntry).catalog === "object" &&
      (parsed as CacheEntry).catalog !== null
    ) {
      return parsed as CacheEntry;
    }
  } catch {
    // fall through
  }
  return null;
}

export interface LoadMessagesOptions {
  app: string;
  lang: string;
  buildVersion: string;
  bakedCatalog: Catalog;
  bakedHash: string;
  manifestUrl: string;
  /** Builds the URL for the full catalog at a given content hash. */
  catalogUrl: (hash: string) => string;
  /** Injected fetch, `(url) => Promise<json>`. Defaults to global `fetch`. */
  fetchImpl?: (url: string) => Promise<unknown>;
  storage?: KVStorage;
  /** Alert-not-silent hook: fired on a content-hash mismatch or any swallowed failure. */
  onError?: (error: unknown) => void;
}

async function defaultFetch(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`request failed: ${response.status} ${url}`);
  return response.json();
}

/**
 * Fail-safe OTA delta loader. Never throws: any fetch/parse failure resolves
 * to `bakedCatalog` — a bad OTA payload must never break the app, only skip
 * the update. Order of operations:
 *
 *  1. GET the manifest -> remote hash R for {app,lang}.
 *  2. If a cache entry for {app,lang,buildVersion} already carries hash R,
 *     reuse its already-merged catalog (skips re-fetching + re-merging).
 *     Keying by buildVersion means a stale build's cache entry can never be
 *     read by a newer build (different key), so it can't leak mismatched
 *     content forward across a deploy.
 *  3. Else if R === bakedHash, return baked as-is (no catalog fetch at all).
 *  4. Else fetch the full catalog at R and verify the FETCHED content hashes
 *     to R (content-address check — corruption/tampering reports via
 *     `onError` and falls back to baked). Then merge over baked with
 *     `allowRemove:false` (a delta must never remove keys for an old build),
 *     cache the merged result under R, and return it. The merged catalog is
 *     deliberately NOT required to hash to R: a release that removed keys
 *     makes that unsatisfiable by design (the no-remove merge keeps them),
 *     and requiring it would permanently brick OTA for such releases.
 */
export async function loadMessages(options: LoadMessagesOptions): Promise<Catalog> {
  const {
    app,
    lang,
    buildVersion,
    bakedCatalog,
    bakedHash,
    manifestUrl,
    catalogUrl,
    fetchImpl = defaultFetch,
    storage = defaultStorage(),
    onError,
  } = options;

  const cacheKey = `locale:${app}:${lang}:${buildVersion}`;

  try {
    const manifest = (await fetchImpl(manifestUrl)) as Manifest;
    const remoteHash = manifest.apps[app]?.[lang]?.hash;
    if (!remoteHash) return bakedCatalog; // nothing published for this app/lang

    const cachedRaw = safeGet(storage, cacheKey);
    if (cachedRaw) {
      const cached = parseCacheEntry(cachedRaw);
      if (cached && cached.hash === remoteHash) return cached.catalog;
    }

    if (remoteHash === bakedHash) return bakedCatalog;

    const remoteCatalog = (await fetchImpl(catalogUrl(remoteHash))) as Catalog;
    const contentHash = await hashCatalog(remoteCatalog);
    if (contentHash !== remoteHash) {
      onError?.(new Error(`ota content-hash mismatch for ${app}/${lang}: manifest says ${remoteHash}, fetched catalog hashes to ${contentHash}`));
      return bakedCatalog;
    }

    const merged = merge(bakedCatalog, diff(bakedCatalog, remoteCatalog), { allowRemove: false });

    const written = safeSet(storage, cacheKey, JSON.stringify({ hash: remoteHash, catalog: merged } satisfies CacheEntry));
    if (written) evictStaleEntries(storage, `locale:${app}:${lang}:`, cacheKey);
    return merged;
  } catch (error) {
    onError?.(error);
    return bakedCatalog;
  }
}

/**
 * Framework-agnostic injection helper: calls the caller's setter with a NEW
 * object reference. Engines that hold catalogs behind a `shallowRef` (or
 * similar reference-equality-gated reactivity) need the identity to actually
 * change, not just a nested mutation, to pick up the update.
 */
export function injectInto(catalog: Catalog, setMessages: (catalog: Catalog) => void): void {
  setMessages({ ...catalog });
}

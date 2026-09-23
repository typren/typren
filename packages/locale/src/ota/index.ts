import type { Catalog, Manifest } from "../types";
import { diff, merge } from "../delta";
import { hashCatalog } from "../canonicalize";

/**
 * Minimal storage contract, shaped like `localStorage` (`getItem`/`setItem`)
 * so real `localStorage` can be passed straight through with no adapter.
 * `removeItem`/`key`/`length` are OPTIONAL; a plain two-method object still
 * satisfies the type. They only enable best-effort eviction of stale cache
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
// exceeded, storage disabled) must not discard an already-verified merge.
// Caching is best-effort; the returned catalog isn't contingent on it.
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
 * versions. Every deploy changes the cache key, so without eviction old
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

/** A corrupt/garbage cached value (bad JSON, wrong shape) is a cache miss, not an error. The next safeSet repairs it. */
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

/**
 * Shape this client needs from a `PublishedDelta` (see `build/catalog.ts`):
 * just enough to verify and apply an additive delta. The fetched catalog is
 * already a trust boundary here (CDN compromise, MITM on a misconfigured
 * origin), so a fetched delta gets the same shape check before its
 * `changed` keys ever reach `merge`.
 */
interface FetchedDelta {
  changed: Record<string, string>;
  additiveHash: string;
}

function isFetchedDelta(value: unknown): value is FetchedDelta {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as FetchedDelta).changed === "object" &&
    (value as FetchedDelta).changed !== null &&
    typeof (value as FetchedDelta).additiveHash === "string"
  );
}

// Capped at MEMO_CAP entries, oldest evicted first: enough to cover a
// handful of {app,lang,buildVersion} combos in one tab without growing
// unbounded across a long session.
const MEMO_CAP = 8;
const memoCache = new Map<string, Catalog>();

function memoSet(key: string, catalog: Catalog): void {
  memoCache.delete(key);
  memoCache.set(key, catalog);
  if (memoCache.size > MEMO_CAP) {
    const oldestKey = memoCache.keys().next().value;
    if (oldestKey !== undefined) memoCache.delete(oldestKey);
  }
}

/**
 * Clears the module-level merge memo. Test-only: this package's own test
 * suite reuses identical {app,lang,buildVersion,content} combinations across
 * `it` blocks, which would otherwise collide on the memo key with a prior
 * case and skip the storage/fetch behavior that case means to exercise.
 */
export function clearLoadMessagesMemo(): void {
  memoCache.clear();
}

export interface LoadMessagesOptions {
  app: string;
  lang: string;
  buildVersion: string;
  bakedCatalog: Catalog;
  /**
   * Content hash of `bakedCatalog`. Optional: when omitted, it is computed
   * internally with `hashCatalog`, inside the same fail-to-baked guard as
   * everything else, so an environment without `crypto.subtle` (for example
   * an insecure origin) resolves to `bakedCatalog` via `onError` instead of
   * throwing. Passing the build-time constant skips re-hashing the whole
   * baked catalog on every poll and is the recommended production setting.
   */
  bakedHash?: string;
  manifestUrl: string;
  /** Builds the URL for the full catalog at a given content hash. */
  catalogUrl: (hash: string) => string;
  /**
   * Builds the URL for a precomputed additive delta from `fromHash` to
   * `toHash` (see `PublishedDelta` in build/catalog.ts). Optional: when set,
   * `loadMessages` tries this smaller delta-first path before falling back
   * to the full catalog fetch. Omit it to keep the full-catalog-only
   * behavior.
   */
  deltaUrl?: (fromHash: string, toHash: string) => string;
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
 * to `bakedCatalog`, because a bad OTA payload must never break the app. It
 * can only skip the update. Order of operations:
 *
 *  1. GET the manifest to get remote hash R for {app,lang}.
 *  2. A module-level memo keyed by {app,lang,buildVersion,R} returns the
 *     SAME object reference on a repeat poll against an unchanged R, with no
 *     storage read and no catalog/delta fetch beyond the manifest. This
 *     matters downstream: callers gate a re-render on reference equality.
 *  3. If a cache entry for {app,lang,buildVersion} already carries hash R,
 *     reuse its already-merged catalog (skips re-fetching and re-merging).
 *     Keying by buildVersion means a stale build's cache entry can never be
 *     read by a newer build, since that build uses a different key, so it
 *     can never leak mismatched content forward across a deploy.
 *  4. Else if R equals bakedHash (passed in, or computed here when omitted),
 *     return baked as-is (no catalog fetch at all).
 *  5. Else, when `deltaUrl` is set, try the precomputed additive delta
 *     first: fetch it, apply its `changed` keys onto baked with
 *     `allowRemove:false`, and verify the merge hashes to the delta's
 *     `additiveHash`. A verified hit is far cheaper than the full catalog on
 *     a typical poll. Any fetch, parse, or shape failure falls through
 *     silently to step 6 (a 404 just means the baked hash fell outside the
 *     precomputed window, e.g. a fresh CI build with no history yet). A
 *     hash mismatch reports through `onError` and also falls through to
 *     step 6, rather than straight to baked, so a delta bug never blocks an
 *     update the full-catalog path could still deliver.
 *  6. Fetch the full catalog at R and verify the FETCHED content hashes to R
 *     (a content-address check; corruption or tampering reports via
 *     `onError` and falls back to baked). Then merge over baked with
 *     `allowRemove:false` (a delta must never remove keys for an old build),
 *     cache the merged result under R, and return it. The merged catalog is
 *     deliberately NOT required to hash to R: a release that removed keys
 *     makes that unsatisfiable by design, since the no-remove merge keeps
 *     them, and requiring it would permanently brick OTA for such releases.
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
    deltaUrl,
    fetchImpl = defaultFetch,
    storage = defaultStorage(),
    onError,
  } = options;

  const cacheKey = `locale:${app}:${lang}:${buildVersion}`;

  try {
    const manifest = (await fetchImpl(manifestUrl)) as Manifest;
    const remoteHash = manifest.apps[app]?.[lang]?.hash;
    if (!remoteHash) return bakedCatalog; // nothing published for this app/lang

    const memoKey = `${cacheKey}:${remoteHash}`;
    const memoized = memoCache.get(memoKey);
    if (memoized) return memoized;

    const cachedRaw = safeGet(storage, cacheKey);
    if (cachedRaw) {
      const cached = parseCacheEntry(cachedRaw);
      if (cached && cached.hash === remoteHash) {
        memoSet(memoKey, cached.catalog);
        return cached.catalog;
      }
    }

    // Computed only past the memo and cache paths, which never need it, so
    // repeat polls stay hash-free. When the environment lacks `crypto.subtle`
    // this throws into the outer fail-to-baked catch below.
    const resolvedBakedHash = bakedHash ?? (await hashCatalog(bakedCatalog));

    if (remoteHash === resolvedBakedHash) {
      memoSet(memoKey, bakedCatalog);
      return bakedCatalog;
    }

    if (deltaUrl) {
      try {
        const rawDelta = await fetchImpl(deltaUrl(resolvedBakedHash, remoteHash));
        if (isFetchedDelta(rawDelta)) {
          const additiveMerged = merge(bakedCatalog, { changed: rawDelta.changed, removed: [] }, { allowRemove: false });
          const additiveMergedHash = await hashCatalog(additiveMerged);
          if (additiveMergedHash === rawDelta.additiveHash) {
            const written = safeSet(
              storage,
              cacheKey,
              JSON.stringify({ hash: remoteHash, catalog: additiveMerged } satisfies CacheEntry),
            );
            if (written) evictStaleEntries(storage, `locale:${app}:${lang}:`, cacheKey);
            memoSet(memoKey, additiveMerged);
            return additiveMerged;
          }
          onError?.(
            new Error(
              `ota delta additive-hash mismatch for ${app}/${lang}: delta claims ${rawDelta.additiveHash}, additive merge hashes to ${additiveMergedHash}`,
            ),
          );
        }
        // Wrong shape: treated the same as a fetch failure below, a silent
        // fall-through to the full-catalog path.
      } catch {
        // Delta fetch/parse failure (404, network error, bad JSON): the
        // common case, not an error. Fall through silently.
      }
    }

    const remoteCatalog = (await fetchImpl(catalogUrl(remoteHash))) as Catalog;
    const contentHash = await hashCatalog(remoteCatalog);
    if (contentHash !== remoteHash) {
      onError?.(new Error(`ota content-hash mismatch for ${app}/${lang}: manifest says ${remoteHash}, fetched catalog hashes to ${contentHash}`));
      return bakedCatalog;
    }

    const merged = merge(bakedCatalog, diff(bakedCatalog, remoteCatalog), { allowRemove: false });

    const written = safeSet(storage, cacheKey, JSON.stringify({ hash: remoteHash, catalog: merged } satisfies CacheEntry));
    if (written) evictStaleEntries(storage, `locale:${app}:${lang}:`, cacheKey);
    memoSet(memoKey, merged);
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

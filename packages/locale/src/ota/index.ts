import type { Catalog, Manifest } from "../types";
import { diff, merge } from "../delta";
import { hashCatalog } from "../canonicalize";
import { isUnsafeHtml, type Purifier } from "../no-html";

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
 * just enough to apply an additive delta. The fetched catalog is already a
 * trust boundary here (CDN compromise, MITM on a misconfigured origin), so a
 * fetched delta gets a shape check before its `changed` keys ever reach
 * `merge`. Its own `additiveHash` is deliberately not read: the expected hash
 * comes from the manifest.
 */
interface FetchedDelta {
  changed: Record<string, string>;
}

function isFetchedDelta(value: unknown): value is FetchedDelta {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as FetchedDelta).changed === "object" &&
    (value as FetchedDelta).changed !== null
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
  /**
   * DOMPurify instance for the load-time HTML gate. Defaults to one bound to the page's `window`;
   * SSR in Node passes `createNodePurifier()` from `@typren/locale/build`, or every load there
   * resolves to baked (the gate cannot run without a DOM, and the client fails closed).
   */
  purifier?: Purifier;
}

/**
 * Applies `content` (a hash-verified remote catalog or additive merge) onto baked, without removals,
 * after re-running the publish-time HTML gate on every changed string. The hash only proves the bytes
 * are what the manifest named; a compromised publisher or manifest can still name hostile copy. A
 * failing key keeps its baked value and is reported, rather than discarding the whole update.
 */
function applyGated(
  baked: Catalog,
  content: Catalog,
  purifier: Purifier | undefined,
  onError: ((error: unknown) => void) | undefined,
  label: string,
): Catalog {
  const changed: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(diff(baked, content).changed)) {
    if (typeof value === "string" && !isUnsafeHtml(value, purifier)) changed[key] = value;
    else dropped.push(key);
  }
  if (dropped.length > 0) {
    onError?.(new Error(`ota html gate dropped ${label} keys (baked value kept): ${dropped.join(", ")}`));
  }
  return merge(baked, { changed, removed: [] }, { allowRemove: false });
}

async function defaultFetch(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`request failed: ${response.status} ${url}`);
  return response.json();
}

/**
 * Fail-safe OTA delta loader. Never throws: any fetch/parse failure resolves
 * to `bakedCatalog`, because a bad OTA payload must never break the app. It
 * can only skip the update. Every hash this trusts comes from the freshly
 * fetched manifest, never from the payload or storage it is checking.
 * Order of operations:
 *
 *  1. GET the manifest to get remote hash R for {app,lang}, plus its
 *     `deltas` map (prior release hash -> expected additive-merge hash).
 *  2. A module-level memo keyed by {manifestUrl,app,lang,buildVersion,R}
 *     returns the SAME object reference on a repeat poll against an
 *     unchanged R, with no storage read and no catalog/delta fetch beyond
 *     the manifest. This matters downstream: callers gate a re-render on
 *     reference equality.
 *  3. If R equals bakedHash (passed in, or computed here when omitted),
 *     return baked as-is (no catalog fetch at all).
 *  4. A cache entry for {app,lang,buildVersion} is reused only when its
 *     hash is one the manifest vouches for (R, or the expected additive
 *     hash for this baked build) AND its stored catalog re-hashes to it, so
 *     a tampered or stale localStorage entry is a cache miss. Keying by
 *     buildVersion means a stale build's entry is never even read.
 *  5. Else, when `deltaUrl` is set and the manifest lists an expected hash
 *     for this baked build, try the precomputed additive delta first: fetch
 *     it, apply its `changed` keys onto baked with `allowRemove:false`, and
 *     verify the merge hashes to the manifest's expected value. Any fetch,
 *     parse, or shape failure falls through silently to step 6 (a 404 just
 *     means the baked hash fell outside the precomputed window). A hash
 *     mismatch reports through `onError` and also falls through to step 6.
 *  6. Fetch the full catalog at R and verify the FETCHED content hashes to R
 *     (corruption or tampering reports via `onError` and falls back to
 *     baked). The merged result is deliberately NOT required to hash to R: a
 *     release that removed keys makes that unsatisfiable by design, since
 *     the no-remove merge keeps them.
 *
 *  Whatever passed verification (the remote catalog, or the additive merge)
 *  is what gets cached, so step 4 can re-verify it. It is then applied onto
 *  baked through the HTML gate (see `applyGated`): a string outside the
 *  publish allowlist keeps its baked value.
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
    purifier,
  } = options;

  const cacheKey = `locale:${app}:${lang}:${buildVersion}`;
  const label = `${app}/${lang}`;

  try {
    const manifest = (await fetchImpl(manifestUrl)) as Manifest;
    const entry = manifest.apps[app]?.[lang];
    const remoteHash = entry?.hash;
    if (!remoteHash) return bakedCatalog; // nothing published for this app/lang

    const memoKey = `${manifestUrl}|${cacheKey}:${remoteHash}`;
    const memoized = memoCache.get(memoKey);
    if (memoized) return memoized;

    // When the environment lacks `crypto.subtle` this throws into the outer
    // fail-to-baked catch below.
    const resolvedBakedHash = bakedHash ?? (await hashCatalog(bakedCatalog));

    if (remoteHash === resolvedBakedHash) {
      memoSet(memoKey, bakedCatalog);
      return bakedCatalog;
    }

    const expectedDeltaHash = Object.hasOwn(entry.deltas ?? {}, resolvedBakedHash)
      ? entry.deltas![resolvedBakedHash]
      : undefined;
    const finish = (verified: Catalog, hash: string, store: boolean): Catalog => {
      if (store) {
        const written = safeSet(storage, cacheKey, JSON.stringify({ hash, catalog: verified } satisfies CacheEntry));
        if (written) evictStaleEntries(storage, `locale:${app}:${lang}:`, cacheKey);
      }
      const result = applyGated(bakedCatalog, verified, purifier, onError, label);
      memoSet(memoKey, result);
      return result;
    };

    const cachedRaw = safeGet(storage, cacheKey);
    const cached = cachedRaw ? parseCacheEntry(cachedRaw) : null;
    if (
      cached &&
      (cached.hash === remoteHash || cached.hash === expectedDeltaHash) &&
      (await hashCatalog(cached.catalog)) === cached.hash
    ) {
      return finish(cached.catalog, cached.hash, false);
    }

    if (deltaUrl && expectedDeltaHash) {
      try {
        const rawDelta = await fetchImpl(deltaUrl(resolvedBakedHash, remoteHash));
        if (isFetchedDelta(rawDelta)) {
          const additiveMerged = merge(bakedCatalog, { changed: rawDelta.changed, removed: [] }, { allowRemove: false });
          const additiveMergedHash = await hashCatalog(additiveMerged);
          if (additiveMergedHash === expectedDeltaHash) return finish(additiveMerged, additiveMergedHash, true);
          onError?.(
            new Error(
              `ota delta additive-hash mismatch for ${label}: manifest expects ${expectedDeltaHash}, additive merge hashes to ${additiveMergedHash}`,
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
      onError?.(new Error(`ota content-hash mismatch for ${label}: manifest says ${remoteHash}, fetched catalog hashes to ${contentHash}`));
      return bakedCatalog;
    }
    return finish(remoteCatalog, remoteHash, true);
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

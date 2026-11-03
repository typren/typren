import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodePurifier } from "../build/node-purifier";
import { hashCatalog } from "../canonicalize";
import { merge } from "../delta";
import { generateSigningKey, parseSigningKey, signManifest, type SigningKey } from "../sign";
import type { Catalog, Manifest, TrustedKey } from "../types";
import { clearLoadMessagesMemo, injectInto, loadMessages as load, type KVStorage, type LoadMessagesOptions } from "./index";

let signingKey: SigningKey;
let trusted: TrustedKey[];

beforeAll(async () => {
  const generated = await generateSigningKey();
  signingKey = parseSigningKey(generated.secret);
  trusted = [{ kid: generated.kid, jwk: generated.publicJwk }];
});

/** Existing cases trust the shared key; new cases override `publicKeys`. */
const loadMessages = (o: Omit<LoadMessagesOptions, "publicKeys"> & Partial<Pick<LoadMessagesOptions, "publicKeys">>) =>
  load({ publicKeys: trusted, ...o });

function signed(m: Pick<Manifest, "apps">, over: Partial<Manifest> = {}): Promise<Manifest> {
  const now = Date.now();
  return signManifest(
    {
      v: 1,
      buildVersion: BUILD_VERSION,
      sequence: 1,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 86_400_000).toISOString(),
      apps: m.apps,
      ...over,
    },
    signingKey,
  );
}

const APP = "site";
const LANG = "en";
const BUILD_VERSION = "v1";
const MANIFEST_URL = "https://cdn.example/manifest/site.json";
const catalogUrl = (hash: string) => `https://cdn.example/catalog/site/en/${hash}.json`;
const deltaUrl = (fromHash: string, toHash: string) => `https://cdn.example/delta/site/en/${fromHash}-${toHash}.json`;

function unsignedManifest(hash: string, deltas?: Record<string, string>): Manifest {
  return { v: 1, buildVersion: BUILD_VERSION, apps: { [APP]: { [LANG]: { hash, ...(deltas && { deltas }) } } } };
}

function manifestWithHash(hash: string, deltas?: Record<string, string>, over: Partial<Manifest> = {}): Promise<Manifest> {
  return signed(unsignedManifest(hash, deltas), over);
}

function memoryStorage(): KVStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

/** Same backing store as {@link memoryStorage}, plus a read counter for the memoization test. */
function trackingStorage(): KVStorage & { reads: number } {
  const backing = memoryStorage();
  return {
    reads: 0,
    getItem(key) {
      this.reads++;
      return backing.getItem(key);
    },
    setItem: backing.setItem,
  };
}

// Node 22+ predefines a global `localStorage` accessor (inert without
// `--localstorage-file`) that shadows the jsdom environment's real one, so
// `globalThis.localStorage` resolves to `undefined` here unless repointed at
// jsdom's actual Storage (exposed via vitest's documented `globalThis.jsdom`
// escape hatch). Without this, every test below would exercise the
// in-memory fallback instead of real localStorage.
const realLocalStorage = (globalThis as { jsdom?: { window: { localStorage: Storage } } }).jsdom?.window
  ?.localStorage;
if (realLocalStorage) {
  Object.defineProperty(globalThis, "localStorage", { value: realLocalStorage, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  clearLoadMessagesMemo();
});

describe("loadMessages", () => {
  it("no-change path: manifest hash equals baked hash, catalog is never fetched", async () => {
    const baked: Catalog = { Greeting: { Hello: "Hi {name}" } };
    const bakedHash = await hashCatalog(baked);
    const calls: string[] = [];

    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url === MANIFEST_URL) return manifestWithHash(bakedHash);
      throw new Error(`unexpected fetch: ${url}`); // catalog must never be requested
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl,
    });

    expect(result).toEqual(baked);
    expect(calls).toEqual([MANIFEST_URL]);
  });

  it("delta path: changed key is applied, content hash verifies, and it's cached in real localStorage", async () => {
    const baked: Catalog = { Greeting: { Hello: "Hi {name}" }, Nav: { Home: "Home" } };
    const bakedHash = await hashCatalog(baked);
    const remote: Catalog = { Greeting: { Hello: "Hey there {name}" }, Nav: { Home: "Home" } };
    const remoteHash = await hashCatalog(remote);

    const fetchImpl = async (url: string) => {
      if (url === MANIFEST_URL) return manifestWithHash(remoteHash);
      if (url === catalogUrl(remoteHash)) return remote;
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl,
      // no storage passed: exercises the default real-localStorage path.
    });

    expect(result).toEqual(remote);
    expect(await hashCatalog(result)).toBe(remoteHash);

    const cached = localStorage.getItem(`locale:${APP}:${LANG}:${BUILD_VERSION}`);
    expect(cached).toBeTruthy();
    const parsed = JSON.parse(cached!);
    expect(parsed.hash).toBe(remoteHash);
    expect(parsed.catalog).toEqual(remote);

    // a second load reuses the cache without re-fetching the catalog
    let catalogFetches = 0;
    const secondFetch = async (url: string) => {
      if (url === MANIFEST_URL) return manifestWithHash(remoteHash);
      catalogFetches++;
      return remote;
    };
    const second = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl: secondFetch,
    });
    expect(second).toEqual(remote);
    expect(catalogFetches).toBe(0);
  });

  it("removal release: edit applied, removed key kept, cached under R, no onError", async () => {
    const baked: Catalog = { Greeting: { Hello: "Hi {name}" }, Nav: { Legacy: "Old link" } };
    const bakedHash = await hashCatalog(baked);
    // The release removed Nav.Legacy AND edited Greeting.Hello, so the additive
    // merge can never hash to R, which the old flow treated as corruption
    // (permanently bricking OTA and refetching every load).
    const remote: Catalog = { Greeting: { Hello: "Hey {name}" } };
    const remoteHash = await hashCatalog(remote);
    const errors: unknown[] = [];

    const fetchImpl = async (url: string) => {
      if (url === MANIFEST_URL) return manifestWithHash(remoteHash);
      if (url === catalogUrl(remoteHash)) return remote;
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl,
      onError: (e) => errors.push(e),
    });

    expect(result).toEqual({ Greeting: { Hello: "Hey {name}" }, Nav: { Legacy: "Old link" } });
    expect(errors).toEqual([]);

    // The cache holds the verified remote content (so a later read can re-hash it), not the merge.
    const cached = JSON.parse(localStorage.getItem(`locale:${APP}:${LANG}:${BUILD_VERSION}`)!);
    expect(cached.hash).toBe(remoteHash);
    expect(cached.catalog).toEqual(remote);

    // cache-hit path serves the merged catalog without refetching
    let catalogFetches = 0;
    const second = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl: async (url: string) => {
        if (url === MANIFEST_URL) return manifestWithHash(remoteHash);
        catalogFetches++;
        return remote;
      },
      onError: (e) => errors.push(e),
    });
    expect(second).toEqual(result);
    expect(catalogFetches).toBe(0);
    expect(errors).toEqual([]);
  });

  it("prototype-pollution exploit: a __proto__ payload in the remote catalog is inert end-to-end", async () => {
    const baked: Catalog = { greet: "hello" };
    const bakedHash = await hashCatalog(baked);
    const remote: Catalog = JSON.parse('{"greet":"hi","__proto__":{"polluted":"yes"}}');
    const remoteHash = await hashCatalog(remote); // canonicalize excludes the unsafe key

    const fetchImpl = async (url: string) => {
      if (url === MANIFEST_URL) return manifestWithHash(remoteHash);
      if (url === catalogUrl(remoteHash)) return remote;
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl,
    });

    expect(result.greet).toBe("hi");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("buildVersion keying: a newer build never reuses an older build's cache entry", async () => {
    const baked: Catalog = { A: "a" };
    const bakedHash = await hashCatalog(baked);
    const remote: Catalog = { A: "a-v1" };
    const remoteHash = await hashCatalog(remote);

    // Prime the cache under buildVersion "v1".
    await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: "v1",
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl: async (url) => (url === MANIFEST_URL ? manifestWithHash(remoteHash) : remote),
    });
    expect(localStorage.getItem(`locale:${APP}:${LANG}:v1`)).toBeTruthy();
    expect(localStorage.getItem(`locale:${APP}:${LANG}:v2`)).toBeNull();

    // A new build ("v2") with a manifest hash equal to ITS baked hash must
    // resolve baked-as-is, never read the "v1" cache entry (different key).
    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: "v2",
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl: async (url) => (url === MANIFEST_URL ? manifestWithHash(bakedHash) : remote),
    });
    expect(result).toEqual(baked);
  });

  it("eviction: a successful cache write removes stale entries for other buildVersions", async () => {
    const baked: Catalog = { A: "a" };
    const bakedHash = await hashCatalog(baked);
    const remote: Catalog = { A: "b" };
    const remoteHash = await hashCatalog(remote);

    localStorage.setItem(`locale:${APP}:${LANG}:v0`, JSON.stringify({ hash: "old", catalog: { A: "stale" } }));
    localStorage.setItem(`locale:${APP}:other-lang:v0`, "unrelated"); // different prefix, untouched

    await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl: async (url) => (url === MANIFEST_URL ? manifestWithHash(remoteHash) : remote),
    });

    expect(localStorage.getItem(`locale:${APP}:${LANG}:v0`)).toBeNull();
    expect(localStorage.getItem(`locale:${APP}:${LANG}:${BUILD_VERSION}`)).toBeTruthy();
    expect(localStorage.getItem(`locale:${APP}:other-lang:v0`)).toBe("unrelated");
  });

  it("eviction is skipped (not crashed) for a plain getItem/setItem storage", async () => {
    const baked: Catalog = { A: "a" };
    const bakedHash = await hashCatalog(baked);
    const remote: Catalog = { A: "b" };
    const remoteHash = await hashCatalog(remote);
    const storage = memoryStorage(); // no key()/removeItem()

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl: async (url) => (url === MANIFEST_URL ? manifestWithHash(remoteHash) : remote),
      storage,
    });

    expect(result).toEqual(remote);
    expect(storage.getItem(`locale:${APP}:${LANG}:${BUILD_VERSION}`)).toBeTruthy();
  });

  it("failure path: any fetch failure falls back to baked and reports via onError", async () => {
    const baked: Catalog = { A: "a" };
    const failure = new Error("network down");
    const errors: unknown[] = [];
    const fetchImpl = async () => {
      throw failure;
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash: await hashCatalog(baked),
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl,
      onError: (e) => errors.push(e),
    });

    expect(result).toEqual(baked);
    expect(errors).toEqual([failure]); // swallowed, but never silently
  });

  it("corruption: fetched catalog not hashing to the manifest hash falls back to baked with onError", async () => {
    const baked: Catalog = { A: "a" };
    const bakedHash = await hashCatalog(baked);
    const claimedHash = "deadbeef".repeat(8); // doesn't actually match the corrupt payload below
    const corrupt: Catalog = { A: "not what was promised" };
    let reportedError: unknown;

    const fetchImpl = async (url: string) => {
      if (url === MANIFEST_URL) return manifestWithHash(claimedHash);
      if (url === catalogUrl(claimedHash)) return corrupt;
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl,
      onError: (error) => {
        reportedError = error;
      },
    });

    expect(result).toEqual(baked);
    expect(reportedError).toBeInstanceOf(Error);
    expect(String(reportedError)).toMatch(/content-hash mismatch/);
  });

  it("corrupt cache entry (garbage JSON) is a cache miss: OTA still updates and repairs the entry", async () => {
    const baked: Catalog = { A: "a" };
    const bakedHash = await hashCatalog(baked);
    const remote: Catalog = { A: "b" };
    const remoteHash = await hashCatalog(remote);
    const cacheKey = `locale:${APP}:${LANG}:${BUILD_VERSION}`;

    localStorage.setItem(cacheKey, "{not json!!");

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl: async (url) => (url === MANIFEST_URL ? manifestWithHash(remoteHash) : remote),
    });

    expect(result).toEqual(remote);
    const repaired = JSON.parse(localStorage.getItem(cacheKey)!);
    expect(repaired).toEqual({ hash: remoteHash, catalog: remote });
  });

  it("wrong-shaped cache entry (valid JSON) is also a cache miss", async () => {
    const baked: Catalog = { A: "a" };
    const bakedHash = await hashCatalog(baked);
    const remote: Catalog = { A: "b" };
    const remoteHash = await hashCatalog(remote);
    const cacheKey = `locale:${APP}:${LANG}:${BUILD_VERSION}`;

    localStorage.setItem(cacheKey, JSON.stringify({ hash: 42, catalog: "nope" }));

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl: async (url) => (url === MANIFEST_URL ? manifestWithHash(remoteHash) : remote),
    });

    expect(result).toEqual(remote);
    expect(JSON.parse(localStorage.getItem(cacheKey)!)).toEqual({ hash: remoteHash, catalog: remote });
  });

  it("storage write failure (private-window/quota) never discards an already-verified merge", async () => {
    const baked: Catalog = { A: "a" };
    const bakedHash = await hashCatalog(baked);
    const remote: Catalog = { A: "b" };
    const remoteHash = await hashCatalog(remote);

    const throwingStorage: KVStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl: async (url) => (url === MANIFEST_URL ? manifestWithHash(remoteHash) : remote),
      storage: throwingStorage,
    });

    expect(result).toEqual(remote);
  });

  it("storage read failure falls through to a normal (uncached) load instead of crashing", async () => {
    const baked: Catalog = { A: "a" };
    const bakedHash = await hashCatalog(baked);
    const remote: Catalog = { A: "b" };
    const remoteHash = await hashCatalog(remote);

    const throwingStorage: KVStorage = {
      getItem: () => {
        throw new Error("SecurityError: storage disabled");
      },
      setItem: memoryStorage().setItem,
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl: async (url) => (url === MANIFEST_URL ? manifestWithHash(remoteHash) : remote),
      storage: throwingStorage,
    });

    expect(result).toEqual(remote);
  });

  it("delta-first happy path: applies the delta and never fetches the full catalog", async () => {
    const baked: Catalog = { Greeting: { Hello: "Hi {name}" }, Nav: { Home: "Home" } };
    const bakedHash = await hashCatalog(baked);
    const changed = { "Greeting.Hello": "Hey there {name}" };
    // No key was removed in this release, so the full remote catalog IS the
    // additive merge, and its hash doubles as both the manifest hash and the
    // delta's additiveHash.
    const remote = merge(baked, { changed, removed: [] }, { allowRemove: false });
    const remoteHash = await hashCatalog(remote);
    const delta = { changed, additiveHash: remoteHash };

    const fetchImpl = async (url: string) => {
      if (url === MANIFEST_URL) return manifestWithHash(remoteHash, { [bakedHash]: remoteHash });
      if (url === deltaUrl(bakedHash, remoteHash)) return delta;
      throw new Error(`unexpected fetch (full catalog must never be fetched on a verified delta hit): ${url}`);
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      deltaUrl,
      fetchImpl,
    });

    expect(result).toEqual(remote);
    const cached = JSON.parse(localStorage.getItem(`locale:${APP}:${LANG}:${BUILD_VERSION}`)!);
    expect(cached).toEqual({ hash: remoteHash, catalog: remote });
  });

  it("delta fetch failure (404) falls through silently to the full-catalog path", async () => {
    const baked: Catalog = { A: "a" };
    const bakedHash = await hashCatalog(baked);
    const remote: Catalog = { A: "b" };
    const remoteHash = await hashCatalog(remote);
    const errors: unknown[] = [];
    let catalogFetched = false;

    const fetchImpl = async (url: string) => {
      if (url === MANIFEST_URL) return manifestWithHash(remoteHash, { [bakedHash]: remoteHash });
      if (url === deltaUrl(bakedHash, remoteHash)) throw new Error("request failed: 404");
      if (url === catalogUrl(remoteHash)) {
        catalogFetched = true;
        return remote;
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      deltaUrl,
      fetchImpl,
      onError: (e) => errors.push(e),
    });

    expect(result).toEqual(remote);
    expect(catalogFetched).toBe(true);
    expect(errors).toEqual([]); // a missed delta window is expected, not an error
  });

  it("delta additiveHash mismatch: onError fires once, full-catalog path still succeeds", async () => {
    const baked: Catalog = { A: "a" };
    const bakedHash = await hashCatalog(baked);
    const remote: Catalog = { A: "b" };
    const remoteHash = await hashCatalog(remote);
    const errors: unknown[] = [];
    // Shape-valid, but the manifest's expected hash doesn't match what applying `changed` onto baked produces.
    const badDelta = { changed: { A: "b" }, additiveHash: remoteHash };

    const fetchImpl = async (url: string) => {
      if (url === MANIFEST_URL) return manifestWithHash(remoteHash, { [bakedHash]: "deadbeef".repeat(8) });
      if (url === deltaUrl(bakedHash, remoteHash)) return badDelta;
      if (url === catalogUrl(remoteHash)) return remote;
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      deltaUrl,
      fetchImpl,
      onError: (e) => errors.push(e),
    });

    expect(result).toEqual(remote);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/additive-hash mismatch/);
  });

  it("hostile delta with a __proto__ path stays inert end-to-end", async () => {
    const baked: Catalog = { greet: "hello" };
    const bakedHash = await hashCatalog(baked);
    const changed = JSON.parse('{"greet":"hi","__proto__":{"polluted":"yes"}}');
    const additiveMerged = merge(baked, { changed, removed: [] }, { allowRemove: false });
    const remoteHash = await hashCatalog(additiveMerged); // no removals, so this doubles as the additiveHash
    const delta = { changed, additiveHash: remoteHash };

    const fetchImpl = async (url: string) => {
      if (url === MANIFEST_URL) return manifestWithHash(remoteHash, { [bakedHash]: remoteHash });
      if (url === deltaUrl(bakedHash, remoteHash)) return delta;
      throw new Error(`unexpected fetch (full catalog must never be fetched on a verified delta hit): ${url}`);
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      deltaUrl,
      fetchImpl,
    });

    expect(result.greet).toBe("hi");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("memoizes the merged catalog: a second poll against an unchanged remote returns the SAME object with no storage reads and no catalog/delta fetches", async () => {
    const baked: Catalog = { A: "a" };
    const bakedHash = await hashCatalog(baked);
    const remote: Catalog = { A: "b" };
    const remoteHash = await hashCatalog(remote);

    let manifestFetches = 0;
    let otherFetches = 0;
    const fetchImpl = async (url: string) => {
      if (url === MANIFEST_URL) {
        manifestFetches++;
        return manifestWithHash(remoteHash);
      }
      otherFetches++;
      return remote;
    };
    const storage = trackingStorage();

    const opts = {
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      bakedHash,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl,
      storage,
    };

    const first = await loadMessages(opts);
    expect(first).toEqual(remote);
    expect(manifestFetches).toBe(1);
    expect(otherFetches).toBe(1);
    expect(storage.reads).toBe(2); // sequence + cache entry

    const second = await loadMessages(opts);
    expect(second).toBe(first); // same object reference, not just equal by value
    expect(manifestFetches).toBe(2); // the manifest poll still happens
    expect(otherFetches).toBe(1); // no new catalog/delta fetch
    expect(storage.reads).toBe(3); // only the sequence read, never the cache entry
  });
});

describe("loadMessages with omitted bakedHash", () => {
  it("computes the baked hash internally and still resolves the update", async () => {
    const baked: Catalog = { Greeting: { Hello: "Hi {name}" } };
    const remote: Catalog = { Greeting: { Hello: "Hello {name}" }, Farewell: "Bye" };
    const remoteHash = await hashCatalog(remote);

    const fetchImpl = async (url: string) => {
      if (url === MANIFEST_URL) return manifestWithHash(remoteHash);
      if (url === catalogUrl(remoteHash)) return remote;
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl,
      storage: memoryStorage(),
    });

    expect(result).toEqual(remote);
  });

  it("no-change path works without a caller-supplied hash", async () => {
    const baked: Catalog = { Greeting: { Hello: "Hi {name}" } };
    const bakedHash = await hashCatalog(baked);

    const fetchImpl = async (url: string) => {
      if (url === MANIFEST_URL) return manifestWithHash(bakedHash);
      throw new Error(`unexpected fetch: ${url}`); // catalog must never be requested
    };

    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl,
      storage: memoryStorage(),
    });

    expect(result).toBe(baked);
  });

  it("crypto.subtle-less environment resolves to baked via onError, never throws", async () => {
    const baked: Catalog = { Greeting: { Hello: "Hi {name}" } };
    const remote: Catalog = { Greeting: { Hello: "Hello {name}" } };
    const remoteHash = await hashCatalog(remote);

    const manifest = await manifestWithHash(remoteHash);
    const fetchImpl = async (url: string) => (url === MANIFEST_URL ? manifest : remote);

    const errors: unknown[] = [];
    // Insecure origins expose `crypto` without `subtle`; the internal hash
    // computation must fail into the outer fail-to-baked guard.
    const realCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
    try {
      const result = await loadMessages({
        app: APP,
        lang: LANG,
        buildVersion: BUILD_VERSION,
        bakedCatalog: baked,
        manifestUrl: MANIFEST_URL,
        catalogUrl,
        fetchImpl,
        storage: memoryStorage(),
        onError: (e) => errors.push(e),
      });
      expect(result).toBe(baked);
      expect(errors).toHaveLength(1);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: realCrypto, configurable: true });
    }
  });
});

describe("loadMessages integrity", () => {
  const base = { app: APP, lang: LANG, buildVersion: BUILD_VERSION, manifestUrl: MANIFEST_URL, catalogUrl, deltaUrl };

  it("a tampered delta that restates its own additiveHash is rejected: only the manifest's hash counts", async () => {
    const baked: Catalog = { A: "a" };
    const bakedHash = await hashCatalog(baked);
    const remote: Catalog = { A: "b" };
    const remoteHash = await hashCatalog(remote);
    const evilChanged = { A: "evil" };
    const tampered = { changed: evilChanged, additiveHash: await hashCatalog(merge(baked, { changed: evilChanged, removed: [] })) };
    const errors: unknown[] = [];

    const result = await loadMessages({
      ...base,
      bakedCatalog: baked,
      bakedHash,
      fetchImpl: async (url) => {
        if (url === MANIFEST_URL) return manifestWithHash(remoteHash, { [bakedHash]: remoteHash });
        if (url === deltaUrl(bakedHash, remoteHash)) return tampered;
        if (url === catalogUrl(remoteHash)) return remote;
        throw new Error(`unexpected fetch: ${url}`);
      },
      onError: (e) => errors.push(e),
    });

    expect(result).toEqual({ A: "b" });
    expect(String(errors[0])).toMatch(/manifest expects/);
  });

  it("a delta the manifest does not vouch for is never fetched", async () => {
    const baked: Catalog = { A: "a" };
    const remote: Catalog = { A: "b" };
    const remoteHash = await hashCatalog(remote);
    const calls: string[] = [];

    const result = await loadMessages({
      ...base,
      bakedCatalog: baked,
      fetchImpl: async (url) => {
        calls.push(url);
        return url === MANIFEST_URL ? manifestWithHash(remoteHash) : remote;
      },
    });

    expect(result).toEqual(remote);
    expect(calls).toEqual([MANIFEST_URL, catalogUrl(remoteHash)]);
  });

  it("re-runs the HTML gate at load: a hostile string keeps its baked value, the rest still updates", async () => {
    const baked: Catalog = { A: "a", B: "b" };
    // Hash-valid on purpose: a compromised publisher can sign whatever it serves.
    const remote: Catalog = { A: '<img src=x onerror="alert(1)">', B: "new" };
    const remoteHash = await hashCatalog(remote);
    const errors: unknown[] = [];

    const result = await loadMessages({
      ...base,
      deltaUrl: undefined,
      bakedCatalog: baked,
      fetchImpl: async (url) => (url === MANIFEST_URL ? manifestWithHash(remoteHash) : remote),
      onError: (e) => errors.push(e),
      purifier: createNodePurifier(),
    });

    expect(result).toEqual({ A: "a", B: "new" });
    expect(String(errors[0])).toMatch(/html gate dropped site\/en keys .*: A$/);
  });

  it("a tampered localStorage entry is re-verified on read and treated as a miss", async () => {
    const baked: Catalog = { A: "a" };
    const remote: Catalog = { A: "b" };
    const remoteHash = await hashCatalog(remote);
    const storage = memoryStorage();
    storage.setItem(`locale:${APP}:${LANG}:${BUILD_VERSION}`, JSON.stringify({ hash: remoteHash, catalog: { A: "evil" } }));
    let catalogFetches = 0;

    const result = await loadMessages({
      ...base,
      deltaUrl: undefined,
      bakedCatalog: baked,
      storage,
      fetchImpl: async (url) => {
        if (url === MANIFEST_URL) return manifestWithHash(remoteHash);
        catalogFetches++;
        return remote;
      },
    });

    expect(result).toEqual(remote);
    expect(catalogFetches).toBe(1);
  });

  it("the memo is keyed by manifestUrl: another manifest never gets this one's object back", async () => {
    const baked: Catalog = { A: "a" };
    const remote: Catalog = { A: "b" };
    const remoteHash = await hashCatalog(remote);
    const opts = {
      ...base,
      deltaUrl: undefined,
      bakedCatalog: baked,
      storage: memoryStorage(),
      fetchImpl: async (url: string) => (url.includes("manifest") ? manifestWithHash(remoteHash) : remote),
    };

    const first = await loadMessages(opts);
    expect(await loadMessages(opts)).toBe(first);
    expect(await loadMessages({ ...opts, manifestUrl: "https://staging.example/manifest/site.json" })).not.toBe(first);
  });
});

describe("loadMessages manifest verification", () => {
  const baked: Catalog = { Greeting: "Hi {name}" };
  const remote: Catalog = { Greeting: "Hey {name}" };
  let remoteHash: string;
  beforeAll(async () => {
    remoteHash = await hashCatalog(remote);
  });

  async function run(manifest: Manifest | (() => Promise<Manifest>), over: Partial<LoadMessagesOptions> = {}) {
    const errors: unknown[] = [];
    const fetched: string[] = [];
    const result = await loadMessages({
      app: APP,
      lang: LANG,
      buildVersion: BUILD_VERSION,
      bakedCatalog: baked,
      manifestUrl: MANIFEST_URL,
      catalogUrl,
      fetchImpl: async (url) => {
        fetched.push(url);
        if (url.startsWith(MANIFEST_URL)) return typeof manifest === "function" ? manifest() : manifest;
        return remote;
      },
      onError: (e) => errors.push(e),
      ...over,
    });
    return { result, errors, fetched, messages: errors.map(String) };
  }

  it("rejects an unsigned manifest and never fetches the catalog", async () => {
    const r = await run(unsignedManifest(remoteHash));
    expect(r.result).toBe(baked);
    expect(r.fetched).toEqual([MANIFEST_URL]);
    expect(r.messages[0]).toContain("ota manifest rejected for site/en:");
  });

  it("rejects a manifest signed by an untrusted key", async () => {
    const other = await generateSigningKey();
    const m = await signManifest(await manifestWithHash(remoteHash), parseSigningKey(other.secret));
    const r = await run(m);
    expect(r.result).toBe(baked);
    expect(r.messages[0]).toContain("ota manifest rejected");
  });

  it("rejects a hash tampered after signing", async () => {
    const m = await manifestWithHash(remoteHash);
    m.apps[APP]![LANG]!.hash = "f".repeat(64);
    const r = await run(m);
    expect(r.result).toBe(baked);
    expect(r.messages[0]).toContain("ota manifest rejected");
  });

  it("rejects when publicKeys is empty", async () => {
    const r = await run(await manifestWithHash(remoteHash), { publicKeys: [] });
    expect(r.result).toBe(baked);
    expect(r.messages[0]).toContain("ota manifest rejected");
  });

  it("rejects an expired manifest", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const r = await run(await manifestWithHash(remoteHash, undefined, { expiresAt: past }));
    expect(r.result).toBe(baked);
    expect(r.messages[0]).toContain(`expired at ${past}`);
  });

  it("sequence: equal accepted, lower rejected, higher updates the stored value", async () => {
    const at = async (n: number) => run(await manifestWithHash(remoteHash, undefined, { sequence: n }));
    const key = `locale-seq:${APP}:${MANIFEST_URL}`;

    expect((await at(5)).result).toEqual(remote);
    expect(localStorage.getItem(key)).toBe("5");
    clearLoadMessagesMemo();

    const low = await at(4);
    expect(low.result).toBe(baked);
    expect(low.messages[0]).toContain("sequence 4 is lower than the last accepted 5");

    clearLoadMessagesMemo();
    expect((await at(5)).result).toEqual(remote);
    expect(localStorage.getItem(key)).toBe("5");

    clearLoadMessagesMemo();
    expect((await at(6)).result).toEqual(remote);
    expect(localStorage.getItem(key)).toBe("6");
  });

  it("replay protection survives a cache-busting query on the manifest URL", async () => {
    const at = async (n: number, q: string) => {
      const m = await manifestWithHash(remoteHash, undefined, { sequence: n });
      return run(m, { manifestUrl: `${MANIFEST_URL}?t=${q}` });
    };
    expect((await at(5, "1")).result).toEqual(remote);
    clearLoadMessagesMemo();
    const replay = await at(4, "2");
    expect(replay.result).toBe(baked);
    expect(replay.messages[0]).toContain("lower than");
  });

  it("the memo cannot bypass verification: a replayed lower-sequence manifest at the same hash is rejected", async () => {
    expect((await run(await manifestWithHash(remoteHash, undefined, { sequence: 5 }))).result).toEqual(remote);
    const replay = await run(await manifestWithHash(remoteHash, undefined, { sequence: 4 }));
    expect(replay.result).toBe(baked);
    expect(replay.messages[0]).toContain("lower than");
  });

  it("garbage in the stored sequence counts as 0", async () => {
    localStorage.setItem(`locale-seq:${APP}:${MANIFEST_URL}`, "not-a-number");
    const r = await run(await manifestWithHash(remoteHash, undefined, { sequence: 1 }));
    expect(r.result).toEqual(remote);
    expect(localStorage.getItem(`locale-seq:${APP}:${MANIFEST_URL}`)).toBe("1");
  });

  describe("insecureDevMode", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("on localhost accepts an unsigned manifest without writing the sequence", async () => {
      const r = await run(unsignedManifest(remoteHash), { insecureDevMode: true, publicKeys: [] });
      expect(r.result).toEqual(remote);
      expect(r.errors).toEqual([]);
      expect(localStorage.getItem(`locale-seq:${APP}:${MANIFEST_URL}`)).toBeNull();
    });

    it("is ignored off localhost: reported, and the unsigned manifest is rejected", async () => {
      vi.stubGlobal("location", { hostname: "cdn.example" });
      const r = await run(unsignedManifest(remoteHash), { insecureDevMode: true });
      expect(r.result).toBe(baked);
      expect(r.messages[0]).toContain("insecureDevMode ignored");
      expect(r.messages[1]).toContain("ota manifest rejected");
    });

    it("is not honored when there is no location global", async () => {
      vi.stubGlobal("location", undefined);
      const r = await run(unsignedManifest(remoteHash), { insecureDevMode: true });
      expect(r.result).toBe(baked);
      expect(r.messages[0]).toContain("insecureDevMode ignored");
    });
  });

  describe("placeholder parity", () => {
    it("keeps the baked string when the placeholder set changes, and reports it", async () => {
      const bad: Catalog = { Greeting: "Yo {who}" };
      const r = await run(await manifestWithHash(await hashCatalog(bad)), {
        fetchImpl: async (url) => (url === MANIFEST_URL ? manifestWithHash(await hashCatalog(bad)) : bad),
      });
      expect(r.result).toEqual(baked);
      expect(r.messages).toEqual(["Error: ota placeholder gate dropped site/en keys (baked value kept): Greeting"]);
    });

    it("applies a same-vars value and a new key with vars", async () => {
      const next: Catalog = { Greeting: "Hello {name}", Fresh: "Hi {a} {b}" };
      const r = await run(await manifestWithHash(await hashCatalog(next)), {
        fetchImpl: async (url) => (url === MANIFEST_URL ? manifestWithHash(await hashCatalog(next)) : next),
      });
      expect(r.result).toEqual(next);
      expect(r.errors).toEqual([]);
    });

    it("also gates the delta path", async () => {
      const bad: Catalog = { Greeting: "Yo {who}" };
      const bakedHash = await hashCatalog(baked);
      const badHash = await hashCatalog(bad);
      const r = await run(await manifestWithHash(badHash, { [bakedHash]: badHash }), {
        bakedHash,
        deltaUrl,
        fetchImpl: async (url) =>
          url === MANIFEST_URL ? manifestWithHash(badHash, { [bakedHash]: badHash }) : { changed: bad },
      });
      expect(r.result).toEqual(baked);
      expect(r.messages[0]).toContain("placeholder gate dropped");
    });
  });
});

describe("injectInto", () => {
  it("calls the setter with a new object reference", () => {
    const catalog: Catalog = { A: "a" };
    let received: Catalog | undefined;
    injectInto(catalog, (c) => {
      received = c;
    });
    expect(received).not.toBe(catalog);
    expect(received).toEqual(catalog);
  });
});

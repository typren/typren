import { beforeEach, describe, expect, it } from "vitest";
import { hashCatalog } from "../canonicalize";
import type { Catalog, Manifest } from "../types";
import { injectInto, loadMessages, type KVStorage } from "./index";

const APP = "site";
const LANG = "en";
const BUILD_VERSION = "v1";
const MANIFEST_URL = "https://cdn.example/manifest/site.json";
const catalogUrl = (hash: string) => `https://cdn.example/catalog/site/en/${hash}.json`;

function manifestWithHash(hash: string): Manifest {
  return { v: 1, buildVersion: BUILD_VERSION, apps: { [APP]: { [LANG]: { hash } } } };
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
    // The release removed Nav.Legacy AND edited Greeting.Hello — the additive
    // merge can never hash to R, which the old flow treated as corruption
    // (permanently bricking OTA + refetching every load).
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

    const cached = JSON.parse(localStorage.getItem(`locale:${APP}:${LANG}:${BUILD_VERSION}`)!);
    expect(cached.hash).toBe(remoteHash);
    expect(cached.catalog).toEqual(result);

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
    localStorage.setItem(`locale:${APP}:other-lang:v0`, "unrelated"); // different prefix — untouched

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

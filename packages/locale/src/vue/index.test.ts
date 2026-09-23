import { beforeEach, describe, expect, it } from "vitest";
import { computed, nextTick, ref, watch } from "vue";
import { hashCatalog } from "../canonicalize";
import type { Catalog, Manifest } from "../types";
import { clearLoadMessagesMemo, type KVStorage } from "../ota";
import {
  applyOtaForLocale,
  applyOtaVueI18n,
  createVueComposableOtaClient,
  type VueComposableI18nInstance,
  type VueComposableOtaClientOptions,
  type VueI18nStoreLike,
} from "./index";

function makeStore(messages: Record<string, unknown>): VueI18nStoreLike & { calls: number } {
  return {
    calls: 0,
    i18n: { locale: "en-GB", fallback: "custom-1", messages },
    setI18n(def) {
      this.calls++;
      this.i18n = def;
    },
  };
}

/** manifest+catalog fetch stub: baked {a:'1'} -> remote {a:'2', b:'3'} (change+add, no removal). */
function makeFetch(app: string, locale: string, remote: Catalog) {
  return async (url: string): Promise<unknown> => {
    if (url.includes("manifest")) {
      return { v: 1, buildVersion: "b1", apps: { [app]: { [locale]: { hash: await hashCatalog(remote) } } } };
    }
    return remote;
  };
}

const OPTS = {
  app: "site",
  buildVersion: "b1",
  locale: "en-GB",
  manifestUrl: "https://cdn/manifest/site.json",
  catalogUrl: (h: string) => `https://cdn/catalog/site/en-GB/${h}.json`,
};

// See packages/locale/src/ota/index.test.ts for why this is needed: Node's
// own inert `localStorage` global shadows jsdom's real one in this runtime.
const realLocalStorage = (globalThis as { jsdom?: { window: { localStorage: Storage } } }).jsdom?.window
  ?.localStorage;
if (realLocalStorage) {
  Object.defineProperty(globalThis, "localStorage", { value: realLocalStorage, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  clearLoadMessagesMemo();
});

describe("applyOtaForLocale", () => {
  it("delta path: merged messages injected via setI18n", async () => {
    const store = makeStore({ "en-GB": { a: "1" } });
    await applyOtaForLocale(store, { ...OPTS, fetchImpl: makeFetch("site", "en-GB", { a: "2", b: "3" }) });
    expect(store.calls).toBe(1);
    expect(store.i18n.messages["en-GB"]).toEqual({ a: "2", b: "3" });
  });

  it("no-change path: baked hash equals remote -> store untouched", async () => {
    const baked: Catalog = { a: "1" };
    const store = makeStore({ "en-GB": baked });
    // remote identical to baked -> loadMessages returns baked, no setI18n.
    await applyOtaForLocale(store, { ...OPTS, fetchImpl: makeFetch("site", "en-GB", { a: "1" }) });
    expect(store.calls).toBe(0);
  });

  it("lazy locale (function) is skipped, never throws", async () => {
    const store = makeStore({ "en-GB": () => Promise.resolve({ a: "1" }) });
    await applyOtaForLocale(store, { ...OPTS, fetchImpl: makeFetch("site", "en-GB", { a: "2" }) });
    expect(store.calls).toBe(0);
  });

  it("fetch failure -> store untouched, no throw", async () => {
    const store = makeStore({ "en-GB": { a: "1" } });
    await applyOtaForLocale(store, {
      ...OPTS,
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    expect(store.calls).toBe(0);
  });
});

describe("applyOtaVueI18n", () => {
  it("vue-i18n variant: setLocaleMessage called with merged catalog", async () => {
    const messages: Record<string, Record<string, unknown>> = { "en-GB": { a: "1" } };
    let sets = 0;
    const global = {
      getLocaleMessage: (l: string) => messages[l] ?? {},
      setLocaleMessage: (l: string, m: Record<string, unknown>) => {
        sets++;
        messages[l] = m;
      },
    };
    await applyOtaVueI18n(global, { ...OPTS, fetchImpl: makeFetch("site", "en-GB", { a: "2", b: "3" }) });
    expect(sets).toBe(1);
    expect(messages["en-GB"]).toEqual({ a: "2", b: "3" });
  });

  it("vue-i18n variant: unloaded locale (empty) skipped", async () => {
    let sets = 0;
    const global = {
      getLocaleMessage: () => ({}),
      setLocaleMessage: () => {
        sets++;
      },
    };
    await applyOtaVueI18n(global, { ...OPTS, fetchImpl: makeFetch("site", "en-GB", { a: "2" }) });
    expect(sets).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createVueComposableOtaClient
// ---------------------------------------------------------------------------

function memoryStorage(): KVStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

/** vue-composable's deepClone equivalent, enough for the resolver port below. */
function deepMerge(target: Record<string, unknown>, ...sources: Array<Record<string, unknown> | undefined>): Record<string, unknown> {
  for (const source of sources) {
    for (const key of Object.keys(source ?? {})) {
      const value = source![key];
      if (typeof value === "object" && value !== null) {
        if (typeof target[key] !== "object" || target[key] === null) target[key] = {};
        deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        target[key] = value;
      }
    }
  }
  return target;
}

interface FakeI18nDefinition {
  locale: string;
  fallback?: string;
  messages: Record<string, Record<string, unknown>>;
}

/**
 * Faithful mini-port of the resolver mechanics of vue-composable's
 * `buildI18n` (vue-composable@1.0.0-beta.24,
 * dist/vue-composable.esm-bundler.js), reduced to the synchronous-messages
 * case the OTA client integrates with:
 *
 * - lines 3158-3162: `localeMessages`/`locale`/`i18n`/`fallback` refs.
 * - lines 3191-3208: `shouldFallback`, and the `fallback` ref populated ONCE
 *   from the definition's messages. This is the frozen reference.
 * - lines 3212-3216: deep watcher on `localeMessages` bumping
 *   `localeChangesCount`.
 * - lines 3217-3235: the resolver watcher over
 *   `[locale, fallback, localeChangesCount]`, with the branch
 *   `if (l === definition.fallback && shouldFallback) i18n.value = fb`
 *   re-serving the frozen object, else `deepClone({}, fb, messages[l])`.
 * - lines 3245-3260: `addLocale` writing `localeMessages.value[l] = m`,
 *   which the frozen `fallback` ref never re-reads.
 */
function buildFakeI18n(definition: FakeI18nDefinition) {
  const localeMessages = ref<Record<string, Record<string, unknown>>>(definition.messages);
  const locale = ref(definition.locale);
  const i18n = ref<Record<string, unknown>>({});
  const fallback = ref<Record<string, unknown>>();
  const shouldFallback = Boolean(definition.fallback);
  if (shouldFallback) {
    fallback.value = localeMessages.value[definition.fallback!];
  } else {
    fallback.value = {};
  }
  const localeChangesCount = ref(0);
  watch(localeMessages, () => localeChangesCount.value++, { deep: true, immediate: false });
  watch(
    [locale, fallback, localeChangesCount],
    ([l, fb]) => {
      if (l === definition.fallback && shouldFallback) {
        i18n.value = fb as Record<string, unknown>;
      } else {
        i18n.value = deepMerge({}, fb, localeMessages.value[l as string]);
      }
    },
    { immediate: true },
  );
  const addLocale = (l: string, m: Record<string, unknown>) => {
    localeMessages.value[l] = m;
  };
  return { locale, i18n, addLocale };
}

/** Store-shaped view of the fake engine, matching what a reactive wrapper exposes. */
function instanceOf(engine: ReturnType<typeof buildFakeI18n>, fallback?: string): VueComposableI18nInstance {
  return {
    get locale() {
      return engine.locale.value;
    },
    fallback,
    get i18n() {
      return engine.i18n.value;
    },
    addLocale: engine.addLocale,
  };
}

/** Recording instance stub for tests that need no live engine. */
function makeInstance(active: string, fallback?: string, tree: Record<string, unknown> = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const instance: VueComposableI18nInstance = {
    locale: active,
    fallback,
    i18n: tree,
    addLocale: (l, m) => {
      calls.push([l, m]);
    },
  };
  return { instance, calls };
}

/** Serves a manifest carrying every remote's hash, and each locale's remote catalog. */
function makeClientFetch(app: string, remotes: Record<string, Catalog>) {
  return async (url: string): Promise<unknown> => {
    if (url.includes("manifest")) {
      const apps: Manifest["apps"] = { [app]: {} };
      for (const [locale, catalog] of Object.entries(remotes)) {
        apps[app]![locale] = { hash: await hashCatalog(catalog) };
      }
      return { v: 1, buildVersion: "b1", apps } satisfies Manifest;
    }
    const locale = /catalog\/[^/]+\/([^/]+)\//.exec(url)?.[1];
    return remotes[locale!];
  };
}

function clientOpts(over: Partial<VueComposableOtaClientOptions>): VueComposableOtaClientOptions {
  return {
    app: "site",
    buildVersion: "b1",
    manifestUrl: "https://cdn/manifest/site.json",
    catalogUrl: (locale, hash) => `https://cdn/catalog/site/${locale}/${hash}.json`,
    bakedCatalogFor: () => ({}),
    storage: memoryStorage(),
    ...over,
  };
}

describe("vue-composable frozen fallback (defect reproduction)", () => {
  it("addLocale alone never re-renders the fallback locale", async () => {
    const engine = buildFakeI18n({
      locale: "en",
      fallback: "en",
      messages: { en: { Greeting: "Hello" }, es: { Greeting: "Hola" } },
    });
    const rendered = computed(() => (engine.i18n.value as { Greeting?: string }).Greeting);
    await nextTick();
    expect(rendered.value).toBe("Hello");

    engine.addLocale("en", { Greeting: "Hello v2" });
    await nextTick();
    await nextTick();
    // The deep watcher DID re-run the resolver, but the fallback branch
    // re-serves the frozen `fallback` ref built once from the definition,
    // so the replaced localeMessages entry never reaches rendering.
    expect(rendered.value).toBe("Hello");
  });
});

describe("createVueComposableOtaClient", () => {
  it("fallback locale: apply refreshes the frozen fallback tree in place", async () => {
    const engine = buildFakeI18n({
      locale: "en",
      fallback: "en",
      messages: { en: { Greeting: "Hello", Nested: { Bye: "Bye" } }, es: { Greeting: "Hola" } },
    });
    const remoteEn: Catalog = {
      Greeting: "Hello v2",
      Nested: { Bye: "Bye v2" },
      Added: "New",
      AddedTree: { Deep: "x" },
    };
    const client = createVueComposableOtaClient(
      () => instanceOf(engine, "en"),
      clientOpts({
        bakedCatalogFor: () => ({ Greeting: "Hello", Nested: { Bye: "Bye" } }),
        fetchImpl: makeClientFetch("site", { en: remoteEn }),
      }),
    );
    const rendered = computed(() => (engine.i18n.value as { Greeting?: string }).Greeting);
    await nextTick();
    expect(rendered.value).toBe("Hello");

    await client.apply("en");
    await nextTick();
    expect(rendered.value).toBe("Hello v2");
    expect(engine.i18n.value).toEqual(remoteEn);

    // Switching away and back keeps serving the refreshed content.
    engine.locale.value = "es";
    await nextTick();
    expect((engine.i18n.value as { Greeting?: string }).Greeting).toBe("Hola");
    engine.locale.value = "en";
    await nextTick();
    expect((engine.i18n.value as { Greeting?: string }).Greeting).toBe("Hello v2");
  });

  it("fallback applied while another locale is active falls back to addLocale, then repairs", async () => {
    const engine = buildFakeI18n({
      locale: "es",
      fallback: "en",
      messages: { en: { Greeting: "Hello" }, es: { Greeting: "Hola" } },
    });
    const client = createVueComposableOtaClient(
      () => instanceOf(engine, "en"),
      clientOpts({
        bakedCatalogFor: () => ({ Greeting: "Hello" }),
        fetchImpl: makeClientFetch("site", { en: { Greeting: "Hello v2" } }),
      }),
    );
    await nextTick();

    // Active locale is es: the frozen fallback tree is unreachable, so the
    // client can only addLocale, which the frozen ref never re-reads.
    await client.apply("en");
    engine.locale.value = "en";
    await nextTick();
    expect((engine.i18n.value as { Greeting?: string }).Greeting).toBe("Hello");

    // Now the instance serves its fallback locale: capture and repair.
    await client.apply("en");
    await nextTick();
    expect((engine.i18n.value as { Greeting?: string }).Greeting).toBe("Hello v2");
  });

  it("merges onto bakedCatalogFor's catalog, never the instance's rendered tree", async () => {
    // Mid-switch shape: the instance still renders English while Spanish is
    // being applied. The English tree must poison neither merge nor cache.
    const { instance, calls } = makeInstance("en", "en", { Greeting: "Hello" });
    const storage = memoryStorage();
    const requestedLocales: string[] = [];
    const client = createVueComposableOtaClient(
      () => instance,
      clientOpts({
        bakedCatalogFor: (locale) => {
          requestedLocales.push(locale);
          return { Greeting: "Hola" };
        },
        fetchImpl: makeClientFetch("site", { es: { Greeting: "Hola v2", Added: "Nuevo" } }),
        storage,
      }),
    );
    await client.apply("es");
    expect(requestedLocales).toEqual(["es"]);
    expect(calls).toEqual([["es", { Greeting: "Hola v2", Added: "Nuevo" }]]);
    const cached = JSON.parse(storage.getItem("locale:site:es:b1")!) as { catalog: Catalog };
    expect(cached.catalog).toEqual({ Greeting: "Hola v2", Added: "Nuevo" });
  });

  it("applies transform to the merged catalog before injection", async () => {
    const { instance, calls } = makeInstance("es", "en");
    const client = createVueComposableOtaClient(
      () => instance,
      clientOpts({
        bakedCatalogFor: () => ({ Greeting: "Hola {name}" }),
        fetchImpl: makeClientFetch("site", { es: { Greeting: "Hola {{name}}!" } }),
        transform: (catalog) => JSON.parse(JSON.stringify(catalog).replace(/\{\{(\w+)\}\}/g, "{$1}")) as Catalog,
      }),
    );
    await client.apply("es");
    expect(calls).toEqual([["es", { Greeting: "Hola {name}!" }]]);
  });

  it("passes a per-locale deltaUrl through and uses the verified delta", async () => {
    const { instance, calls } = makeInstance("es");
    const baked: Catalog = { Greeting: "Hola" };
    const merged: Catalog = { Greeting: "Hola v2" };
    const bakedHash = await hashCatalog(baked);
    const remoteHash = await hashCatalog(merged);
    const deltaUrls: string[] = [];
    const client = createVueComposableOtaClient(
      () => instance,
      clientOpts({
        bakedCatalogFor: () => ({ Greeting: "Hola" }),
        deltaUrl: (locale, fromHash, toHash) => {
          const url = `https://cdn/delta/site/${locale}/${fromHash}-${toHash}.json`;
          deltaUrls.push(url);
          return url;
        },
        fetchImpl: async (url) => {
          if (url.includes("manifest")) {
            return { v: 1, buildVersion: "b1", apps: { site: { es: { hash: remoteHash } } } } satisfies Manifest;
          }
          if (url.includes("delta")) {
            return { changed: { Greeting: "Hola v2" }, additiveHash: remoteHash };
          }
          throw new Error(`full catalog must not be fetched: ${url}`);
        },
      }),
    );
    await client.apply("es");
    expect(deltaUrls).toEqual([`https://cdn/delta/site/es/${bakedHash}-${remoteHash}.json`]);
    expect(calls).toEqual([["es", merged]]);
  });

  it("bakedCatalogFor failure reports through onError and injects nothing", async () => {
    const { instance, calls } = makeInstance("es");
    const errors: unknown[] = [];
    const client = createVueComposableOtaClient(
      () => instance,
      clientOpts({
        bakedCatalogFor: () => {
          throw new Error("baked catalog module missing");
        },
        fetchImpl: makeClientFetch("site", { es: { Greeting: "Hola v2" } }),
        onError: (e) => errors.push(e),
      }),
    );
    await client.apply("es");
    expect(calls).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("nullish instance (store not ready) skips injection without throwing", async () => {
    const client = createVueComposableOtaClient(
      () => null,
      clientOpts({
        bakedCatalogFor: () => ({ Greeting: "Hola" }),
        fetchImpl: makeClientFetch("site", { es: { Greeting: "Hola v2" } }),
      }),
    );
    await expect(client.apply("es")).resolves.toBeUndefined();
  });

  it("race: a stale apply resolving after a newer one never injects", async () => {
    const { instance, calls } = makeInstance("fr");
    const remoteEs: Catalog = { Greeting: "Hola v2" };
    const remoteFr: Catalog = { Greeting: "Bonjour v2" };
    const manifest: Manifest = {
      v: 1,
      buildVersion: "b1",
      apps: { site: { es: { hash: await hashCatalog(remoteEs) }, fr: { hash: await hashCatalog(remoteFr) } } },
    };
    let releaseStaleManifest!: (value: unknown) => void;
    const staleManifest = new Promise((resolve) => {
      releaseStaleManifest = resolve;
    });
    let manifestCalls = 0;
    const storage = memoryStorage();
    const client = createVueComposableOtaClient(
      () => instance,
      clientOpts({
        bakedCatalogFor: (locale) => (locale === "es" ? { Greeting: "Hola" } : { Greeting: "Bonjour" }),
        fetchImpl: async (url) => {
          if (url.includes("manifest")) {
            manifestCalls++;
            if (manifestCalls === 1) return staleManifest; // the FIRST apply hangs here
            return manifest;
          }
          return url.includes("/es/") ? remoteEs : remoteFr;
        },
        storage,
      }),
    );

    const stale = client.apply("es");
    const fresh = client.apply("fr");
    await fresh;
    releaseStaleManifest(manifest);
    await stale;

    // Only the newer apply injected; the stale one was guarded out.
    expect(calls).toEqual([["fr", { Greeting: "Bonjour v2" }]]);
    // The stale apply's pre-guard cache write is still locale-correct,
    // because bakedCatalogFor is: no cross-locale contamination.
    const cachedEs = JSON.parse(storage.getItem("locale:site:es:b1")!) as { catalog: Catalog };
    expect(cachedEs.catalog).toEqual({ Greeting: "Hola v2" });
  });
});

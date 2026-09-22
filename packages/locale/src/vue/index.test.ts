import { beforeEach, describe, expect, it } from "vitest";
import { hashCatalog } from "../canonicalize";
import type { Catalog } from "../types";
import { applyOtaForLocale, applyOtaVueI18n, type VueI18nStoreLike } from "./index";

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

import type { Catalog } from "../types";
import { UNSAFE_KEYS } from "../delta";
import { loadMessages, type LoadMessagesOptions } from "../ota";

/**
 * Shape of the in-house `vue-composable` i18n store: an i18n definition
 * (`{ locale, messages, fallback }`) held behind a `shallowRef` and replaced
 * wholesale via `setI18n`. This adapter feeds the existing render engine,
 * which already handles interpolation/plurals. It only swaps message
 * strings in, never interpolates itself.
 */
export interface VueComposableI18nDefinition {
  locale: string;
  fallback?: string;
  messages: Record<string, unknown>;
}

export interface VueI18nStoreLike {
  i18n: VueComposableI18nDefinition;
  setI18n(def: VueComposableI18nDefinition): void;
}

export type ApplyOtaOptions = Omit<LoadMessagesOptions, "bakedCatalog" | "lang"> & {
  /** Locale to patch, e.g. "en-GB". */
  locale: string;
};

/**
 * Fetch the OTA delta for one locale and merge it into the store's
 * `vue-composable` messages, replacing `i18n` via `setI18n` so the
 * `shallowRef` identity changes and `$t` re-renders.
 *
 * Additive and fail-safe. Leaves the store untouched when the locale's
 * messages are still a lazy `() => import()` (not loaded yet, call again
 * after load), when OTA reports no change, or when anything throws. Never
 * throws.
 */
export async function applyOtaForLocale(store: VueI18nStoreLike, options: ApplyOtaOptions): Promise<void> {
  const { locale, ...rest } = options;
  const current = store.i18n;
  const baked = current?.messages?.[locale];
  // Only patch a locale whose messages are a resolved object, not a lazy loader.
  if (!baked || typeof baked === "function") return;
  const bakedCatalog = baked as Catalog;
  try {
    const merged = await loadMessages({
      ...rest,
      lang: locale,
      bakedCatalog,
    });
    if (merged === bakedCatalog) return; // no change, leave the store alone
    store.setI18n({
      ...current,
      messages: { ...current.messages, [locale]: merged },
    });
  } catch {
    // fail-safe: keep baked in place
  }
}

/**
 * Shape of `i18n.global` from official vue-i18n (`createI18n({ legacy: false })`).
 * `setLocaleMessage` is reactive on its own, so no ref-swap dance is needed here.
 */
export interface VueI18nGlobalLike {
  getLocaleMessage(locale: string): Record<string, unknown>;
  setLocaleMessage(locale: string, messages: Record<string, unknown>): void;
}

/**
 * vue-i18n variant of {@link applyOtaForLocale}: merges the OTA delta onto a
 * locale via `i18n.global.setLocaleMessage`. Additive and fail-safe. Leaves
 * the instance untouched when the locale isn't loaded yet (empty message
 * object), when OTA reports no change, or when anything throws. Never
 * throws.
 */
export async function applyOtaVueI18n(global: VueI18nGlobalLike, options: ApplyOtaOptions): Promise<void> {
  const { locale, ...rest } = options;
  const baked = global.getLocaleMessage(locale) as Catalog;
  if (!baked || Object.keys(baked).length === 0) return; // not loaded yet
  try {
    const merged = await loadMessages({
      ...rest,
      lang: locale,
      bakedCatalog: baked,
    });
    if (merged === baked) return; // no change
    global.setLocaleMessage(locale, merged);
  } catch {
    // fail-safe: keep baked in place
  }
}

/**
 * Shape of a `vue-composable` i18n RESULT instance (the object `useI18n` /
 * `buildI18n` returns, typically unwrapped behind a reactive store): the
 * active locale, the fallback locale name carried over from the definition,
 * the resolved message tree of the ACTIVE locale, and `addLocale`. This is a
 * different integration surface from {@link VueI18nStoreLike}, which wraps
 * the i18n DEFINITION behind a `setI18n` swap.
 */
export interface VueComposableI18nInstance {
  /** Active locale, e.g. "en-GB". */
  locale: string;
  /** Fallback locale name from the i18n definition, when one exists. */
  fallback?: string;
  /** Resolved message tree of the ACTIVE locale, live-updated by the engine. */
  i18n: Record<string, unknown>;
  addLocale(locale: string, messages: Record<string, unknown>): void;
}

export interface VueComposableOtaClientOptions {
  /** OTA app name, the `{app}` in manifest and catalog URLs. */
  app: string;
  buildVersion: string;
  manifestUrl: string;
  /** Builds the URL for one locale's full catalog at a given content hash. */
  catalogUrl(locale: string, hash: string): string;
  /** Per-locale variant of `LoadMessagesOptions.deltaUrl`. */
  deltaUrl?(locale: string, fromHash: string, toHash: string): string;
  /**
   * Resolves the TRUE baked catalog for a locale, e.g. from the same module
   * map the i18n definition was built from. It must never be read off the
   * instance's rendered tree: mid-switch that tree is still the PREVIOUS
   * locale's content, and merging onto it would poison both the merge and
   * the localStorage cache entry `loadMessages` writes for
   * {app, locale, buildVersion}.
   */
  bakedCatalogFor(locale: string): Promise<Catalog> | Catalog;
  /**
   * Optional rewrite of the merged catalog before injection, e.g. the same
   * placeholder normalization ("{{var}}" to "{var}") a consumer's build
   * pipeline performs on its baked catalogs.
   */
  transform?(catalog: Catalog, locale: string): Catalog;
  fetchImpl?: LoadMessagesOptions["fetchImpl"];
  storage?: LoadMessagesOptions["storage"];
  /** Alert-not-silent hook, passed through to `loadMessages` and also fired on any failure in `apply` itself. */
  onError?(error: unknown): void;
}

export interface VueComposableOtaClient {
  /**
   * Fetch the OTA overlay for one locale, merge it onto that locale's baked
   * catalog, and inject the result into the instance. Fail-safe and guarded:
   * it never throws, and a stale `apply` that resolves after a newer one
   * never injects. Call it once at boot and again on every locale change.
   *
   * Note that `loadMessages`' own localStorage cache write happens before
   * the staleness guard, keyed by {app, locale, buildVersion}. That is safe
   * exactly because `bakedCatalogFor` is locale-correct: the cached entry is
   * always that locale's true merge, never another locale's content.
   */
  apply(locale: string): Promise<void>;
}

/**
 * Replaces `target`'s contents with `next`'s WITHOUT changing `target`'s
 * identity, recursing into shared subtrees so unchanged leaves are not
 * touched (which would trigger spurious reactive effects). Keys absent from
 * `next` are deleted. `next` crosses a trust boundary (a fetched catalog,
 * or a consumer `transform`), so unsafe keys are skipped, matching
 * `canonicalize`/`merge`.
 */
function replaceCatalogInPlace(target: Catalog, next: Catalog): void {
  for (const key of Object.keys(target)) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) delete target[key];
  }
  for (const key of Object.keys(next)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const value = next[key]!;
    const existing = target[key];
    if (typeof value === "string") {
      if (existing !== value) target[key] = value;
    } else if (typeof existing === "object" && existing !== null) {
      replaceCatalogInPlace(existing, value);
    } else {
      target[key] = value;
    }
  }
}

/**
 * OTA client for a `vue-composable` i18n RESULT instance. Owns per-locale
 * application end to end: resolve the true baked catalog, run
 * `loadMessages`, apply the optional `transform`, and inject.
 *
 * Injection is `instance.addLocale(locale, merged)`, with one crucial
 * exception. In vue-composable's `buildI18n`
 * (vue-composable@1.0.0-beta.24, dist/vue-composable.esm-bundler.js), the
 * `fallback` ref is populated ONCE from the definition (lines 3197-3208) and
 * the resolver re-serves that same frozen object whenever the active locale
 * IS the fallback locale (`if (l === definition.fallback && shouldFallback)
 * i18n.value = fb`, lines 3217-3235). `addLocale` only writes
 * `localeMessages.value[l] = m` (lines 3245-3260), which the frozen ref
 * never re-reads, so for the fallback locale it is a silent rendering
 * no-op. The fix: whenever the instance is observed serving its fallback
 * locale, its resolved tree IS the object behind that frozen ref, so the
 * client captures it and applies fallback-locale updates by deep in-place
 * mutation of that object. Property-level reactivity then re-renders it,
 * and while the captured object is still the same one inside
 * `localeMessages` the deep watcher (lines 3212-3216) re-runs the resolver
 * too. If the fallback tree has not been capturable yet (the instance has
 * never been observed serving its fallback locale), the client falls back
 * to `addLocale`, which still feeds the non-fallback merge path, and
 * repairs the frozen tree on the next `apply` once it is reachable.
 *
 * `getInstance` is called at injection time, after all awaits, so it must
 * return the CURRENT instance (or nullish while the store is not ready,
 * which skips the injection).
 */
export function createVueComposableOtaClient(
  getInstance: () => VueComposableI18nInstance | null | undefined,
  options: VueComposableOtaClientOptions,
): VueComposableOtaClient {
  const { app, buildVersion, manifestUrl, catalogUrl, deltaUrl, bakedCatalogFor, transform, fetchImpl, storage, onError } =
    options;

  // Monotonic generation: every apply invalidates all in-flight ones before
  // it, so a stale apply resolving late can never inject over a newer one.
  let generation = 0;

  // The live object behind vue-composable's frozen `fallback` ref, captured
  // whenever the instance is observed serving its fallback locale.
  let fallbackTree: Catalog | undefined;

  const captureFallbackTree = (instance: VueComposableI18nInstance): void => {
    if (
      instance.fallback !== undefined &&
      instance.locale === instance.fallback &&
      typeof instance.i18n === "object" &&
      instance.i18n !== null
    ) {
      fallbackTree = instance.i18n as Catalog;
    }
  };

  const apply = async (locale: string): Promise<void> => {
    const gen = ++generation;
    try {
      const baked = await bakedCatalogFor(locale);
      const merged = await loadMessages({
        app,
        lang: locale,
        buildVersion,
        bakedCatalog: baked,
        manifestUrl,
        catalogUrl: (hash) => catalogUrl(locale, hash),
        deltaUrl: deltaUrl ? (fromHash, toHash) => deltaUrl(locale, fromHash, toHash) : undefined,
        fetchImpl,
        storage,
        onError,
      });
      if (gen !== generation) return; // a newer apply superseded this one
      if (merged === baked) return; // fail-to-baked or no change: leave the instance alone
      const catalog = transform ? transform(merged, locale) : merged;
      const instance = getInstance();
      if (!instance) return;
      captureFallbackTree(instance);
      if (locale === instance.fallback && fallbackTree) {
        // In-place mutation updates the frozen fallback ref, and, while the
        // identity is still shared, localeMessages[fallback] with it.
        // addLocale here would instead replace the entry with a new object
        // the frozen ref never sees.
        replaceCatalogInPlace(fallbackTree, catalog);
        return;
      }
      instance.addLocale(locale, catalog as Record<string, unknown>);
    } catch (error) {
      onError?.(error);
    }
  };

  return { apply };
}

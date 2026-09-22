import type { Catalog } from "../types";
import { hashCatalog } from "../canonicalize";
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

export type ApplyOtaOptions = Omit<LoadMessagesOptions, "bakedCatalog" | "bakedHash" | "lang"> & {
  /** Locale to patch, e.g. "en-GB". */
  locale: string;
  /**
   * Baked hash for {app,locale}. Defaults to hashing the loaded messages on
   * every call, which is correct but re-hashes the whole baked catalog
   * (every key, easily ~10^4 for a typical app) on every OTA poll. Pass the
   * build-time constant instead (computed once at build and inlined) to
   * skip that repeated hashing; this is the recommended production setting.
   */
  bakedHash?: string;
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
  const { locale, bakedHash, ...rest } = options;
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
      bakedHash: bakedHash ?? (await hashCatalog(bakedCatalog)),
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
  const { locale, bakedHash, ...rest } = options;
  const baked = global.getLocaleMessage(locale) as Catalog;
  if (!baked || Object.keys(baked).length === 0) return; // not loaded yet
  try {
    const merged = await loadMessages({
      ...rest,
      lang: locale,
      bakedCatalog: baked,
      bakedHash: bakedHash ?? (await hashCatalog(baked)),
    });
    if (merged === baked) return; // no change
    global.setLocaleMessage(locale, merged);
  } catch {
    // fail-safe: keep baked in place
  }
}

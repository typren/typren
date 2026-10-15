---
title: "@typren/locale reference"
description: Every export, build/OTA option and publish-gate error of @typren/locale.
category: Reference
order: 54
---

This page documents the public exports of `@typren/locale`, grouped by subpath. See [i18n](./i18n.md) for how it fits into a typren site.

## "."

Core primitives shared by the build and runtime sides: catalog resolution/interpolation, content-addressed hashing, delta diff/merge, and the no-HTML publish gate.

| Export | Signature | Notes |
|---|---|---|
| `Catalog`, `Manifest`, `ManifestEntry`, `Delta` (types) | — | Shared shapes: `Catalog` is a nested `Record<string, string \| Catalog>`; `Manifest` is `{ v: 1; buildVersion: string; apps: Record<string, Record<string, ManifestEntry>> }`; `Delta` is `{ changed: Record<string, string>; removed: string[] }`. |
| `resolve(catalog, key)` | `(catalog: Catalog, key: string) => { value: string } \| undefined` | Dot-path lookup, e.g. `"Namespace.KeyName"`. |
| `interpolate(template, args?)` | `(template: string, args?: Record<string, string \| number>) => string` | Flat single-brace `{var}` substitution only (no ICU plural/select, no `{{ }}`). A missing arg leaves the placeholder literal instead of throwing. |
| `t(catalog, key, args?)` | `(catalog: Catalog, key: string, args?) => { value: string }` | `resolve` + `interpolate`; an unknown key returns `{ value: key }` instead of throwing. |
| `getClosestLocale(supported, requested, overrides?)` | `(supported: string[], requested: string, overrides?: Record<string, string>) => string` | Fallback order: exact match → `overrides` remap → `en-US`/`en-GB` kept distinct (never collapsed to a single `"en"`) → language-only match → `supported[0]` as the last resort. |
| `canonicalize(catalog)` | `(catalog: Catalog) => string` | Deterministic serialization (NFC-normalized strings, `\r\n`/`\r` folded to `\n`, keys sorted, unsafe keys dropped) shared by every hash producer/consumer. |
| `hashCatalog(catalog)` | `(catalog: Catalog) => Promise<string>` | Full untruncated sha256 hex of the canonical form, via `crypto.subtle` (WebCrypto, so it runs identically in Node ≥18, browsers and Bun). |
| `diff(from, to)` | `(from: Catalog, to: Catalog) => Delta` | Flat dot-path diff between two catalogs. |
| `merge(baked, delta, opts?)` | `(baked: Catalog, delta: Delta, opts?: { allowRemove?: boolean }) => Catalog` | Applies a delta onto a baked catalog, returning a new object. `removed` keys are only deleted when `opts.allowRemove` is `true` (default `false`) — a delta landing on an old build must never remove keys it still calls. |
| `isPlaceholderCompatible(fromVal, toVal)` | `(fromVal: string, toVal: string) => boolean` | True when two strings use exactly the same `{var}` set; gates whether a changed string may ship as a delta to older builds. |
| `assertNoHtml(catalog, opts?)` | `(catalog: Catalog, opts?: { label?: string }) => void` | Throws if any leaf string contains a dangerous tag, inline event handler, or `javascript:` URI (including numeric-entity-encoded and whitespace-obfuscated variants). Denylist, not a tag allowlist, so benign formatting (`<a href>`, `<b>`, `<h3>`, `<ul><li>`) keeps working without a codebase change. |

#### Errors

- `getClosestLocale`: throws `` getClosestLocale: supported must be non-empty `` when `supported` is an empty array.
- `assertNoHtml`: throws `` assertNoHtml: dangerous content found[ in <label>] at: <dot-path>[, <dot-path>...] `` listing every offending leaf.

> **Security:** `UNSAFE_KEYS` (`__proto__`, `constructor`, `prototype`) is dropped everywhere a catalog key or dot-path segment is read or written — `flatten`, `setPath`, `deletePath`, and `canonicalize` all skip these, since a remote catalog is attacker-adjacent input (CDN compromise, MITM on a misconfigured origin) and assigning one of those keys would otherwise walk the prototype setter and pollute every object in the realm.

## "./build"

The CI-side build: ingest, publish gates, and content-addressed output.

| Export | Signature | Notes |
|---|---|---|
| `buildCatalogs(source, options)` | `(source: string \| SourceConfig \| LocaleSourceProvider, options: BuildOptions) => Promise<BuildResult>` | Reads every locale from `source`, runs the publish gates (no dotted keys, `assertNoHtml`) on each, hashes via `hashCatalog`, and writes `<outDir>/catalog/<app>/<lang>/<hash>.json` (exact canonical bytes, so a published file re-hashes to its own filename) plus `<outDir>/manifest/<app>.json`. Also precomputes `<outDir>/delta/<app>/<lang>/<fromHash>-<toHash>.json` for every still-on-disk release in the last `deltaHistorySize` builds, tracked via a rolling `<outDir>/manifest/<app>.history.json`. A history entry whose catalog file was since pruned is skipped (that release falls back to a full-catalog fetch); if history exists and every prior catalog is missing, that's warned rather than silently emitting zero deltas. |
| `writeDelta(fromCatalog, toCatalog, destPath?)` | `(fromCatalog: Catalog, toCatalog: Catalog, destPath?: string) => Promise<PublishedDelta>` | Computes the flat delta via `diff`, gates it on `isPlaceholderCompatible` per changed key, stamps it with `additiveHash` (the hash of `merge(from, delta, {allowRemove:false})`), and optionally writes it to `destPath`. |
| `BuildOptions` (type) | `{ app: string; buildVersion: string; outDir?: string; deltaHistorySize?: number }` | See table below. |
| `BuildResult` (type) | `{ manifest: Manifest; manifestPath: string; catalogPaths: Record<string, string>; deltaPaths: string[] }` | |
| `PublishedDelta` (type) | `Delta & { additiveHash: string }` | The on-disk delta file shape. |
| `BuildConfig` (type) | `{ app: string; source: SourceConfig }` | The committed build-config file shape; carries `"${VAR}"` placeholders, no secret values. |
| `resolveConfigEnv(config, env?)` | `(config: T, env?: Record<string, string \| undefined>) => T` | Recursively interpolates `"${VAR}"` placeholders in every string leaf against `env` (default `process.env`). |
| `collectEnvVarNames(config)` | `(config: unknown) => string[]` | Every distinct `"${VAR}"` name referenced anywhere in `config`, so every missing var can be reported at once instead of failing on the first. |
| `FilesSourceConfig` (type) | `{ type: "files"; dir: string; langMap?: Record<string, string> }` | Config for the reference fs provider: one `<locale>.json` per locale. |
| `LocaleSourceProvider` (type) | `{ readonly type: string; loadSource(): Promise<Record<string, Catalog>> }` | The provider port: implement once per ingest source (fs directory, Lokalise, any TMS with a bundle-export API, …); `buildCatalogs` doesn't care which one it's talking to. `loadSource` applies the provider's own locale-key normalization. |
| `SourceConfig` (type) | `FilesSourceConfig \| ExportApiSourceConfig` | Discriminated union of every source's config shape. |
| `normalizeLocaleKey(name, langMap?)` | `(name: string, langMap?: Record<string, string>) => string` | Default normalization: `langMap` override, else `"_"` → `"-"`. |
| `createFsSourceProvider(config)` | `(config: FilesSourceConfig) => LocaleSourceProvider` | The reference `"files"` provider. |
| `ExportApiProviderOptions`, `ExportApiSourceConfig` (types) | — | Generic TMS bundle-export source config, configured per-TMS via `exportApiPresets`. |
| `createExportApiSourceProvider(config)` | `(config: ExportApiSourceConfig) => LocaleSourceProvider` | |
| `ExportApiPreset` (type), `exportApiPresets` | — | Named per-vendor presets for the export-api provider. |
| `resolveProvider(source)` | `(source: string \| SourceConfig \| LocaleSourceProvider) => LocaleSourceProvider` | Resolves a plain directory path, a `SourceConfig`, or an already-built provider into a `LocaleSourceProvider`. |
| `FilenameStyle`, `WriteLocaleFilesOptions` (types), `writeLocaleFiles(...)` | — | Derives producer-shaped files (a compat export, a debug dump, …) FROM already-built catalogs; never the reverse. |

**`BuildOptions`:**

| Option | Type | Default | Notes |
|---|---|---|---|
| `app` | `string` | required | |
| `buildVersion` | `string` | required | |
| `outDir` | `string` | `"dist"` (relative to cwd) | |
| `deltaHistorySize` | `number` | `5` | How many past releases to keep precomputed delta files for. |

#### Errors

- `writeDelta`: throws `` writeDelta: incompatible {var} placeholder set for keys: <keys> — version-pin instead of shipping this delta to old builds `` when a changed key's placeholder set differs from the string it replaces.
- `buildCatalogs`: throws `` buildCatalogs: keys containing "." are not representable (flatten uses "." as the path separator) in <app>/<lang>: <keys> `` for any dotted object key; throws `` buildCatalogs: unsafe locale key "<lang>" escaped the provider contract `` if a provider somehow yields `__proto__`/`constructor`/`prototype` as a locale key; propagates `assertNoHtml`'s error for any dangerous catalog content.
- `resolveConfigEnv`: throws `` resolveConfigEnv: missing required env var "<name>" (referenced at <path>) `` for any unresolved `"${VAR}"` reference.
- `resolveProvider`: throws `` resolveProvider: unknown source type "<type>" `` for an unrecognized `SourceConfig.type`.

## "./ota"

Framework-agnostic runtime loading: fetch the OTA delta or catalog, verify it, merge it additively onto the baked catalog, cache it.

| Export | Signature | Notes |
|---|---|---|
| `loadMessages(options)` | `(options: LoadMessagesOptions) => Promise<Catalog>` | Fail-safe: any fetch, parse, or verification failure resolves to `bakedCatalog` — a bad OTA payload can only skip the update, never break the app. See the flow below. |
| `injectInto(catalog, setMessages)` | `(catalog: Catalog, setMessages: (catalog: Catalog) => void) => void` | Framework-agnostic injection helper: calls `setMessages` with a NEW object reference, for engines that gate re-renders on reference equality. |
| `clearLoadMessagesMemo()` | `() => void` | Clears the module-level merge memo. Test-only. |
| `KVStorage` (type) | `{ getItem(key): string \| null; setItem(key, value): void; removeItem?(key): void; key?(index): string \| null; readonly length?: number }` | Shaped like `localStorage`; `removeItem`/`key`/`length` are optional and only enable best-effort eviction of stale cache entries when present. |

**`LoadMessagesOptions`:**

| Option | Type | Default | Notes |
|---|---|---|---|
| `app` / `lang` / `buildVersion` | `string` | required | Cache/memo key components. |
| `bakedCatalog` | `Catalog` | required | |
| `bakedHash` | `string` | computed via `hashCatalog` | Pass the build-time constant to skip re-hashing on every poll — the recommended production setting. |
| `manifestUrl` | `string` | required | |
| `catalogUrl` | `(hash: string) => string` | required | |
| `deltaUrl` | `(fromHash: string, toHash: string) => string` | none | When set, tries the precomputed additive delta before the full-catalog fetch. |
| `fetchImpl` | `(url: string) => Promise<unknown>` | global `fetch` | |
| `storage` | `KVStorage` | real `localStorage`, else an in-memory map | |
| `onError` | `(error: unknown) => void` | none | Fired on a content-hash mismatch or any swallowed failure — "alert, not silent." |

**Fail-to-baked flow:** manifest fetch → in-memory memo hit (same object reference, no storage/catalog read) → `localStorage` cache hit for the current remote hash → remote hash equals the baked hash (no fetch) → delta-first path (verified against `additiveHash`; any failure or hash mismatch falls through silently to the next step) → full catalog fetch, content-hash-verified against the manifest, merged additively (`allowRemove:false`) onto baked. The merged catalog is deliberately not required to hash back to the remote hash — a release that removed keys makes that unsatisfiable by the no-remove merge, and requiring it would permanently brick OTA for such releases.

#### Errors

`loadMessages` never throws; every failure path calls `onError` (if given) and resolves to `bakedCatalog`.

## "./vue"

Vue integration: patches OTA deltas into either the in-house `vue-composable` i18n store or official `vue-i18n`.

| Export | Signature | Notes |
|---|---|---|
| `applyOtaForLocale(store, options)` | `(store: VueI18nStoreLike, options: ApplyOtaOptions) => Promise<void>` | Fetches the OTA delta for one locale and merges it into a `vue-composable` store's messages via `setI18n` (a full `i18n` definition swap, so the `shallowRef` identity changes and `$t` re-renders). Leaves the store untouched when the locale's messages are still a lazy loader, when OTA reports no change, or on any failure. Never throws. |
| `VueI18nStoreLike` (type) | `{ i18n: VueComposableI18nDefinition; setI18n(def): void }` | |
| `VueComposableI18nDefinition` (type) | `{ locale: string; fallback?: string; messages: Record<string, unknown> }` | |
| `ApplyOtaOptions` (type) | `Omit<LoadMessagesOptions, "bakedCatalog" \| "lang"> & { locale: string }` | |
| `applyOtaVueI18n(global, options)` | `(global: VueI18nGlobalLike, options: ApplyOtaOptions) => Promise<void>` | Official `vue-i18n` variant: merges onto `i18n.global` via `setLocaleMessage` (reactive on its own, no ref-swap needed). Leaves the instance untouched when the locale isn't loaded yet, OTA reports no change, or on any failure. Never throws. |
| `VueI18nGlobalLike` (type) | `{ getLocaleMessage(locale): Record<string, unknown>; setLocaleMessage(locale, messages): void }` | |
| `createVueComposableOtaClient(getInstance, options)` | `(getInstance: () => VueComposableI18nInstance \| null \| undefined, options: VueComposableOtaClientOptions) => VueComposableOtaClient` | Full per-locale `apply()` client for a `vue-composable` i18n RESULT instance: resolves the true baked catalog via `bakedCatalogFor`, runs `loadMessages`, applies an optional `transform`, and injects. Monotonic generation counter: a stale `apply()` resolving late never injects over a newer one. |
| `VueComposableI18nInstance` (type) | `{ locale: string; fallback?: string; i18n: Record<string, unknown>; addLocale(locale, messages): void }` | |
| `VueComposableOtaClientOptions` (type) | see below | |
| `VueComposableOtaClient` (type) | `{ apply(locale: string): Promise<void> }` | |

**`VueComposableOtaClientOptions`:**

| Option | Type | Default | Notes |
|---|---|---|---|
| `app` / `buildVersion` / `manifestUrl` | `string` | required | |
| `catalogUrl` | `(locale, hash) => string` | required | |
| `deltaUrl` | `(locale, fromHash, toHash) => string` | none | |
| `bakedCatalogFor` | `(locale: string) => Promise<Catalog> \| Catalog` | required | Must resolve the TRUE baked catalog, never read off the instance's rendered tree (mid-switch that tree is still the previous locale's content). |
| `transform` | `(catalog: Catalog, locale: string) => Catalog` | none | Optional rewrite of the merged catalog before injection (e.g. placeholder normalization). |
| `fetchImpl` / `storage` | `LoadMessagesOptions["fetchImpl"]` / `["storage"]` | same as `loadMessages` | |
| `onError` | `(error: unknown) => void` | none | Passed through to `loadMessages`, also fired on any failure in `apply` itself. |

> **Important:** when the active locale equals the i18n definition's `fallback` locale, `createVueComposableOtaClient`'s `apply()` mutates the captured fallback tree in place (`replaceCatalogInPlace`) instead of calling `addLocale`. This works around a `vue-composable@1.0.0-beta.24` quirk where the fallback ref is populated once and never re-read by `addLocale`; see the function's doc comment in `packages/locale/src/vue/index.ts` for the exact mechanism.

#### Errors

None of this subpath's exports throw; every failure is swallowed and reported only through the optional `onError` callback.

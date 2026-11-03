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
| `Catalog`, `Manifest`, `ManifestEntry`, `Delta` (types) | — | Shared shapes: `Catalog` is a nested `Record<string, string \| Catalog>`; `Manifest` is `{ v: 1; buildVersion: string; sequence?: number; issuedAt?: string; expiresAt?: string; apps: Record<string, Record<string, ManifestEntry>>; signature?: ManifestSignature }`; `Delta` is `{ changed: Record<string, string>; removed: string[] }`. |
| `TrustedKey` (type) | `{ kid: string; jwk: JsonWebKey } \| { kid: string; spki: string }` | A public ES256 key the app trusts to sign manifests: a public JWK, or a base64url SPKI. |
| `ManifestSignature` (type) | `{ alg: "ES256"; kid: string; sig: string }` | `sig` is the base64url raw r\|\|s signature over `manifestSigningInput(manifest)`. |
| `verifyManifestSignature(manifest, trusted)` | `(manifest: Manifest, trusted: readonly TrustedKey[]) => Promise<{ ok: true } \| { ok: false; reason: string }>` | Checks the signature against the trusted key with the manifest's `kid`. Never throws. Does not check expiry or sequence; `loadMessages` does. |
| `manifestSigningInput(manifest)` | `(manifest: Manifest) => Uint8Array` | The exact bytes signed: sorted-key JSON of every field except `signature`. |
| `resolve(catalog, key)` | `(catalog: Catalog, key: string) => { value: string } \| undefined` | Dot-path lookup, e.g. `"Namespace.KeyName"`. |
| `interpolate(template, args?)` | `(template: string, args?: Record<string, string \| number>) => string` | Flat single-brace `{var}` substitution only (no ICU plural/select, no `{{ }}`). A missing arg leaves the placeholder literal instead of throwing. |
| `t(catalog, key, args?, aliases?)` | `(catalog: Catalog, key: string, args?, aliases?: AliasResolver) => { value: string }` | `resolve` + `interpolate`; an unknown key returns `{ value: key }` instead of throwing. With an `aliases` resolver a renamed key reads from its target (falling back to the old key) and a decommissioned key renders as itself. |
| `AliasEntry`, `AliasMap` (types) | `{ to: string \| null; since: string; removeAfter?: string }`, `Record<string, AliasEntry>` | One `_aliases.json` entry, and the whole file. `to: null` decommissions the key. |
| `AliasResolverOptions`, `AliasResolver` (types) | `{ warn?: boolean; onDeprecatedKey?(oldKey, newKey) }`, `{ lookup(key): string \| null \| undefined }` | `lookup` returns `undefined` for an unaliased key, `null` for a decommissioned one, else the target. |
| `parseAliases(raw, label?)` | `(raw: unknown, label?: string) => AliasMap` | Validates the parsed JSON shape. |
| `validateAliases(aliases, catalogs, defaultLocale?)` | `(aliases: AliasMap, catalogs: Record<string, Catalog>, defaultLocale?: string) => string[]` | Cross-checks aliases against catalogs; returns problems (empty when valid). Default locale: explicit, else closest to `"en"` over sorted locales. |
| `applyAliasCopies(catalog, aliases)` | `(catalog: Catalog, aliases: AliasMap) => Catalog` | Returns a catalog with each old key added as a copy of its target string. Decommissioned aliases add nothing. |
| `createAliasResolver(aliases, options?)` | `(aliases: AliasMap, options?: AliasResolverOptions) => AliasResolver` | Warns once per old key outside production (`warn` overrides); `onDeprecatedKey` fires once per old key in every mode and its errors are swallowed. |
| `createVueI18nMissingHandler(i18n, resolver)` | `(i18n: VueI18nMessagesLike, resolver: AliasResolver) => VueI18nMissingHandler` | A vue-i18n `missing` handler that resolves aliased keys. Structural types, no vue-i18n import. |
| `createI18nextParseMissingKeyHandler(translate, resolver)` | `(translate: (key, options?) => string, resolver: AliasResolver) => I18nextParseMissingKeyHandler` | An i18next `parseMissingKeyHandler` that resolves aliased keys. Structural types, no i18next import. |
| `VueI18nMessagesLike`, `VueI18nMissingHandler`, `I18nextParseMissingKeyHandler` (types) | — | The structural shapes the two adapters take and return. |
| `getClosestLocale(supported, requested, overrides?)` | `(supported: string[], requested: string, overrides?: Record<string, string>) => string` | Fallback order: exact match → `overrides` remap → `en-US`/`en-GB` kept distinct (never collapsed to a single `"en"`) → language-only match → `supported[0]` as the last resort. |
| `canonicalize(catalog)` | `(catalog: Catalog) => string` | Deterministic serialization (NFC-normalized strings, `\r\n`/`\r` folded to `\n`, keys sorted, unsafe keys dropped) shared by every hash producer/consumer. |
| `hashCatalog(catalog)` | `(catalog: Catalog) => Promise<string>` | Full untruncated sha256 hex of the canonical form, via `crypto.subtle` (WebCrypto, so it runs identically in Node ≥18, browsers and Bun). |
| `diff(from, to)` | `(from: Catalog, to: Catalog) => Delta` | Flat dot-path diff between two catalogs. |
| `merge(baked, delta, opts?)` | `(baked: Catalog, delta: Delta, opts?: { allowRemove?: boolean }) => Catalog` | Applies a delta onto a baked catalog, returning a new object. `removed` keys are only deleted when `opts.allowRemove` is `true` (default `false`) — a delta landing on an old build must never remove keys it still calls. |
| `isPlaceholderCompatible(fromVal, toVal)` | `(fromVal: string, toVal: string) => boolean` | True when two strings use exactly the same `{var}` set; gates whether a changed string may ship as a delta to older builds. |
| `assertNoHtml(catalog, opts?)` | `(catalog: Catalog, opts?: { label?: string }) => void` | Throws if any leaf string contains a dangerous tag, inline event handler, or `javascript:` URI (including numeric-entity-encoded and whitespace-obfuscated variants). Denylist, not a tag allowlist, so benign formatting (`<a href>`, `<b>`, `<h3>`, `<ul><li>`) keeps working without a codebase change. |

#### Errors

- `parseAliases`: throws `` <label>: <problem>[; <problem>...] `` for a non-object file, an invalid key path, an unknown field, a bad `to`, `since` or `removeAfter`, a self-alias, or a chain. `createAliasResolver` throws the same way.
- `getClosestLocale`: throws `` getClosestLocale: supported must be non-empty `` when `supported` is an empty array.
- `assertNoHtml`: throws `` assertNoHtml: dangerous content found[ in <label>] at: <dot-path>[, <dot-path>...] `` listing every offending leaf.

> **Security:** `UNSAFE_KEYS` (`__proto__`, `constructor`, `prototype`) is dropped everywhere a catalog key or dot-path segment is read or written — `flatten`, `setPath`, `deletePath`, and `canonicalize` all skip these, since a remote catalog is attacker-adjacent input (CDN compromise, MITM on a misconfigured origin) and assigning one of those keys would otherwise walk the prototype setter and pollute every object in the realm.

## "./build"

The CI-side build: ingest, publish gates, and content-addressed output.

| Export | Signature | Notes |
|---|---|---|
| `buildCatalogs(source, options)` | `(source: string \| SourceConfig \| LocaleSourceProvider, options: BuildOptions) => Promise<BuildResult>` | Reads every locale from `source`, runs the publish gates (no dotted keys, `assertNoHtml`) on each, hashes via `hashCatalog`, and writes `<outDir>/catalog/<app>/<lang>/<hash>.json` (exact canonical bytes, so a published file re-hashes to its own filename) plus `<outDir>/manifest/<app>.json`. Also precomputes `<outDir>/delta/<app>/<lang>/<fromHash>-<toHash>.json` for every still-on-disk release in the last `deltaHistorySize` builds, tracked via a rolling `<outDir>/manifest/<app>.history.json`. A history entry whose catalog file was since pruned is skipped (that release falls back to a full-catalog fetch); if history exists and every prior catalog is missing, that's warned rather than silently emitting zero deltas. |
| `writeDelta(fromCatalog, toCatalog, destPath?)` | `(fromCatalog: Catalog, toCatalog: Catalog, destPath?: string) => Promise<PublishedDelta>` | Computes the flat delta via `diff`, gates it on `isPlaceholderCompatible` per changed key, stamps it with `additiveHash` (the hash of `merge(from, delta, {allowRemove:false})`), and optionally writes it to `destPath`. |
| `BuildOptions` (type) | `{ app: string; buildVersion: string; outDir?: string; deltaHistorySize?: number; signingKey?: SigningKey; expiresInDays?: number; aliases?: AliasMap; defaultLocale?: string }` | See table below. |
| `ALIASES_FILE` | `"_aliases.json"` | The file name the CLI and the `files` provider agree on; the provider never reads it as a locale. |
| `readAliasesFile(path)` | `(path: string) => AliasMap \| undefined` | Parsed alias file, or `undefined` when none exists at `path`. Throws on invalid JSON or a malformed entry. |
| `BuildResult` (type) | `{ manifest: Manifest; manifestPath: string; catalogPaths: Record<string, string>; deltaPaths: string[] }` | |
| `PublishedDelta` (type) | `Delta & { additiveHash: string }` | The on-disk delta file shape. |
| `BuildConfig` (type) | `{ app: string; source: SourceConfig; defaultLocale?: string; publicKeys?: TrustedKey[] }` | The committed build-config file shape; carries `"${VAR}"` placeholders, no secret values. |
| `resolveConfigEnv(config, env?)` | `(config: T, env?: Record<string, string \| undefined>) => T` | Recursively interpolates `"${VAR}"` placeholders in every string leaf against `env` (default `process.env`). |
| `readPublicKeys(configPath)` | `(configPath: string) => TrustedKey[]` | Reads and validates the `publicKeys` of a committed build config, for embedding in the app at build time (bundler `define`) and passing to `loadMessages`. Throws on a missing file, bad JSON or an invalid key. |
| `generateSigningKey()` | `() => Promise<{ kid: string; publicJwk: JsonWebKey; secret: string }>` | New ES256 (ECDSA P-256) key pair. `secret` is the value for the `TYPREN_SIGNING_KEY` env var; `kid` is the RFC 7638 thumbprint of the public key. |
| `parseSigningKey(secret)` | `(secret: string) => SigningKey` | Decodes a `TYPREN_SIGNING_KEY` value. Throws an error naming the problem, never echoing the input. |
| `signManifest(manifest, key)` | `(manifest: Manifest, key: SigningKey) => Promise<Manifest>` | Returns the manifest with a `signature` (`{ alg: "ES256", kid, sig }`) over every other field. |
| `SIGNING_KEY_ENV`, `SigningKey` | `"TYPREN_SIGNING_KEY"`, `{ kid: string; privateJwk: JsonWebKey }` | |
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
| `signingKey` | `SigningKey` | none | Signs the manifest (ES256). Without it the manifest is unsigned and a warning is printed; devices reject it unless `insecureDevMode` applies. Use `parseSigningKey(process.env.TYPREN_SIGNING_KEY)`. |
| `expiresInDays` | `number` | `30` | Manifest lifetime. Every bake stamps `sequence` (monotonic per app), `issuedAt` and `expiresAt`. Must be positive. |
| `aliases` | `AliasMap` | none | Validated, then every old key is added to every locale catalog as a copy of its target, before the gates and hashing. |
| `defaultLocale` | `string` | closest to `"en"` over sorted locales | The catalog alias targets are checked against. |

#### Errors

- `writeDelta`: throws `` writeDelta: incompatible {var} placeholder set for keys: <keys> — version-pin instead of shipping this delta to old builds `` when a changed key's placeholder set differs from the string it replaces.
- `buildCatalogs`: throws `` buildCatalogs: keys containing "." are not representable (flatten uses "." as the path separator) in <app>/<lang>: <keys> `` for any dotted object key; throws `` buildCatalogs: unsafe locale key "<lang>" escaped the provider contract `` if a provider somehow yields `__proto__`/`constructor`/`prototype` as a locale key; propagates `assertNoHtml`'s error for any dangerous catalog content.
- `buildCatalogs`: with `aliases`, throws `` buildCatalogs: invalid aliases for <app>: <problem>[; <problem>...] `` when `validateAliases` reports anything (old key still present, target missing from the default locale, leaf collision, no catalogs).
- `resolveConfigEnv`: throws `` resolveConfigEnv: missing required env var "<name>" (referenced at <path>) `` for any unresolved `"${VAR}"` reference.
- `resolveProvider`: throws `` resolveProvider: unknown source type "<type>" `` for an unrecognized `SourceConfig.type`.

## "./ota"

Framework-agnostic runtime loading: fetch the OTA delta or catalog, verify it, merge it additively onto the baked catalog, cache it.

| Export | Signature | Notes |
|---|---|---|
| `loadMessages(options)` | `(options: LoadMessagesOptions) => Promise<Catalog>` | Fail-safe: any fetch, parse, or verification failure resolves to `bakedCatalog` — a bad OTA payload can only skip the update, never break the app. See the flow below. |
| `TrustedKey` (type) | `{ kid: string; jwk: JsonWebKey } \| { kid: string; spki: string }` | Re-exported from the main entry; see there. |
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
| `publicKeys` | `readonly TrustedKey[]` | required | Keys trusted to sign the manifest, embedded in the app at build time (see `readPublicKeys`). An unsigned, untrusted-signer, expired or replayed (lower `sequence`) manifest resolves to baked. |
| `insecureDevMode` | `boolean` | `false` | Accept unsigned manifests and skip the expiry and sequence checks. Honored only on `localhost` / `127.0.0.1`; elsewhere ignored and reported. Hybrid shells can serve production from localhost, so gate it on a dev-build flag. |
| `onError` | `(error: unknown) => void` | none | Fired on a content-hash mismatch or any swallowed failure — "alert, not silent." Messages beginning `ota manifest rejected for` mean the manifest failed signature, expiry or sequence checks; `ota placeholder gate dropped` lists keys whose OTA value had a different `{var}` set than the baked string (baked value kept). |

**Fail-to-baked flow:** manifest fetch → signature, expiry and sequence check (skipped only by `insecureDevMode` on localhost) → in-memory memo hit (same object reference, no storage/catalog read) → `localStorage` cache hit for the current remote hash → remote hash equals the baked hash (no fetch) → delta-first path (verified against `additiveHash`; any failure or hash mismatch falls through silently to the next step) → full catalog fetch, content-hash-verified against the manifest, merged additively (`allowRemove:false`) onto baked. The merged catalog is deliberately not required to hash back to the remote hash — a release that removed keys makes that unsatisfiable by the no-remove merge, and requiring it would permanently brick OTA for such releases.

#### Errors

`loadMessages` never throws; every failure path calls `onError` (if given) and resolves to `bakedCatalog`.

## "./vue"

Vue integration: patches OTA deltas into either the in-house `vue-composable` i18n store or official `vue-i18n`.

| Export | Signature | Notes |
|---|---|---|
| `applyOtaForLocale(store, options)` | `(store: VueI18nStoreLike, options: ApplyOtaOptions) => Promise<void>` | Fetches the OTA delta for one locale and merges it into a `vue-composable` store's messages via `setI18n` (a full `i18n` definition swap, so the `shallowRef` identity changes and `$t` re-renders). Leaves the store untouched when the locale's messages are still a lazy loader, when OTA reports no change, or on any failure. Never throws. |
| `VueI18nStoreLike` (type) | `{ i18n: VueComposableI18nDefinition; setI18n(def): void }` | |
| `VueComposableI18nDefinition` (type) | `{ locale: string; fallback?: string; messages: Record<string, unknown> }` | |
| `ApplyOtaOptions` (type) | `Omit<LoadMessagesOptions, "bakedCatalog" \| "lang"> & { locale: string }` | Includes the required `publicKeys`. |
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
| `publicKeys` | `readonly TrustedKey[]` | required | Same as `loadMessages`. |
| `insecureDevMode` | `boolean` | `false` | Same as `loadMessages`. |
| `fetchImpl` / `storage` | `LoadMessagesOptions["fetchImpl"]` / `["storage"]` | same as `loadMessages` | |
| `onError` | `(error: unknown) => void` | none | Passed through to `loadMessages`, also fired on any failure in `apply` itself. |

> **Important:** when the active locale equals the i18n definition's `fallback` locale, `createVueComposableOtaClient`'s `apply()` mutates the captured fallback tree in place (`replaceCatalogInPlace`) instead of calling `addLocale`. This works around a `vue-composable@1.0.0-beta.24` quirk where the fallback ref is populated once and never re-read by `addLocale`; see the function's doc comment in `packages/locale/src/vue/index.ts` for the exact mechanism.

#### Errors

None of this subpath's exports throw; every failure is swallowed and reported only through the optional `onError` callback.

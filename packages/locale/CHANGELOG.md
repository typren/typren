# @typren/locale

## 0.4.0

### Minor Changes

- e40741c: Gradual key rename and decommission. An `_aliases.json` next to the catalogs maps old keys to their replacement (or `null` to decommission). `t()` takes an optional alias resolver that falls back to the target key and warns once per old key outside production (`onDeprecatedKey` hook for production telemetry), with structural adapters for vue-i18n's `missing` handler and i18next's `parseMissingKeyHandler`. `bake` serves aliased old keys as copies of their targets so installed builds keep resolving them over OTA, `pull --emit-aliases` writes the same copies for libraries without a hook, and the files provider ignores `_aliases.json`. New CLI verbs `rename`, `deprecate` and `prune-aliases` (with `--json`; exit 0 ok, 1 refused, 2 usage or failure). `scan` reports alias old keys still referenced in source as `deprecated` (a warning, or an error once `removeAfter` has passed), and the alias verbs report failures in the same `--json` shape as the other verbs.
- 8ca228f: `typren-locale` gains three verbs for catalogue hygiene: `scan` finds keys the source never references (presets for vue-i18n, i18next, react-intl and typren), `check` reports missing, empty and extra values per locale, and `lint` validates message syntax and placeholders for ICU, vue-i18n, i18next or typren, with `--to typren` as a migration-readiness gate. Every verb now accepts `--json`, and the build config takes an optional `defaultLocale`.
  
  Breaking: usage errors and pull, bake and compat failures now exit 2 instead of 1, and unknown flags are rejected on pull, bake, diff and doctor (compat still accepts them).
- e701300: Signed OTA manifests (breaking). `bake` signs the manifest with ECDSA P-256 when `TYPREN_SIGNING_KEY` is set. The signature covers buildVersion, a monotonic sequence, issuedAt, expiresAt and every catalog and delta hash. With `CI=true` and no key, bake exits 2. `loadMessages` now requires `publicKeys`. An unsigned, untrusted, expired or replayed (lower sequence) manifest resolves to the baked catalog and is reported through `onError`. `insecureDevMode` is honored on localhost only. OTA values whose `{var}` placeholder set differs from the baked string are dropped on device. New `typren-locale keys init|rotate`, and a `readPublicKeys` helper in `@typren/locale/build`.
  
  Migration:
  
  1. Run `typren-locale keys init --config <config>` and commit the config.
  2. Store the printed value as the `TYPREN_SIGNING_KEY` CI secret.
  3. Pass `publicKeys: readPublicKeys(<config>)`, embedded at build time, to `loadMessages` and to `createVueComposableOtaClient` / `applyOtaForLocale` / `applyOtaVueI18n`.
  4. Direct `buildCatalogs` callers pass `signingKey: parseSigningKey(process.env.TYPREN_SIGNING_KEY)`.
  5. Rolling back by re-serving an old manifest no longer works; re-bake instead.

## 0.3.5

### Patch Changes

- ddc554b: Declare a Node.js `engines` floor of `^22.23.4 || ^24.22.1 || >=26.12.1`, the releases that fix the 2026-10-21 Node.js security advisory (Brotli decoder out-of-bounds write, TLS hostname check bypasses). Installing on an older Node now prints an engine warning; nothing fails unless the consumer enables `engine-strict`.

## 0.3.4

### Patch Changes

- c160884: `typren-locale` now honors `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`. Node's `fetch` ignores them by default, so the CLI re-executes itself with `NODE_USE_ENV_PROXY=1` when a proxy variable is set, which makes `compat lokalise2 file download` work behind a corporate proxy like the vendor binary does.

## 0.3.3

### Patch Changes

- cf2fdbc: Harden the export-api bundle fetch. Bundle download errors now log only the URL's origin and path, so a presigned-URL signature in the query string never reaches CI logs. Zip and JSON bundle downloads are read with a running 50 MB cap and a 60 s timeout, so a hostile bundle origin cannot exhaust memory or hang a pull.
- e62ca36: Admit Lokalise's current export bucket in the `lokalise` preset's `bundleOrigins`. Lokalise now serves async exports from a virtual-hosted S3 bucket, so every Lokalise pull was refused.
- 020b982: `export-api` skips a bundle locale that is not a BCP-47 tag (a TMS custom language such as Lokalise's `custom_1`) with a warning instead of failing the whole pull. Traversal-shaped names still throw.

## 0.3.2

### Patch Changes

- 8cc34e6: `createExportApiSourceProvider` now fetches the TMS bundle with `redirect: "manual"` and refuses any 3xx response, so a bundle host that redirects elsewhere can no longer bypass the `bundleOrigins` allowlist on a later hop.

## 0.3.1

### Patch Changes

- 9105be6: `buildCatalogs` now refuses `__proto__`, `constructor` and `prototype` as the `app` name before writing anything. That name keys the manifest's `apps` object, and the locale keys under it were already checked this way.

## 0.3.0

### Minor Changes

- 602b3bc: Harden the publish and OTA paths. Locale keys must be BCP-47-ish and every write stays inside its
  output directory. `assertNoHtml` is now a DOMPurify allowlist gate (a, b, i, strong, em, ul, ol, li,
  p, br, h3, span, code; href and title; http(s), mailto or relative URLs) that fails on anything it
  would remove; Node callers pass `createNodePurifier()` from `@typren/locale/build`. The manifest now
  carries `deltas` (prior hash -> expected additive hash) and the OTA client verifies deltas and cached
  entries only against manifest hashes, re-runs the HTML gate at load (an offending string keeps its
  baked value), and accepts a `purifier` option for SSR. The `export-api` source requires the bundle URL
  to share the create endpoint's origin or match the new `bundleOrigins` (https exact origin, origin plus
  path prefix, or `https://*.suffix`; the `lokalise` and `crowdin` presets ship theirs), and caps zip
  bundles at 50 MB inflated and 1000 entries.
  
  Upgrading: rebake so the manifest gains `deltas` (until then the client skips deltas and fetches full
  catalogs); a custom `export-api` source whose TMS serves bundles from another host adds that host to
  `bundleOrigins`; strings using markup outside the allowlist (for example `target` or `class`
  attributes) now fail the bake.

### Patch Changes

- 3e432fe: Dependency updates: next 16.4.0, dompurify 3.4.17, js-yaml 5.4.3, jsdom 30.1.2 and dev tooling (vitest, eslint,
  typescript-eslint, @types/node, @vitejs/plugin-react, lucide-react).

## 0.2.1

### Patch Changes

- 91b93d8: Fix `pull`, `bake` and `doctor` rejecting every export-api config that references its token as `${VAR}`: the config loader no longer interpolates `source.token` before the provider's literal-token check.

## 0.2.0

### Minor Changes

- 5da81c0: vue-composable instance OTA client: correct fallback-locale refresh, locale-true baked catalogs, transform hook, in-flight guard; loadMessages bakedHash now optional and internally guarded.

## 0.1.1

### Patch Changes

- a7ba283: Two fixes surfaced by the first real consumer integration. The Lokalise preset's `poll.idPath` now reads `process_id` from the top level of the create response (verified against the live API: the `process` wrapper exists only on the poll response, not the create response — the preset had conflated the two shapes and every real export failed to start). And `compat lokalise2` now bridges the literal token it legitimately reads from a vendor `config.yml` through a compat-owned environment variable (`TYPREN_LOCALE_COMPAT_TOKEN`) instead of placing the literal in the provider config, which the provider's secrets policy rejects by design; the secret still never touches disk or logs.

## 0.1.0

### Minor Changes

- 4a519e8: New package: localization delivery for typren and any web app. Baked catalogs at build plus an OTA delta channel over static files: content-addressed sha256 catalogs, no-remove merge, placeholder-compat and no-HTML publish gates, a provider port with `files` and generic `export-api` sources (Lokalise and Crowdin presets), a fail-to-baked runtime client with delta-first fetching, Vue injectors, and a `typren-locale` CLI (`pull`, `bake`, `diff`, `doctor`, `compat lokalise2`). Tokens travel only as `${VAR}` environment references.

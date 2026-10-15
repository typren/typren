# @typren/locale

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

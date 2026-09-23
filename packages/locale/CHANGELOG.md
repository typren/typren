# @typren/locale

## 0.2.0

### Minor Changes

- 5da81c0: vue-composable instance OTA client: correct fallback-locale refresh, locale-true baked catalogs, transform hook, in-flight guard; loadMessages bakedHash now optional and internally guarded.

## 0.1.1

### Patch Changes

- a7ba283: Two fixes surfaced by the first real consumer integration. The Lokalise preset's `poll.idPath` now reads `process_id` from the top level of the create response (verified against the live API: the `process` wrapper exists only on the poll response, not the create response — the preset had conflated the two shapes and every real export failed to start). And `compat lokalise2` now bridges the literal token it legitimately reads from a vendor `config.yml` through a compat-owned environment variable (`TYPREN_LOCALE_COMPAT_TOKEN`) instead of placing the literal in the provider config, which the provider's secrets policy rejects by design; the secret still never touches disk or logs.

## 0.1.0

### Minor Changes

- 4a519e8: New package: localization delivery for typren and any web app. Baked catalogs at build plus an OTA delta channel over static files: content-addressed sha256 catalogs, no-remove merge, placeholder-compat and no-HTML publish gates, a provider port with `files` and generic `export-api` sources (Lokalise and Crowdin presets), a fail-to-baked runtime client with delta-first fetching, Vue injectors, and a `typren-locale` CLI (`pull`, `bake`, `diff`, `doctor`, `compat lokalise2`). Tokens travel only as `${VAR}` environment references.

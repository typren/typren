# @typren/locale

## 0.1.0

### Minor Changes

- 4a519e8: New package: localization delivery for typren and any web app. Baked catalogs at build plus an OTA delta channel over static files: content-addressed sha256 catalogs, no-remove merge, placeholder-compat and no-HTML publish gates, a provider port with `files` and generic `export-api` sources (Lokalise and Crowdin presets), a fail-to-baked runtime client with delta-first fetching, Vue injectors, and a `typren-locale` CLI (`pull`, `bake`, `diff`, `doctor`, `compat lokalise2`). Tokens travel only as `${VAR}` environment references.

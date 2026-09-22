# @typren/locale

Git-native localization delivery: catalogs are baked into your app at build
time and updated over the air through content-addressed deltas — no
translation SaaS in the serving path.

- **Baked catalogs** — `buildCatalogs` writes immutable
  `catalog/<app>/<lang>/<sha256>.json` files (canonical bytes, so each file
  re-hashes to its own name) plus a per-app manifest.
- **OTA deltas** — `loadMessages` fetches the manifest, verifies the remote
  catalog against its content hash, and merges additively (a delta never
  removes keys an old build still renders). Fail-safe: any failure falls back
  to the baked catalog.
- **Publish gates** — dangerous HTML/URIs (`assertNoHtml`), dotted object
  keys, and `{var}` placeholder-set changes all fail the build, never the
  client.
- **Provider port** — implement `LocaleSourceProvider` once per source (a
  plain directory ships as the reference `files` provider).

## Install

```sh
npm install @typren/locale
```

## Quickstart

Build step (CI) — a directory of `<locale>.json` files in, CDN-ready output out:

```ts
import { buildCatalogs } from "@typren/locale/build";

await buildCatalogs("./locales", { app: "site", buildVersion: process.env.GIT_SHA!, outDir: "dist" });
```

Runtime (Vue) — patch live translations into `vue-i18n` after mount:

```ts
import { applyOtaVueI18n } from "@typren/locale/vue";

await applyOtaVueI18n(i18n.global, {
  app: "site",
  locale: "en-GB",
  buildVersion: BUILD_VERSION,
  manifestUrl: "https://cdn.example.com/manifest/site.json",
  catalogUrl: (hash) => `https://cdn.example.com/catalog/site/en-GB/${hash}.json`,
});
```

Framework-agnostic loading lives in `@typren/locale/ota` (`loadMessages`),
and the core primitives (`t`, `diff`, `merge`, `hashCatalog`, …) in
`@typren/locale`.

## License

Apache-2.0 — see [LICENSE](./LICENSE).

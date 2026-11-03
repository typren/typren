# @typren/locale

Git-native localization delivery: catalogs are baked into your app at build
time and updated over the air through content-addressed deltas — no
translation SaaS in the serving path.

## Install

```sh
npm install @typren/locale
```

## Quickstart

Build step (CI) — a directory of `<locale>.json` files in, CDN-ready output out:

```ts
import { buildCatalogs, parseSigningKey } from "@typren/locale/build";

await buildCatalogs("./locales", {
  app: "site",
  buildVersion: process.env.GIT_SHA!,
  outDir: "dist",
  signingKey: process.env.TYPREN_SIGNING_KEY ? parseSigningKey(process.env.TYPREN_SIGNING_KEY) : undefined,
});
```

Manifests are signed (ES256) and devices only accept ones signed by a key in `publicKeys`. Run `npx typren-locale keys init --config locale.config.json` once, store the printed value as the `TYPREN_SIGNING_KEY` CI secret, and pass `publicKeys: readPublicKeys("locale.config.json")` (from `@typren/locale/build`, embedded at build time) to `loadMessages`. Or run `typren-locale bake`, which does the signing for you.

See the [full reference](https://github.com/typren/typren/blob/develop/docs/site/reference-locale.md) for every export, build/OTA option and the Vue integration.

## License

Apache-2.0 — see [LICENSE](./LICENSE).

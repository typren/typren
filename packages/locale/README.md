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
import { buildCatalogs } from "@typren/locale/build";

await buildCatalogs("./locales", { app: "site", buildVersion: process.env.GIT_SHA!, outDir: "dist" });
```

## Renaming keys

Put an `_aliases.json` next to your catalogs (or use `typren-locale rename <old> <new>`) so installed builds keep resolving a renamed key until they update. `bake` serves each old key as a copy of its replacement, and `t()` accepts an alias resolver for the in-app fallback. See [Key migration](https://github.com/typren/typren/blob/develop/docs/locale.md#key-migration).

See the [full reference](https://github.com/typren/typren/blob/develop/docs/site/reference-locale.md) for every export, build/OTA option and the Vue integration.

## License

Apache-2.0 — see [LICENSE](./LICENSE).

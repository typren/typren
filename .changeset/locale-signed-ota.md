---
"@typren/locale": minor
---

Signed OTA manifests (breaking). `bake` signs the manifest with ECDSA P-256 when `TYPREN_SIGNING_KEY` is set. The signature covers buildVersion, a monotonic sequence, issuedAt, expiresAt and every catalog and delta hash. With `CI=true` and no key, bake exits 2. `loadMessages` now requires `publicKeys`. An unsigned, untrusted, expired or replayed (lower sequence) manifest resolves to the baked catalog and is reported through `onError`. `insecureDevMode` is honored on localhost only. OTA values whose `{var}` placeholder set differs from the baked string are dropped on device. New `typren-locale keys init|rotate`, and a `readPublicKeys` helper in `@typren/locale/build`.

Migration:

1. Run `typren-locale keys init --config <config>` and commit the config.
2. Store the printed value as the `TYPREN_SIGNING_KEY` CI secret.
3. Pass `publicKeys: readPublicKeys(<config>)`, embedded at build time, to `loadMessages` and to `createVueComposableOtaClient` / `applyOtaForLocale` / `applyOtaVueI18n`.
4. Direct `buildCatalogs` callers pass `signingKey: parseSigningKey(process.env.TYPREN_SIGNING_KEY)`.
5. Rolling back by re-serving an old manifest no longer works; re-bake instead.

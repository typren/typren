# Locale (`@typren/locale`) — architecture

Localization delivery for Typren, and for any web app that wants it standalone:
catalogs baked into the build, plus an over-the-air (OTA) delta channel served
from static files. No translation-management backend to run — a directory of
`<locale>.json` is a complete workflow on its own: edit the file, open a PR,
review the diff like code, merge, CI republishes, and the change is live in
seconds with no app redeploy.

## The model

Two artifacts, not one. A **catalog** is a full, content-addressed, immutable
snapshot of one `{app, lang}`'s strings — the filename *is* its sha256 hash of
the canonical serialized form, so a fetched catalog can be verified against
the hash that named it. A **manifest** is the one small mutable document:
`{ v, buildVersion, apps: { [app]: { [lang]: { hash } } } }`, published
alongside each release, pointing at whichever catalog hash is current. Every
producer and consumer of a hash — the build pipeline, the OTA client, any
future verify step — goes through the same canonicalizer, so hashes never
drift between what wrote them and what checks them.

The package owns hashing and output shape itself, regardless of where the
strings came from. A `LocaleSourceProvider` only has to hand back parsed
catalogs; canonicalization, hashing, file layout, and the publish gates below
are the same code path no matter which provider produced the input.

**Publish-time gates**, both enforced in the build pipeline before anything is
written to disk:

- **No-HTML denylist** (`assertNoHtml`) — rejects a catalog if any string
  contains a dangerous tag (`script`, `iframe`, `svg`, `style`, …), an inline
  event-handler attribute, or a `javascript:` URI, including numeric-entity
  and whitespace obfuscations of those. It's a denylist rather than a tag
  allowlist deliberately: catalog strings can reach a `v-html` /
  `dangerouslySetInnerHTML` sink downstream, so the blocked constructs would
  be stored XSS, but ordinary formatting like `<a href>` or `<b>` in real
  legal copy has to keep working without a codebase change every time.
- **Placeholder compatibility** (`isPlaceholderCompatible`) — a changed string
  may only ship as a delta to older builds if it uses exactly the same set of
  `{var}` placeholders as the string it replaces. A change that adds, drops,
  or renames a placeholder fails the build instead of shipping a delta;
  that string has to go out as a full version-pinned release instead.

**The no-remove rule**: an OTA delta is merged onto a baked catalog with
removals disabled by default — a delta can add and change keys on a running
build, but it never deletes one. Deletion only takes effect the next time an
app is actually rebuilt and baked. This isn't caution for its own sake: the
code already running in a user's browser still calls those keys by name, so
if OTA deleted one out from under it, the old build would render the raw dot-path
key instead of a string. The key only becomes safe to drop once the code that
referenced it is gone too, which is exactly what a rebuild guarantees.

## Runtime

The OTA client (`loadMessages`, in `./ota`) is fail-to-baked: any failure
anywhere in the flow — manifest fetch, catalog fetch, a hash that doesn't
match what the manifest claimed — resolves to the baked catalog the app
shipped with, never throws, and reports through an `onError` hook rather than
breaking the page. A bad or unreachable OTA payload degrades to "no update
this load," not an outage.

The flow per `{app, lang}`: fetch the manifest for the current remote hash;
check a `localStorage`-shaped cache keyed by `app:lang:buildVersion` for an
already-merged result at that hash; if the remote hash equals what's already
baked, return baked as-is with no catalog fetch at all; otherwise fetch the
full catalog at that hash, re-hash it and verify it matches (a content-address
check against the manifest's claimed hash — catches corruption and a
mismatched publish, not a cryptographic signature; manifest signing is a
possible follow-up, not something this package does today), merge it
additively onto baked, cache the result, and return it.
Keying the cache by `buildVersion` means a new deploy can never read a stale
entry left by a previous one — the key itself changes, so there's nothing to
invalidate by hand.

Four subpath entries, split by what each one needs to run in:

| Subpath | Contents |
|---|---|
| `@typren/locale` | catalog shape, lookup (`resolve`/`t`/`interpolate`), locale fallback (`getClosestLocale`), canonicalization/hashing, delta diff/merge, the publish gates |
| `@typren/locale/build` | the build pipeline (`buildCatalogs`, `writeDelta`), provider resolution, config env interpolation — Node-only |
| `@typren/locale/ota` | the runtime client (`loadMessages`) and a framework-agnostic `injectInto` helper — browser/edge-safe |
| `@typren/locale/vue` | injectors that merge an OTA result into a running Vue i18n store |

Vue is the only framework adapter today, in two flavors: one for the in-house
`vue-composable`-style store (replaces the whole `i18n` definition behind a
`shallowRef` so identity-gated reactivity picks it up), and one for official
`vue-i18n` (`setLocaleMessage`, which is reactive on its own). Both are
additive and fail-safe the same way the client underneath them is — a locale
whose messages aren't loaded yet, or an OTA call that reports no change, just
leaves the store untouched. i18next and React adapters are planned, same
shape, not built yet.

## Provider port

Ingest is a port, not a hardcoded reader: `LocaleSourceProvider` is the whole
contract, with two deliberately separate methods. `loadSource()` returns
parsed catalogs keyed by *internal* locale key, with that provider's
locale-key normalization applied (the default is `en_US` → `en-US`,
overridable per key) — this is what the build pipeline actually reads.
`loadRawEntries()` returns exact, unparsed bytes keyed by the producer's
*original* filename, untouched by normalization — a byte-identical drop-in
path for re-emitting a producer's export as-is, not for building catalogs
from. The package never blends the two: nothing in the catalog pipeline
mirrors a vendor's export byte-for-byte, every catalog that gets hashed and
published has gone through normalization to canonical locale keys first.

Only one provider ships today: `files`, a directory of one `<locale>.json`
per locale — which is also the entire Git-native workflow described above. A
generic export-API provider, plus config presets for wiring up common
translation-management platforms (Lokalise among them), are planned follow-up
work; each new source is a config shape added to the `SourceConfig` union and
a case in provider resolution, additive to what's here.

## Hosting

Build output is nothing but static files — `dist/catalog/<app>/<lang>/<hash>.json`,
`dist/delta/<app>/<lang>/<fromHash>-<toHash>.json`, `dist/manifest/<app>.json`
— so any static host or CDN in front of object storage works; there's no
server component to run. Cache the two kinds of output differently: catalogs
and deltas are content-addressed and immutable, so cache them forever; the
manifest is the one file that changes per release, so give it a short TTL (or
no cache) so clients notice a new build promptly.

Rollback is repointing the manifest at a previous release's hashes — the
catalog files those hashes name are still sitting in storage, untouched,
since a hash never gets reused for different content. No data migration, no
republish of catalogs, just the one small mutable file.

## License

`@typren/locale` is licensed Apache-2.0, on its own, inside a monorepo whose
root and several sibling packages (`@typren/core`, `@typren/editor`) are under
the Functional Source License instead. Check `packages/locale/LICENSE`
against the repo root's before assuming one license covers everything here.

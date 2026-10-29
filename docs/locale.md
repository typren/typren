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
`{ v, buildVersion, apps: { [app]: { [lang]: { hash, deltas? } } } }`, published
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

- **HTML allowlist** (`assertNoHtml`) — catalog strings can reach a `v-html` /
  `dangerouslySetInnerHTML` sink downstream, so the gate runs every string
  through DOMPurify with a fixed allowlist: the tags `a b i strong em ul ol li
  p br h3 span code`, the attributes `href` and `title`, and only `http(s):`,
  `mailto:` or relative URLs. It is a gate, not a sanitizer: if sanitizing
  would remove anything (a tag, an attribute, a URL), the build fails and names
  the offending dot-paths, rather than shipping a silently altered string.
  `{var}` placeholders are plain text and pass. An earlier tag/handler
  denylist was replaced because every such list was bypassed by a handler or
  URI spelling it didn't name. In Node the gate needs a DOM: the build and the
  CLI pass `createNodePurifier()` (jsdom, from `@typren/locale/build`);
  without any DOM `assertNoHtml` throws instead of passing everything.
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
if it equals what's already baked, return baked as-is with no catalog fetch at
all. Otherwise, every hash the client trusts comes from that freshly fetched
manifest, never from the payload or storage being checked:

- A `localStorage`-shaped cache keyed by `app:lang:buildVersion` holds the
  last *verified* content. A cached entry is used only if its hash is one the
  manifest names and the stored catalog re-hashes to it; a tampered or stale
  entry is a cache miss.
- With `deltaUrl` set, the precomputed delta is tried only when the
  manifest's `deltas` map lists the expected additive-merge hash for this
  baked build (`deltas[bakedHash]`); the merge must hash to exactly that. The
  delta file's own `additiveHash` is informational and never trusted.
- Otherwise the full catalog at the remote hash is fetched and must re-hash
  to it.

These are content-address checks against the manifest: they catch corruption,
a swapped delta or catalog file, and a tampered cache, but not a compromised
manifest, since there is no cryptographic signature (manifest signing is a
possible follow-up, not something this package does today). As a second
line, the HTML allowlist gate re-runs at load on every string the update
changes: a string that fails keeps its baked value and is reported through
`onError`, while the rest of the update still applies. In the browser the
gate uses the page's `window`; SSR in Node passes `purifier:
createNodePurifier()`, or the client cannot run the gate and resolves to baked.
The verified content is merged additively onto baked, cached, and returned.
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

Vue is the only framework adapter today, in three flavors: one for the
in-house `vue-composable`-style store (replaces the whole `i18n` definition
behind a `shallowRef` so identity-gated reactivity picks it up), one for
official `vue-i18n` (`setLocaleMessage`, which is reactive on its own), and
one for a `vue-composable` RESULT instance (below). All are additive and
fail-safe the same way the client underneath them is — a locale whose
messages aren't loaded yet, or an OTA call that reports no change, just
leaves the store untouched. i18next and React adapters are planned, same
shape, not built yet.

### The vue-composable instance path

`createVueComposableOtaClient(getInstance, options)` is for apps whose store
exposes the object `useI18n`/`buildI18n` *returns* (active `locale`, the
`fallback` locale name, the resolved `i18n` tree, `addLocale`) rather than
the definition. The factory owns per-locale application; call
`apply(locale)` once at boot and again on every locale change:

- The baked catalog always comes from `options.bakedCatalogFor(locale)`,
  never from the instance's rendered tree: mid-switch that tree is still the
  previous locale's content, and merging onto it would poison both the merge
  and the localStorage cache entry.
- An optional `transform(catalog, locale)` rewrites the merged result before
  injection, for consumers whose build pipeline normalizes baked catalogs
  (say `{{var}}` to `{var}` placeholder rewrites) and needs OTA content to
  match.
- Injection is `addLocale`, except for the fallback locale, where
  vue-composable's resolver keeps re-serving a `fallback` ref populated once
  from the definition, making `addLocale` a silent rendering no-op. The
  client captures the object behind that frozen ref whenever the instance is
  observed serving its fallback locale and applies fallback updates by deep
  in-place mutation of it, falling back to `addLocale` until the tree is
  capturable.
- A monotonic generation guards injection: a stale `apply` resolving after a
  newer one never injects. `loadMessages`' own cache write happens before
  that guard, but it is keyed by `{app, lang, buildVersion}` and built from
  `bakedCatalogFor`'s locale-correct catalog, so a stale apply can never
  contaminate another locale's cache.

`loadMessages` itself now also accepts an omitted `bakedHash`: the hash is
computed internally, inside the same fail-to-baked guard, so an environment
without `crypto.subtle` (an insecure origin) degrades to baked via `onError`
instead of throwing. Passing the build-time constant is still the
recommended production setting, since it skips re-hashing the baked catalog
on every poll.

## Provider port

Ingest is a port, not a hardcoded reader: `LocaleSourceProvider` is one
method. `loadSource()` returns parsed catalogs keyed by the *canonical*
locale (BCP-47, `-`-separated; the default normalization is `en_US` →
`en-US`, overridable per key via `langMap`). A key, `langMap` result
included, must look like a BCP-47 tag (`^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$`)
or the load fails naming it, because the key becomes a path segment on disk.
The one exception is a TMS bundle (`export-api`): a locale there that is simply
not a BCP-47 tag, such as a TMS custom language exported as `custom_1`, is
skipped with a warning instead (map it with `langMap` to keep it), while a name
containing `.`, `/` or `\` still fails the load;
every catalog, manifest, delta and locale-file write additionally refuses a
path that resolves outside its output directory. The package owns its output
shape the same way it owns hashing: nothing mirrors a vendor's export
byte-for-byte, and on-disk locale files are always *derived from* catalogs
(`writeLocaleFiles`, with a `filenameStyle` knob for consumers whose builds
expect `en_US.json` naming).

Two providers ship today:

- `files` — a directory of one `<locale>.json` per locale, which is also the
  entire Git-native workflow described above.
- `export-api` — the generic TMS bundle-export shape: create an export job,
  optionally poll it, fetch the bundle (zip of per-locale files, or one JSON
  document keyed by locale). Everything about it is config: auth header, the
  create request, poll dot-paths, where the bundle URL lives, how a zip entry
  maps to a locale. Config *presets* ship as data for platforms whose APIs
  fit the shape — `lokalise` and `crowdin` today — so wiring one up is
  `{ type: "export-api", preset: "lokalise", projectId, token: "${ENV_VAR}" }`.
  Tokens are always environment references; a literal-looking token is
  rejected at load time. The bundle URL comes from the TMS response, so it
  must share the create endpoint's origin or match a `bundleOrigins` entry
  (https only): an exact origin, an origin plus a path prefix ending in `/`
  (for shared storage hosts), or a `https://*.suffix` host suffix. The presets
  ship theirs: `lokalise` admits its own bucket on path-style S3
  (`https://s3-eu-west-1.amazonaws.com/lokalise-assets/`, not every bucket on
  that host) and the whole host of its virtual-hosted export bucket
  (`https://lokalise-live-lok-s3-fss-export.s3.eu-central-1.amazonaws.com/`,
  which belongs to that one bucket), and `crowdin` admits `https://*.downloads.crowdin.com`. Bundle
  downloads (zip or JSON) are capped at 50 MB on the wire and time out after 60 s; zip
  bundles are also capped at 50 MB inflated and 1000 entries.

A platform whose protocol genuinely diverges from create/poll/fetch gets its
own provider only when demand shows up; each new source is a config shape
added to the `SourceConfig` union and a case in provider resolution, additive
to what's here.

## CLI

The package ships a `typren-locale` bin with four verbs and a compat layer:

- `pull --config <path> [--out <dir>] [--filename-style dash|underscore]` —
  provider → normalized locale files on disk.
- `bake --config <path> --out <dir>` — `buildCatalogs`: hashed catalogs,
  manifest, precomputed deltas, publish gates.
- `diff <dirA> <dirB>` — per-locale *content* comparison (exit 1 on any
  difference). Filename and formatting differences are deliberately
  invisible; this is the migration-verification tool.
- `doctor --config <path>` — config validation, environment-reference
  resolution (names only, never values), publish-gate dry run.
- `compat lokalise2 file download [flags]` — a flag-compatible translator
  onto `pull` with the `lokalise` preset. Output is this package's canonical
  shape (underscore filenames by default), not a byte-identical mirror of the
  vendor CLI. Suits `alias lokalise2='typren-locale compat lokalise2'` for
  build scripts mid-migration.

The CLI honors `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`: when a proxy variable is
set it re-executes itself with `NODE_USE_ENV_PROXY=1`, because Node's `fetch`
ignores them otherwise. This needs Node 22.21+ or 24.5+; on older Node the
variable is a no-op and requests go direct.

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
root and several sibling packages (`@typren/core`, `@typren/studio`) are under
the Functional Source License instead. Check `packages/locale/LICENSE`
against the repo root's before assuming one license covers everything here.

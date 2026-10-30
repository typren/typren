# @typren/adapter-cloudfront

## 0.4.4

### Patch Changes

- Updated dependencies [3467588]
- Updated dependencies [68f90fb]
  - @typren/core@0.7.0

## 0.4.3

### Patch Changes

- Updated dependencies [ac50d55]
  - @typren/core@0.6.0

## 0.4.2

### Patch Changes

- Updated dependencies [c1dbf54]
  - @typren/core@0.6.0

## 0.4.1

### Patch Changes

- ddc554b: Declare a Node.js `engines` floor of `^22.23.4 || ^24.22.1 || >=26.12.1`, the releases that fix the 2026-10-21 Node.js security advisory (Brotli decoder out-of-bounds write, TLS hostname check bypasses). Installing on an older Node now prints an engine warning; nothing fails unless the consumer enables `engine-strict`.
- Updated dependencies [6da1d23]
- Updated dependencies [ddc554b]
  - @typren/core@0.5.4

## 0.4.0

### Minor Changes

- 54f43b1: `readFunctionSource({ trailingSlash: false })` now reads a second,
  hand-written viewer-request function (`redirects-bare-url.function.js`)
  roughly symmetric to the default one: slash form 301s to the bare form,
  bare extensionless pages rewrite to their `.html` object. `bootstrap` gains
  `--trailing-slash` (keep in sync with `sync-redirects`' own flag) to select
  it, and `--extra-passthrough <seg,seg>` to template in a site's own
  extensionless file-convention routes alongside the built-in Next metadata
  names. Segments are validated (bare path-segment characters only) and
  `JSON.stringify`'d into the published function's JS source, never
  string-concatenated.
- e0a5af1: `bootstrap` previously attached the viewer-request function to the default
  cache behavior only, and its already-attached guard read only that
  behavior, so a distribution with extra `CacheBehaviors` (`/assets/*`,
  `/api/*`) could silently skip redirects and the index rewrite on those
  paths, and a different function parked there went undetected. Add
  `--behavior <path-pattern>` (repeatable) and `--all-behaviors` to attach
  to extra behaviors (or every behavior) beyond the always-attached default,
  and extend the guard to read every behavior on the distribution regardless
  of which ones a run targets.
  
  BREAKING (internal, pre-1.0): `CloudFrontClient.setViewerRequestFunction`
  now takes a third `behaviors: CacheBehaviorTarget[] | "*"` argument, and
  `getAttachedFunctionNames` returns names found on any behavior, not just
  the default. Only affects a caller supplying its own `CloudFrontClient`
  (e.g. in tests); the AWS-CLI-backed default client and the CLI are
  unaffected.
- 07a5280: Redirects can now carry a per-entry HTTP status (301, the default, or
  302/307/308), closing the gap for migrators from `_redirects`/`vercel.json`
  who expect a temporary (302) or method-preserving permanent (308) redirect
  instead of a hardcoded 301. A `--map` entry sets it with a `status` field
  (`{ "from": "/old", "to": "/new", "status": 302 }`); `@typren/core`'s
  `toRedirectPairs` encodes it as a `"<status> <target>"` prefix on the stored
  value, and `resolveStaticHostRequest`, the CloudFront function, and the
  Cloudflare Worker all decode it the same way (an unrecognized status prefix
  is an invalid entry and fails open, same as any other invalid target).

### Patch Changes

- b0aa508: Updated for `@typren/core`'s async `ContentAdapter`/`ContentStore`
  (`buildRedirects`, `ContentStore.listPages`); this package's own public
  behavior is unchanged.
- 3e432fe: Dependency updates: next 16.4.0, dompurify 3.4.17, js-yaml 5.4.3, jsdom 30.1.2 and dev tooling (vitest, eslint,
  typescript-eslint, @types/node, @vitejs/plugin-react, lucide-react).
- Updated dependencies [b0aa508]
- Updated dependencies [d2c9f03]
- Updated dependencies [11b4619]
- Updated dependencies [3e432fe]
- Updated dependencies [07a5280]
- Updated dependencies [52e172a]
- Updated dependencies [1130d81]
- Updated dependencies [e20d2b8]
- Updated dependencies [f5ec0c8]
- Updated dependencies [f5580aa]
- Updated dependencies [b95f3cd]
- Updated dependencies [c6f38fa]
- Updated dependencies [8be319f]
- Updated dependencies [87ec75b]
- Updated dependencies [d054689]
  - @typren/core@0.5.0

## 0.3.1

### Patch Changes

- 7e13dc1: Redirect sourcing (`scanContentStore`, `loadRedirectMap`,
  `mergeRedirectEntries`) now comes from `@typren/core`; this package's public
  API is unchanged.
- 5041c29: Relicensed to Apache-2.0 and the LICENSE file is now included in the package
  (it previously pointed at a LICENSE it did not ship).
- Updated dependencies [7e13dc1]
  - @typren/core@0.4.0

## 0.3.0

### Minor Changes

- 141c636: Security and generality hardening from a pre-release review, layered on the
  new `--map` source:
  
  - **Content scan can no longer execute code**: gray-matter's `javascript`
    front-matter engine (which eval()s the block) is refused, so a markdown
    file cannot run inside the credentialed sync process.
  - **Edge function refuses hostile KVS targets** (protocol-relative,
    backslash, control characters) instead of serving them into a Location
    header, and its extensionless passthrough now matches nested Next metadata
    routes (`/blog/opengraph-image`) and `/.well-known/*`.
  - **Map validation matches core's rigor**: rejects whitespace/control/
    backslash values, protocol-relative targets, self-redirects (browser-cached
    301 loops) and entries shadowing a live page's path.
  - **Sync safety**: an empty desired state refuses to mass-delete every live
    key without `--allow-empty`; a value-taking flag swallowing the next flag
    (`--map --dry-run`) errors instead of silently running without the map;
    the listKeys ETag is fetched before the listing so a concurrent sync fails
    loud (412) instead of silently losing its changes.
  - **Correctness**: on-site targets carrying a query/fragment canonicalize
    intact (`/new?utm=1` no longer becomes `/new?utm=1/`); KVS keys are stored
    percent-encoded, the form the edge compares against; the key byte limit
    applies to the encoded form.
  - **`--trailing-slash false`** emits on-site targets verbatim for
    bare-URL-canonical sites (which bring their own function; see the README's
    new "Site shapes" and "Trust boundaries" sections).
  - AWS CLI errors now say what's wrong: missing binary or a v1 CLI without
    the `cloudfront-keyvaluestore` commands.
- b93de3e: `sync-redirects` gains `--map <file>`: a host-supplied redirect map (`.json`
  array of `{ from, to }`, or a `.mjs`/`.js` module exporting one) merged with
  the content scan's frontmatter aliases. Map targets may be on-site paths
  (canonicalized to the trailing-slash form, except file objects) or absolute
  http(s) URLs (passed through verbatim); a `from` declared by both sources
  fails loudly. A site with no typren content syncs from the map alone, which
  makes the canonical function + KeyValueStore + sync usable by any CloudFront
  static site, typren or not. `loadRedirectMap` and `mergeRedirectEntries` are
  exported for hosts composing their own sync.

### Patch Changes

- @typren/core@0.3.2

## 0.2.2

### Patch Changes

- 4a519e8: Security and correctness fixes from a repo-wide audit. adapter-cloudfront: the viewer-request function no longer emits protocol-relative redirect Locations (open redirect), preserves query strings on 301s, and emits canonical single-hop KVS targets; `setViewerRequestFunction` merges function associations instead of overwriting every event type. core: the locale router's redirect pathname collapses leading slashes (same open-redirect class), settings fall back to the default locale and detect draft-only versions, `listSlugs` skips non-slug filenames instead of throwing, `filePolicy` wildcard rules no longer apply to identities without an `@`, and the Notion adapter passes its token over stdin instead of child-process argv. cli: shared version read.
- Updated dependencies [4a519e8]
- Updated dependencies [fdb04a5]
  - @typren/core@0.3.0

## 0.2.1

### Patch Changes

- e7c422f: Update all dependencies to latest, consolidating the open Dependabot PRs (#57–#61): js-yaml 5 (named exports, bundled types), jsdom 30, vitest 5, TypeScript 6 (typescript-eslint does not support TS 7.0 yet), @types/node 26, eslint 10.10 / @eslint/js 10, plus minor and patch bumps across the workspace. Package tsconfigs now declare `"types": ["node"]` explicitly, as TS 6+ no longer auto-includes hoisted @types packages.
- Updated dependencies [e7c422f]
  - @typren/core@0.2.2

## 0.2.0

### Minor Changes

- d1b7f83: New package: a CloudFront host adapter for typren's `redirects()`. Ships the canonical viewer-request function for a static-export site on an S3 REST origin (directory-index rewrite + bare→slash canonicalization + KVS-backed redirect lookup, fail-open when the store is unavailable), plus a `typren-cloudfront sync-redirects` command that idempotently diff-syncs `@typren/core`'s `redirects()` output into a CloudFront KeyValueStore (chunked at the 50-change API cap, ETag-chained, `--dry-run` supported). An optional guarded `bootstrap` command wires the KVS + function onto an EXISTING distribution — it is not IaC and never creates a bucket or distribution.

### Patch Changes

- Updated dependencies [a6e618b]
- Updated dependencies [38548ca]
- Updated dependencies [5d27c77]
  - @typren/core@0.2.0

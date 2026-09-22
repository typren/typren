# @typren/adapter-cloudfront

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

# @typren/adapter-cloudfront

## 0.2.0

### Minor Changes

- d1b7f83: New package: a CloudFront host adapter for typren's `redirects()`. Ships the canonical viewer-request function for a static-export site on an S3 REST origin (directory-index rewrite + bare→slash canonicalization + KVS-backed redirect lookup, fail-open when the store is unavailable), plus a `typren-cloudfront sync-redirects` command that idempotently diff-syncs `@typren/core`'s `redirects()` output into a CloudFront KeyValueStore (chunked at the 50-change API cap, ETag-chained, `--dry-run` supported). An optional guarded `bootstrap` command wires the KVS + function onto an EXISTING distribution — it is not IaC and never creates a bucket or distribution.

### Patch Changes

- Updated dependencies [a6e618b]
- Updated dependencies [38548ca]
- Updated dependencies [5d27c77]
  - @typren/core@0.2.0

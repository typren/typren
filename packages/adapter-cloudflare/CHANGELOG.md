# @typren/adapter-cloudflare

## 0.1.0

### Minor Changes

- cf867d9: First release: a Cloudflare Workers + Static Assets host adapter for typren.
  Ships the canonical Worker (KV-backed redirect lookup, fail-open, plus the
  routing for either static-export URL shape, held to the same contract suites
  as `@typren/core`), an optional canonical host (apex → www), and a
  `typren-cloudflare` CLI (`init`, `bootstrap`, `sync-redirects`) that writes the
  wrangler config and syncs `@typren/core`'s `redirects()` into Workers KV.

### Patch Changes

- 5041c29: Keep directory-index rewrites on the request's host (a `//host/` path no longer
  resolves the rewritten asset URL onto another host). Licensed Apache-2.0, with
  the LICENSE file now included in the package.
- Updated dependencies [7e13dc1]
  - @typren/core@0.4.0

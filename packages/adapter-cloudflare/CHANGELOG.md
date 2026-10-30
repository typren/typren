# @typren/adapter-cloudflare

## 0.2.4

### Patch Changes

- Updated dependencies [3467588]
- Updated dependencies [68f90fb]
  - @typren/core@0.7.0

## 0.2.3

### Patch Changes

- Updated dependencies [ac50d55]
  - @typren/core@0.6.0

## 0.2.2

### Patch Changes

- Updated dependencies [c1dbf54]
  - @typren/core@0.6.0

## 0.2.1

### Patch Changes

- ddc554b: Declare a Node.js `engines` floor of `^22.23.4 || ^24.22.1 || >=26.12.1`, the releases that fix the 2026-10-21 Node.js security advisory (Brotli decoder out-of-bounds write, TLS hostname check bypasses). Installing on an older Node now prints an engine warning; nothing fails unless the consumer enables `engine-strict`.
- Updated dependencies [6da1d23]
- Updated dependencies [ddc554b]
  - @typren/core@0.5.4

## 0.2.0

### Minor Changes

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

- dd70aff: `runWrangler` now invokes `npx --no-install wrangler`, so a site that never
  installed `wrangler` as a devDependency can no longer have npx silently
  fetch and run whatever package is published under that name. `renderWranglerConfig`
  also lowercases `canonicalHost` before writing it, since the Worker compares
  it against the always-lowercase `url.hostname`.
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

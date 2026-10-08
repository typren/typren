---
"@typren/adapter-cloudflare": minor
---

First release: a Cloudflare Workers + Static Assets host adapter for typren.
Ships the canonical Worker (directory-index rewrite + bare→slash
canonicalization + KV-backed redirect lookup, fail-open, held to the same
contract suite as `@typren/adapter-cloudfront`'s edge function) and a
`typren-cloudflare` CLI (`init`, `bootstrap`, `sync-redirects`) that writes
the wrangler config and diff-syncs `@typren/core`'s `redirects()` into
Workers KV.

---
"@typren/adapter-cloudflare": minor
---

First release: a Cloudflare Workers + Static Assets host adapter for typren.
Ships the canonical Worker (KV-backed redirect lookup, fail-open, plus the
routing for either static-export URL shape, held to the same contract suites
as `@typren/core`), an optional canonical host (apex → www), and a
`typren-cloudflare` CLI (`init`, `bootstrap`, `sync-redirects`) that writes the
wrangler config and syncs `@typren/core`'s `redirects()` into Workers KV.

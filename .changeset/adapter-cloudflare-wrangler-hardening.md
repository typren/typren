---
"@typren/adapter-cloudflare": patch
---

`runWrangler` now invokes `npx --no-install wrangler`, so a site that never
installed `wrangler` as a devDependency can no longer have npx silently
fetch and run whatever package is published under that name. `renderWranglerConfig`
also lowercases `canonicalHost` before writing it, since the Worker compares
it against the always-lowercase `url.hostname`.

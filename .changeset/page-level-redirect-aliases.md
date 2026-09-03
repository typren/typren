---
"@typren/core": minor
---

Added `buildRedirects(store, opts?)`, a framework-agnostic redirects API driven by page frontmatter: a page declares its own old URLs via `aliases: string[]` instead of every host hand-maintaining a redirect config. Validates absolute paths, rejects an alias that shadows another page's canonical path (including a page aliasing itself), de-duplicates across the whole site, and caps total entries (`maxEntries`, default 1000). Hosts turn the returned `RedirectEntry[]` into whatever their infra wants — Next `redirects()`, a Netlify/Cloudflare `_redirects` file, `vercel.json`, an nginx map, or a CloudFront KeyValueStore (see the new `@typren/adapter-cloudfront`).

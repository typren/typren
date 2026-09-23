---
"@typren/core": patch
---

`@typren/core/seo`'s `markdown-route` now imports `next/server.js` instead of
bare `next/server`. next@16 ships no `exports` map, so subpaths resolve as
plain file paths — and Node's ESM resolution requires the extension there,
which is why any Node-resolution consumer (vitest with the dep externalized,
raw node ESM) importing `@typren/core/seo` hit `Cannot find module
'.../next/server' — Did you mean to import "next/server.js"?`. Bundler
consumers (Turbopack, webpack, vite) resolve `next/server.js` identically to
the old bare specifier, so this is a no-op for them.

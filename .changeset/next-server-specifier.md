---
"@typren/core": patch
---

`@typren/core/seo`'s `markdown-route` now imports `next/server.js` instead of
bare `next/server`. next@16's exports map only lists `./server.js`, not
`./server`, so any Node-resolution consumer (vitest without a bundler alias,
plain `node --experimental-...` ESM, etc.) importing `@typren/core/seo` hit
`Cannot find module '.../next/server' — Did you mean to import
"next/server.js"?`. Bundler consumers (Turbopack, webpack, vite) resolve
`next/server.js` identically to the old bare specifier, so this is a
no-op for them.

---
"@typren/core": patch
---

The published `dist` now imports `./preview-bridge.vanilla.js` with its extension. The build skipped any specifier whose name contained a dot, so the canvas, studio bridge and multi-section canvas modules failed to resolve under strict ESM resolvers.

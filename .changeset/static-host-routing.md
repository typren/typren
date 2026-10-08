---
"@typren/core": minor
---

Add `@typren/core/static-host` (`resolveStaticHostRequest`), covering both
static-export URL shapes: `trailingSlash: true` (the default) and Next's default
bare URLs via `{ trailingSlash: false }`. Add host-agnostic redirect sourcing
(`scanContentStore`, `loadRedirectMap`, `mergeRedirectEntries`,
`toRedirectPairs`).

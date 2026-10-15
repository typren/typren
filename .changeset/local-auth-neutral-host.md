---
"@typren/core": patch
---

`localAuth()` accepts an `isBoundToLoopback` option, so non-Next hosts such as Astro can supply the loopback-bind proof (alongside `getHost` for the Host header) instead of having every write denied. Next hosts need no change. A throw from any check now denies instead of propagating.

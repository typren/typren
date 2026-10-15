---
"@typren/core": patch
---

`createGithubAdapter`'s `listSlugs` now skips files whose names are not valid slugs instead of listing them,
so one stray file in the content directory no longer breaks every page listing that reads it.

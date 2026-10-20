---
"@typren/locale": patch
---

`typren-locale` now honors `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`. Node's `fetch` ignores them by default, so the CLI re-executes itself with `NODE_USE_ENV_PROXY=1` when a proxy variable is set, which makes `compat lokalise2 file download` work behind a corporate proxy like the vendor binary does.

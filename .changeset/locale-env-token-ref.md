---
"@typren/locale": patch
---

Fix `pull`, `bake` and `doctor` rejecting every export-api config that references its token as `${VAR}`: the config loader no longer interpolates `source.token` before the provider's literal-token check.

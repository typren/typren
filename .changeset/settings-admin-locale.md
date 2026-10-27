---
"@typren/core": patch
---

The settings `"admin"` authorization check now carries the `locale` being written, so a per-locale `AuthAdapter` policy holds for settings draft saves and publishes the same way it already did for every content write. Additive `AuthContext` field use; no adapter changes needed.

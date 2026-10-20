---
"@typren/locale": patch
---

Admit Lokalise's current export bucket in the `lokalise` preset's `bundleOrigins`. Lokalise now serves async exports from a virtual-hosted S3 bucket, so every Lokalise pull was refused.

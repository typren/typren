---
"@typren/locale": patch
---

`export-api` skips a bundle locale that is not a BCP-47 tag (a TMS custom language such as Lokalise's `custom_1`) with a warning instead of failing the whole pull. Traversal-shaped names still throw.

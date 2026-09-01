---
"@typren/core": patch
"typren": patch
---

Add a Notion-backed `ContentAdapter` (`createNotionAdapter`, `createFetchNotionClient`), and let a `CollectionSection` take a pre-built `adapter` instead of `dir` for non-filesystem backends. Both additive, no behaviour change for existing markdown-backed collections.

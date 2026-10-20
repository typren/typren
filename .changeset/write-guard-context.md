---
"@typren/core": patch
---

Write actions now pass the target `slug`, `locale` and `collectionId` to `authorize()`, as reads already did. Collection writes carry their section's `collectionId`, translation actions carry the locale they create or delete, and `createPage`, `renamePage` and `duplicatePage` authorize the destination slug, so a per-collection, per-locale or reserved-slug policy can no longer be bypassed through a write route.

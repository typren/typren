---
"@typren/locale": patch
---

`buildCatalogs` now refuses `__proto__`, `constructor` and `prototype` as the `app` name before writing anything. That name keys the manifest's `apps` object, and the locale keys under it were already checked this way.

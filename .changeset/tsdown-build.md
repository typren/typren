---
"@typren/core": patch
"@typren/studio": patch
"@typren/forms": patch
"@typren/locale": patch
"@typren/adapter-cloudflare": patch
"@typren/adapter-cloudfront": patch
"@typren/adapter-media-s3": patch
"typren": patch
---

Packages are built with tsdown (Rolldown and Oxc) instead of tsc. The dist layout and exports maps are unchanged and relative specifiers still carry `.js` extensions, so nothing changes for consumers.

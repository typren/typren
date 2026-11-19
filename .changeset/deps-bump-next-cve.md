---
"@typren/core": patch
"@typren/locale": patch
---

Refresh dependencies within their ranges: `dompurify` 3.4.18 at runtime, and `jsdom` moves to 31 (same Node engines). The workspace now builds and tests against `next` 16.4.6, which fixes GHSA-mfr8-8qww-v76h and GHSA-vc7v-qv4w-wrv8 (`use cache` leaks across root params). Sites on `next` 16.2.0 through 16.4.4 should upgrade to 16.4.5 or later.

---
"@typren/locale": patch
---

`createExportApiSourceProvider` now fetches the TMS bundle with `redirect: "manual"` and refuses any 3xx response, so a bundle host that redirects elsewhere can no longer bypass the `bundleOrigins` allowlist on a later hop.

---
"@typren/core": patch
---

`handleMediaUpload` now refuses a cross-origin request with 403 (a cross-site `Sec-Fetch-Site`, or an `Origin` whose host isn't the request's). A multipart POST needs no CORS preflight, so any web page could previously upload to a developer's loopback dev server through a standalone media route. A host serving the editor from another origin passes it as the new optional `allowedOrigins` argument; `createTyprenApi` forwards its own `allowedOrigins`.

---
"@typren/locale": patch
---

Harden the export-api bundle fetch. Bundle download errors now log only the URL's origin and path, so a presigned-URL signature in the query string never reaches CI logs. Zip and JSON bundle downloads are read with a running 50 MB cap and a 60 s timeout, so a hostile bundle origin cannot exhaust memory or hang a pull.

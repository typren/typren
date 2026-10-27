---
"@typren/adapter-cloudflare": patch
"@typren/adapter-cloudfront": patch
"@typren/adapter-media-s3": patch
"typren": patch
"@typren/core": patch
"@typren/forms": patch
"@typren/locale": patch
---

Declare a Node.js `engines` floor of `^22.23.4 || ^24.22.1 || >=26.12.1`, the releases that fix the 2026-10-21 Node.js security advisory (Brotli decoder out-of-bounds write, TLS hostname check bypasses). Installing on an older Node now prints an engine warning; nothing fails unless the consumer enables `engine-strict`.

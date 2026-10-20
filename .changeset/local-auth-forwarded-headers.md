---
"@typren/core": patch
---

`localAuth()` now refuses requests that look forwarded by a proxy or tunnel: a non-loopback `X-Forwarded-For` hop or `X-Forwarded-Host`, or any `Forwarded` or `X-Real-IP` header. It takes a `hasForwardedHeaders` option for non-Next hosts, and `isForwardedRequest(headers)` is exported to implement it. A same-host proxy that rewrites `Host` to loopback used to pass every check and expose the dev editor's writes to the internet. This is a best-effort tripwire; the docs now say `localAuth()` must never sit behind a forwarder.

---
"@typren/core": patch
---

`localAuth()` now requires the Next server to be bound to loopback (`next dev -H 127.0.0.1`) and denies every request otherwise. The loopback `Host` check it relied on before is client-controlled, so a LAN client could spoof `Host: localhost` against a dev server listening on all interfaces (Next's default) and write content and media. Update your `dev` script if editor writes start failing in development; see the core 0.5.0 migration note.

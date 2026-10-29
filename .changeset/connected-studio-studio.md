---
"@typren/studio": minor
---

`clientHost(client, site, uploadPath)` binds `TyprenStudioHost` to the content API's HTTP client, and `STUDIO_SECTIONS` is the default rail it uses, so the local studio and the cloud's connected studio share one wiring.

`EmptyState`, `Skeleton` and `Button` are exported too, so a host's own states around the studio (connecting, unreachable) look like the studio's.

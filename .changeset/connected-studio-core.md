---
"@typren/core": minor
---

`createTyprenApi` takes `allowOrigin: { origin, token }`: one foreign origin may call the API from a browser, reads included, when it sends `Authorization: Bearer <token>`. It answers that origin's CORS and Private Network Access preflights with its exact origin, never `*`, and refuses the origin outright without the token. A new `studio` option serves `GET /studio`, the studio's initial props, behind the read gate. Both exist for the connected studio (`typren studio --cloud`).

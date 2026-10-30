---
"@typren/core": minor
---

`createTyprenApi` takes `allowOrigin: { origin, token }`: one foreign origin may call the API from a browser, reads included, when it sends `Authorization: Bearer <token>`. It answers that origin's CORS and Private Network Access preflights with its exact origin, never `*`, and refuses the origin outright without the token. A new `studio` option serves `GET /studio`, the studio's initial props, behind the read gate. Both exist for the connected studio (`typren studio`, the default from 0.7).

The studio's initial data and site facts moved into core as `loadStudioProps(config, manifest, slug)` (with `loadStudio`, `studioSiteConfig`, `previewBase`, `sectionRouteUrl`, `siteTrailingSlash` and the `StudioManifest`, `StudioProps` and `StudioSiteProps` types), so the local studio app and the CLI's API server open the studio from one code path.

`FieldFormMedia` gains an optional `upload(file, folder?)`: a host whose API needs credentials uploads through its own client instead of a plain POST to `uploadPath`.

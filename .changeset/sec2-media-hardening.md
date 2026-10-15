---
"@typren/core": minor
---

SVG uploads are now off by default. Set `allowSvg: true` in `CmsConfig` to accept them, and serve media from a
separate origin or with `Content-Security-Policy: sandbox` (see docs/site/media-storage.md). Allowed SVGs also
lose `<style>`, `<image>` and any `href` that is not a same-document `#fragment`. WebP and AVIF uploads are now
re-encoded like every other raster format, which strips EXIF/GPS metadata and applies the 2000 px cap, and
`handleMediaUpload` refuses a body whose `Content-Length` is over the limit before buffering it.

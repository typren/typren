---
"@typren/adapter-media-s3": patch
---

Harden `createS3MediaAdapter` per security review:

- `upload()` now rejects any MIME outside `image/webp`, `image/avif` and
  `image/svg+xml`, sets a one-year immutable `cache-control` (keys are never
  overwritten), and sets `content-disposition: inline` for SVG uploads.
  `publicBaseUrl` must be a separate origin from the site/editor — see the
  README's Known limits.
- `list()` now caps at 100 pages and rejects a repeated `ContinuationToken`,
  instead of looping indefinitely against a misbehaving provider.

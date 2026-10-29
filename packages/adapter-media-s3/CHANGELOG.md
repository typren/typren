# @typren/adapter-media-s3

## 0.2.2

### Patch Changes

- Updated dependencies [c1dbf54]
  - @typren/core@0.6.0

## 0.2.1

### Patch Changes

- ddc554b: Declare a Node.js `engines` floor of `^22.23.4 || ^24.22.1 || >=26.12.1`, the releases that fix the 2026-10-21 Node.js security advisory (Brotli decoder out-of-bounds write, TLS hostname check bypasses). Installing on an older Node now prints an engine warning; nothing fails unless the consumer enables `engine-strict`.
- Updated dependencies [6da1d23]
- Updated dependencies [ddc554b]
  - @typren/core@0.5.4

## 0.2.0

### Minor Changes

- e02ea48: Initial release: one `MediaAdapter` over any S3 API-compatible object store
  (Cloudflare R2, Supabase Storage, AWS S3, MinIO), signed with `aws4fetch` so it
  runs on Cloudflare Workers as well as Node.

### Patch Changes

- 3e432fe: Dependency updates: next 16.4.0, dompurify 3.4.17, js-yaml 5.4.3, jsdom 30.1.2 and dev tooling (vitest, eslint,
  typescript-eslint, @types/node, @vitejs/plugin-react, lucide-react).
- 6add76c: Harden `createS3MediaAdapter` per security review:
  
  - `upload()` now rejects any MIME outside `image/webp`, `image/avif` and
    `image/svg+xml`, sets a one-year immutable `cache-control` (keys are never
    overwritten), and sets `content-disposition: inline` for SVG uploads.
    `publicBaseUrl` must be a separate origin from the site/editor — see the
    README's Known limits.
  - `list()` now caps at 100 pages and rejects a repeated `ContinuationToken`,
    instead of looping indefinitely against a misbehaving provider.
- f4512c8: `createS3MediaAdapter`'s `prefix` option, if set, must now be non-empty and
  end in `/`. Without the trailing slash, a prefix like `"siteA"` also matched
  the key `"siteAB/x"` (`startsWith`), so one site's adapter could list or
  delete another site's objects in a shared bucket. `"siteA/"` can't.
- Updated dependencies [b0aa508]
- Updated dependencies [d2c9f03]
- Updated dependencies [11b4619]
- Updated dependencies [3e432fe]
- Updated dependencies [07a5280]
- Updated dependencies [52e172a]
- Updated dependencies [1130d81]
- Updated dependencies [e20d2b8]
- Updated dependencies [f5ec0c8]
- Updated dependencies [f5580aa]
- Updated dependencies [b95f3cd]
- Updated dependencies [c6f38fa]
- Updated dependencies [8be319f]
- Updated dependencies [87ec75b]
- Updated dependencies [d054689]
  - @typren/core@0.5.0

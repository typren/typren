# @typren/studio-local

## 0.2.0

### Minor Changes

- c1dbf54: The local host behind `typren studio` is now `@typren/studio-local` (was `@typren/studio`). It mounts `@typren/studio`, serves the content API from its own process and frames the site's dev server as the live preview, so a site mounts no studio or API routes. It keeps the page and edit mode in the URL, edits `studio.nestedLayouts` pages on their real routes, refuses to be framed, and serves proxied site images under a sandboxing CSP.

### Patch Changes

- Updated dependencies [c1dbf54]
- Updated dependencies [c1dbf54]
  - @typren/core@0.6.0
  - @typren/studio@0.6.0

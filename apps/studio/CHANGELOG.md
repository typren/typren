# @typren/studio-local

## 0.2.2

### Patch Changes

- 3e12c15: Reads the studio's initial props through core's `loadStudioProps` and binds the studio through `@typren/studio`'s `clientHost`, the same code the connected studio uses. Started with `typren studio --local`.
- Updated dependencies [3467588]
- Updated dependencies [3e12c15]
- Updated dependencies [68f90fb]
- Updated dependencies [def96cd]
- Updated dependencies [69d7b0b]
- Updated dependencies [2d7cd2c]
- Updated dependencies [f45cc98]
- Updated dependencies [ebc0fba]
- Updated dependencies [46e23fb]
  - @typren/core@0.7.0
  - @typren/studio@0.7.0

## 0.2.1

### Patch Changes

- Updated dependencies [ac50d55]
  - @typren/core@0.6.0
  - @typren/studio@0.6.0

## 0.2.0

### Minor Changes

- c1dbf54: The local host behind `typren studio` is now `@typren/studio-local` (was `@typren/studio`). It mounts `@typren/studio`, serves the content API from its own process and frames the site's dev server as the live preview, so a site mounts no studio or API routes. It keeps the page and edit mode in the URL, edits `studio.nestedLayouts` pages on their real routes, refuses to be framed, and serves proxied site images under a sandboxing CSP.

### Patch Changes

- Updated dependencies [c1dbf54]
- Updated dependencies [c1dbf54]
  - @typren/core@0.6.0
  - @typren/studio@0.6.0

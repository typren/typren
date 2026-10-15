---
package: "@typren/core"
version: "0.5.0"
title: "ContentAdapter and ContentStore are async"
detect:
  - pattern: "\\b(cmsStore|store)\\.(listPages|getPublished|getDraft|currentVersion)\\("
    glob: "**/*.{ts,tsx}"
    hint: "ContentStore reads now return Promises; add await."
---
## What changed

Every `ContentStore` read and write now returns a `Promise`.

## Fix

1. Add `await` in front of every `cmsStore`/`store` call.
2. Make the enclosing function `async` if it isn't already.

## Verify

`npx tsc --noEmit` and the site build pass.

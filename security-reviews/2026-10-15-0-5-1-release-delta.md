---
reviewedHead: b47ffc41d1709492b27c54e82cca39f17011f457
date: 2026-10-15
method: manual
outcome: pass
open:
  critical: 0
  high: 0
  medium: 0
  low: 27
incomplete: []
---

# 0.5.1 release delta review

This covers only the change from the reviewed commit 1c1c2f5 (`2026-10-15-0-5-x-promotion.md`) to b47ffc4. In between, these merged in order: PR #104 (the reviewed fixes), Version Packages #106, PR #109 (the locale fix below) and Version Packages #110.

## Code change: #109, CodeQL alert 13

`packages/locale/src/build/catalog.ts` now refuses the app names `__proto__`, `constructor` and `prototype` before anything is written. These are the same literal checks the locale keys under it already get, and the change adds 5 lines with a test in `catalog.test.ts`.

The old code was not exploitable. The `apps` object was built with a computed key, which creates an own property rather than touching the prototype, and the app name comes from the operator's build config. The change only refuses that input; it adds no new way to read or write anything. `vitest.config.ts` changed only because the coverage threshold ratcheted.

## Manifest changes

Five `packages/*/package.json` manifests changed. Each change is a version number or a dependency range, and nothing else:

| Manifest | Change |
|---|---|
| `packages/core/package.json` | `version` 0.5.0 → 0.5.1 |
| `packages/cli/package.json` | `version` 0.5.0 → 0.5.1 |
| `packages/editor/package.json` (private) | `version` 0.5.0 → 0.5.1; `@typren/core` `^0.5.0` → `^0.5.1` |
| `packages/adapter-media-s3/package.json` | peer `@typren/core` `^0.5.0` → `^0.5.1` (its own version is unchanged) |
| `packages/locale/package.json` | `version` 0.3.0 → 0.3.1 |

No scripts, `files`, `exports`, `bin` or `publishConfig` fields changed, and no dependency was added. Everything else in the range is changelogs and consumed changesets, which the gate exempts.

The findings and the open low list are unchanged from `2026-10-15-0-5-x-promotion.md` and tracked in #105.

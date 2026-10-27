---
reviewedHead: 8dd4f8d3e38471c393467bf8021b8dcca758cbec
date: 2026-10-27
method: manual
outcome: pass
open:
  critical: 0
  high: 0
  medium: 0
  low: 1
incomplete: []
---

# 0.5.4 promotion delta review

This covers only the change from 7f02be3, the last reviewed head (`2026-10-21-locale-0-3-4-delta.md`), to 8dd4f8d:
PR #132 (a Node.js `engines` floor on the seven published packages), PR #131 (the grouped Dependabot bump of 13
dependencies, plus a patch changeset) and Version Packages #133 (`@typren/core`, `typren` and `@typren/editor` 0.5.4,
`@typren/adapter-cloudfront` 0.4.1, `@typren/adapter-cloudflare` and `@typren/adapter-media-s3` 0.2.1, `@typren/forms`
0.2.2, `@typren/locale` 0.3.5).

No source, test, script, workflow or hook file changed. The sensitive paths in the delta are the root and package
`package.json` files and `bun.lock`. One read-only reviewer diffed both, and ran `bun audit` against the public registry
on the reviewed head's manifests and lockfile.

## Confirmed findings

| Severity | Finding | Location | Status |
|---|---|---|---|
| low | The lockfile still resolves `source-map-js@1.2.1` (GHSA-68fv-2mgg-jv7q, event-loop DoS from crafted indexed source-map offsets) under `jsdom`'s `css-tree` and `next`'s `postcss`, both runtime dependencies of `@typren/core`. Neither path parses attacker-supplied source maps, and published packages do not pin it: consumers resolve their own version, and 1.2.2 is in range | `bun.lock` | Open, pre-existing: refresh the lockfile so every path resolves 1.2.2 |

## Verified clean

- Every manifest line in the delta is a `version` bump, a dependency range bump, or the new `engines` field. No
  `scripts`, `bin`, `exports`, `files`, `publishConfig` or dependency-name change.
- The `engines` range (`^22.23.4 || ^24.22.1 || >=26.12.1`) is metadata only: it warns on install, and fails only
  when the consumer enables `engine-strict`.
- Runtime dependency floors moved only for `js-yaml` (^5.5.0, now depending on `argparse@3`) and `jose` (^6.2.13),
  both patch or minor releases of the same maintainers' packages. Every other bump is a devDependency.
- Every added `bun.lock` entry carries a sha512 integrity hash. The delta adds no resolved URL, no non-npm registry
  and no Artifactory reference. The remaining entry changes are the bumped packages' own transitive updates and
  re-hoisting (`@vue/*`, `@babel/*`, `magic-string`, `postcss`, `nanoid`, `source-map-js`, `argparse`).
- `bun audit` reports 20 advisories, all present before this delta. Apart from the `source-map-js` row above, every
  path is dev-only tooling: `@changesets/cli > launch-editor > shell-quote` (the one critical, never run with
  untrusted input in CI or the release job), Vite through `@vitejs/plugin-react` and `vitest`, `eslint` and
  `@commitlint` through `ajv > fast-uri` and `minimatch > brace-expansion`, and `eslint-plugin-react-hooks > zod`.
  None ships in a published tarball.

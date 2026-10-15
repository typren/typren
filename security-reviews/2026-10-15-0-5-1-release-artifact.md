---
reviewedHead: be6a1d849d1b6cd0a320124bda1575eb6ce54a9b
date: 2026-10-15
method: manual
outcome: pass
open:
  critical: 0
  high: 0
  medium: 0
  low: 26
incomplete: []
---

# Release artifact fix (delta review)

This covers b47ffc4 (`2026-10-15-0-5-1-release-delta.md`) to be6a1d8. Three commits:

1. **Release staging directory** (`.github/workflows/release.yml`).
   - The first 0.5.1 release run (38803680004) failed because upload-artifact skips hidden files by default: staging into `.release-artifact` uploaded nothing, and the publish job found no artifact. Nothing was published.
   - The staging directory is now `release-artifact`, and the upload fails the build job if it finds no files.
   - upload-artifact moves to v7.0.2 (`cf430e0`) and download-artifact to v8.0.2 (`9000827`). Both are pinned by SHA, run on Node 24, and are official `actions/*` releases.
   - download-artifact v8 makes a digest mismatch an error, which tightens the artifact path.
   - The publish job's copy step is unchanged: it still copies only `packages/*/dist` and core's `migrations/` from a temp directory and refuses symlinks. No step, permission, environment or trigger changed.
2. **Pinning in `ci.yml` and `version-pr.yml`.** `actions/checkout@v7` and `oven-sh/setup-bun@v2` are replaced by the same SHAs `release.yml` already uses, and `bun-version: latest` by `1.4.2`. This closes the version-pr pinning low from #105, which is why the open low count goes from 27 to 26.
3. **`scripts/gen-api-surface.mjs`.** It strips a leading `#!` line from each `.d.ts` before concatenating. That line made `etc/api-surface/cli.d.ts` unparseable for CodeQL. This dev-only script runs in CI's surface-diff step and nowhere in the release path.

Known and accepted: the CLA workflow's `contributor-assistant/github-action` still targets Node 20, and upstream has no newer release. GitHub runs it on Node 24.

`bun run verify` passes, and actionlint is clean.

---
reviewedHead: 14c8197d5ad71f40275c1e65ed20b3bfb9483f8f
date: 2026-10-20
method: manual
outcome: pass
open:
  critical: 0
  high: 0
  medium: 0
  low: 9
incomplete: []
---

# 0.5.3 promotion delta review

This covers only the change from 151b9f1, reviewed in full in `2026-10-20-0-5-3-promotion.md`, to 14c8197. That
review passed with no critical or high findings and three distinct mediums. All three are fixed in this delta. The nine
lows it lists stay open for the issue tracker and are unchanged by this delta.

One read-only reviewer checked the delta and tried to bypass each fix. It re-checked after every round of follow-up
commits. Repros ran in a temp dir against `src/`, and `actionlint` passes on every workflow.

## Fixed in this delta

| Severity | Finding (from the full review) | Fix |
|---|---|---|
| medium | The markdown adapter followed symlinks, so a link merged under `content/` gave editors arbitrary file read and write | 79fb52d, 8ad0a30, 7064002: every path component below the content root (or a `draftDir` outside it) is lstat'ed and a symlink is refused. Writes check before `mkdir`, `listSlugs` checks its directory, and an unreadable path counts as absent |
| medium | The release build ran lint and test in the workspace the final rebuild used | 76866e0: the artifact comes from its own `build` job (fresh checkout, install with scripts off, `bun run build` only). `verify` runs the gate apart, and `publish` needs both |
| medium | Canary third-party code shared main's cache scope, and the release build restored the setup-bun cache | 76866e0: `no-cache: true` on every setup-bun in `release.yml` and `version-pr.yml`. No cache is restored anywhere on the release path |

## Found and fixed during this review

| Severity | Finding | Fix |
|---|---|---|
| high | The first symlink fix took the realpath of `draftDir` as the trusted root, so the `.drafts` link `typren init` scaffolds passed | 8ad0a30: a `draftDir` inside `contentDir` is checked from `contentDir` |
| medium | `verify` shares the workflow run, so code there with the runtime token could replace `release-dist` by name | 199c3f6: `publish` downloads the artifact id that `build` reported. A replacement gets a new id |
| low | A `draftDir` named like `content/..drafts` read as outside `contentDir` | 7064002: the outside test matches `..` as a whole path segment |
| low | An empty artifact id would download every artifact in the run | 14c8197: `publish` fails before downloading if the id is empty |
| low | The canary report steps were invalid YAML (`"Canary: ..."` in a plain scalar) | 00e82e3: the commands sit in block scalars |
| low | The first symlink fix threw `ENAMETOOLONG`/`ENOTDIR` from `exists` and `hasDraft`, which used to return false | 8ad0a30 |

## Accepted

- A configured root is trusted even when it is itself a symlink: a linked `contentDir` has to keep working. A `draftDir`
  outside `contentDir` but inside the repository could therefore be swapped for a link by a merged PR. The scaffold puts
  drafts inside `contentDir`, where every component is checked.
- On a case-insensitive filesystem, a `draftDir` that names `contentDir` with different case is treated as outside it.
  Only a misconfigured host is affected.
- Symlinks that stay inside the content root (a locale directory aliased to another one) are now refused. This fails
  closed, and the 0.5.3 changelog says so.

## Verified clean

- `release.yml`: `build` holds `contents: read` only, restores no cache and runs no lifecycle scripts. `publish` still
  receives `packages/*/dist` and `packages/core/migrations` with the layout its copy step expects. The pinned
  download-artifact extracts into `path` under `merge-multiple: true` and fails on an unknown id.
- The canary `report` job still installs nothing and is the only job with `issues: write`.
- `bun run verify` passes at 14c8197.

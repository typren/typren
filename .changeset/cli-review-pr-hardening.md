---
"typren": patch
---

Harden `typren review`'s git handling and PR-body generation:

- `--base <ref>` (and a brief's stored `baseRef`) now rejects a value
  starting with `-`, so it can never be parsed as a git option instead of a
  revision; every git call that still takes the ref also passes
  `--end-of-options` as defense in depth.
- `--pr`'s PR body writes to a fresh `mkdtempSync` directory instead of a
  predictable `typren-review-<slug>-<timestamp>.md` path directly under the
  shared temp dir.
- The PR body's embedded JSON code fence is now sized past the longest
  backtick run already present in the diff content it wraps.
- `typren init` no longer writes through a dangling symlink at a scaffold
  target; it's skipped like an existing file unless `--force`.

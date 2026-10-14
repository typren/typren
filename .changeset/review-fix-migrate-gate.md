---
"typren": patch
"@typren/core": patch
---

Hardening pass on `typren migrate` and the breaking-change migration gate,
all bug fixes with no API change:

- `typren migrate` now drops (with a warning) a `--remote` note whose
  package/version isn't validly shaped, strips control characters from a
  remote note's title/body, and caps the remote fetch to 1 MB while
  streaming instead of after buffering the whole response.
- `@typren/core`'s published package now also carries a `migrations/.min-version`
  file (the oldest migration note it kept); `migrate` reads it and warns
  (exiting non-zero) when a project's `--from` predates it, since older
  notes it may have needed were dropped from this release.
- The project file walk `migrate` runs to detect matches no longer follows
  symlinks, caps per-file reads at 1 MB, reads each file once regardless of
  how many detect patterns/notes apply to it, and ignores a few more
  generated-output directories (`coverage`, `build`, `.turbo`, `.vercel`,
  `.svelte-kit`, `.output`).
- Every `execFileSync("git", ...)` call in the CLI (`review`'s git-backed
  checks, and `--pr`'s checkout/commit/push) now runs with `envWithoutGit()`,
  closing the same inherited-`GIT_DIR` hazard `migrate`'s own git calls were
  already guarded against.
- `bun run check:migrations` is now part of the local `pre-push` gate (it was
  already part of `bun run verify`, so CI already ran it); the gate itself
  now requires a migration note's version to exactly match the version a
  changeset's bump produces (not just any later version), tolerates
  CRLF/unquoted-or-single-quoted changeset frontmatter, and only enforces
  itself against packages whose notes are actually packed into the CLI
  (`@typren/core`; others get an informational note instead of a failure).

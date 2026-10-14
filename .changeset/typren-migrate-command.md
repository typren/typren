---
"typren": minor
"@typren/core": patch
---

Add `typren migrate`: reads the migration notes bundled with the installed
`@typren/core` (`migrations/`, packed at build time from `docs/migrations/`)
and checks the project against each one's `detect` patterns, printing
file:line matches plus the note's Fix/Verify steps. `--remote` additionally
checks `https://typren.com/migrations/index.json` for notes newer than the
install, labelled unverified since they aren't pinned by the lockfile.

`@typren/core` ships the `migrations/` directory (now in its package `files`)
but no notes yet; this is a non-breaking addition and bumps patch.

Also adds the breaking-change migration gate (`bun run check:migrations`,
wired into `bun run verify`): a changeset whose body starts with `BREAKING:`
must have a `docs/migrations/<package>-<version>.md` ahead of that package's
current version, or `verify` fails with the missing file named.

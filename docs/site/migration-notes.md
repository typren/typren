---
title: Migration notes
description: The authoring format for docs/migrations/*.md and the breaking-change gate that requires it.
category: Contributing
order: 81
---

This page documents `docs/migrations/*.md`: the files `typren migrate` (see [reference-cli](./reference-cli.md)) reads to warn a project about a breaking change, and the format `scripts/check-migrations.mjs` enforces before a breaking changeset can land.

## The gate

`bun changeset` lets you describe a change in prose; nothing about that process on its own enforces that a migration note exists for a breaking one. `scripts/check-migrations.mjs` closes that gap: any pending `.changeset/*.md` whose body has a line matching `/^\**\s*breaking\s*:?/im` — any line, not just the first, so `"BREAKING:"`, `"**Breaking**"` and `"breaking change:"` all count — must have a matching `docs/migrations/<shortName>-<nextVersion>.md` for every package it bumps.

- `shortName` is the package's **directory name** under `packages/` (e.g. `core`), not its npm name (`@typren/core`).
- `nextVersion` is exactly what that changeset's bump (`patch`/`minor`/`major`) produces from the package's **current** `package.json` version. Pre-1.0 (major `0`), this repo's own convention is "breaking changes bump minor" (see AGENTS.md), so a changeset marked `major` pre-1.0 lands at the same version a `minor` one would.

**Only `core` is hard-gated today.** `check-migrations.mjs`'s `PACKED_PACKAGES` set is `["core"]`, deliberately narrow: only core's postbuild step packs migration notes into the published CLI (see below), so a breaking changeset for any other package would be gated against a note that nothing would ever read. A breaking changeset for a package outside `PACKED_PACKAGES` produces a **warning** (listed separately, under `unpacked`), not a hard failure — don't conflate the two when reading the gate's output.

## The note's format

Frontmatter plus a markdown body. `docs/migrations/core-0.5.0.md` is the canonical example:

```yaml
---
package: "@typren/core"   # scoped npm name
version: "0.5.0"           # exact semver this note applies to
title: "ContentAdapter and ContentStore are async"
detect:
  - pattern: "\\b(cmsStore|store)\\.(listPages|getPublished|getDraft|currentVersion)\\("   # JS regex source, as a string
    glob: "**/*.{ts,tsx}"
    hint: "ContentStore reads now return Promises; add await."
  # ...more { pattern, glob, hint } entries, one per detectable call site
---
```

`detect` is what `typren migrate` scans a project's files against, to warn about exactly this breaking change before the project even upgrades: each entry is a JS regex source (a string, not a literal — it's parsed at scan time), a glob restricting which files it runs against, and a hint shown alongside a match.

The body that follows is sectioned `## What changed`, `## Fix`, `## Verify` (see `core-0.5.0.md` for a full worked example of all three): what changed explains the breaking change itself, in enough detail that someone who hasn't read the PR understands why it broke; fix is a numbered, concrete checklist; verify is the command(s) that confirm the fix worked (`npx tsc --noEmit` and the site build, in core's case).

## Packing: keep-5 and `.min-version`

Core's own `packages/core/scripts/postbuild.mjs` (`packMigrationNotes`) packs migration notes into the published CLI so `typren migrate` can read them without the whole monorepo checked out. Only files matching `core-*.md` are packed; they're sorted newest-first by semver and the newest `MIGRATIONS_KEEP` (5) are kept. The oldest kept note's version is written to `migrations/.min-version` — not because older notes stop existing, but so `typren migrate` can tell a project upgrading from before that cutoff that it skipped straight past notes that might have applied to it, rather than silently reporting "none applied." See [reference-cli](./reference-cli.md) for how `typren migrate` itself consumes the packed notes and flags.

## How to add one

1. Write the changeset: `bun changeset`, with a body line starting `BREAKING:` describing the change.
2. Add `docs/migrations/<pkg-dir-name>-<version>.md` with the frontmatter shape above (`package`, `version`, `title`, `detect`) followed by `## What changed` / `## Fix` / `## Verify`. `<version>` must match exactly what the changeset's bump produces from the package's current version (pre-1.0, `major` and `minor` land at the same place).
3. Run `bun run check:migrations` (or `bun run verify`, which includes it) to confirm the gate is satisfied.

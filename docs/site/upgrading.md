---
title: Upgrading
description: Run typren migrate after upgrading @typren/core, and understand bundled vs. --remote migration notes.
category: Guides
order: 26
---

After bumping `@typren/core` (or any other Typren package), run:

```bash
npx typren migrate
```

It reads the migration notes bundled with the installed `@typren/core` (each
one ships under that package's own `migrations/` directory), works out which
apply between the version your project was last committed against and the
one actually installed, and greps your project for the code patterns each
note says need updating.

```bash
npx typren migrate --from 0.4.0 --to 0.5.0
npx typren migrate --json
npx typren migrate --remote
```

- `--from`/`--to` override the detected range. `--from` defaults to the
  `@typren/core` range in `git show HEAD:package.json`; `--to` defaults to
  the version actually installed. If `--from` can't be determined from git
  (no history, no `package.json` there, or no `@typren/core` dependency),
  the command throws and asks you to pass `--from` explicitly.
- `--json` prints `{ from, to, notes: [{ package, version, title, matches:
  [{file, line, hint}], body, source: "bundled" | "remote" }], droppedNotesWarning?
  }` instead of the text report, for an agent or script driving the upgrade.

The command exits non-zero while any match remains, and `0` once the project
is clean (or no note applies). Fix every match and rerun it until it exits
`0`, then follow each note's own Verify step — the detect patterns are a
heuristic head start, not a substitute for `tsc --noEmit` passing.

## Bundled vs. `--remote`: a real trust difference

The default run only ever reads notes that shipped inside the `@typren/core`
tarball your lockfile pinned — same provenance, same npm audit trail, as the
code the notes describe.

`--remote` additionally fetches `https://typren.com/migrations/index.json`
for notes newer than what's installed, useful when a fix landed after your
last `npm install` but before you've upgraded. Those print under a
"REMOTE (unverified, not lockfile-pinned)" header. Remote notes are
**display-only**:

> **Security:** `--remote` notes never execute, and their `detect` regexes
> are never run against your project — an untrusted regex could hang the CLI
> on catastrophic backtracking. Only bundled, lockfile-pinned notes affect
> the exit code. The remote origin (`https://typren.com`) is hardcoded, never
> read from config or env, and every fetched URL (the index and each note) is
> checked against that same prefix before it's requested, so a compromised or
> malicious index entry can't redirect a fetch at another host. Redirects off
> `typren.com` are refused outright.

## Upgrading from a long way back

`@typren/core`'s published tarball only packs the newest handful of
migration notes — old ones, for versions nobody is still upgrading from,
would just bloat it. If your project's `--from` predates the oldest note
this install still carries (tracked by a `.min-version` file next to the
bundled notes), `migrate` prints a `droppedNotesWarning` and **exits
non-zero even if nothing else matched**: some notes you may have needed
could be missing from this run. See
[docs/migrations](https://github.com/typren/typren/tree/main/docs/migrations)
in the repo, or `https://typren.com/migrations/`, for the full history.

## The gate this maps to

`check:migrations` runs in `bun run verify` and in the pre-push hook, for
`@typren/core` only: it fails if any bundled note's detect patterns still
match the working tree. `typren migrate` is how you find and fix those
matches before the gate catches you.

## Example: the 0.5.0 async-adapter migration

`@typren/core@0.5.0` made `ContentAdapter`/`ContentStore` fully async
(`listSlugs`, `listLocales`, `exists`, `readRaw`, `writeRaw`,
`deletePublished`, `readDraftRaw`, `writeDraftRaw`, `deleteDraft`, `hasDraft`
all return a `Promise` now; `parse`/`serialize` stay sync), alongside three
smaller breaking changes: `ContentAdapter.root` moved to the
`MarkdownAdapter` type, a new `CmsConfig.settingsContentAdapter` is required
for a GitHub- or Notion-backed Pages adapter, and `createGithubAdapter`'s
`draftBranch` now defaults to `"typren-drafts"` instead of the same branch
as published content. Running `typren migrate --from 0.4.0 --to 0.5.0`
against a project still on the old shape reports every call site that needs
an `await`, every `satisfies ContentAdapter` that needs its methods made
async, and every `createGithubAdapter(...)` call that needs a `draftBranch`
decision — see
[docs/migrations/core-0.5.0.md](https://github.com/typren/typren/blob/main/docs/migrations/core-0.5.0.md)
for the full note.

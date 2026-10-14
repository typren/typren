---
title: "typren CLI reference"
description: Every command, flag, exported function and error of the typren scaffolder CLI.
category: Reference
order: 51
---

This page documents the `typren` CLI: its command-line surface and the programmatic functions it's built from. See [quickstart](./quickstart.md) for a walkthrough and [migration-notes](./migration-notes.md) for how a package authors the notes `typren migrate` consumes.

## Commands

```bash
npx typren init [--force]
npx typren apply-settings
npx typren review [slug] [--base <ref>] [--json] [--pr]
npx typren review --update-pr <number> --body-file <path>
npx typren telemetry [on|off]
npx typren migrate [--from <ver>] [--to <ver>] [--json] [--remote] [--cwd <dir>]
npx typren --version
npx typren --help
```

| Command | Flags | Notes |
|---|---|---|
| `init` (default) | `--force` | Scaffolds typren's content layer into a Next.js App Router project (detects `src/app` or `app`). Never overwrites an existing file unless `--force` is given. |
| `apply-settings` | none | Reconciles `next.config.*`/`cms.config.*` with `typren.config.json`'s `adminRoute`/`locales`/`defaultLocale`. Validates first; writes nothing on an invalid config. Safe to rerun. |
| `review [slug]` | `--base <ref>`, `--json`, `--pr`, `--update-pr <n>`, `--body-file <path>` | Deterministic content-review brief (SEO title/description length, canonical consistency, alt text, `llms.txt` reachability, …). No slug: one brief per content file changed vs `--base` (default `origin/main`, working tree included). A slug: that page only. |
| `telemetry [on\|off]` | none | Prints the current state with no argument; otherwise sets it. Also disabled by `DO_NOT_TRACK=1`, `TYPREN_TELEMETRY=0`, or `CI` being set. |
| `migrate` | `--from <ver>`, `--to <ver>`, `--json`, `--remote`, `--cwd <dir>` | See [`typren migrate`](#typren-migrate) below. |
| `--version` / `-v` | | Prints the installed CLI version. |
| `--help` / `-h` | | Prints the full command list. |

Unknown commands exit non-zero with `typren: unknown command "<command>" (only "init", "apply-settings", "review", "telemetry", and "migrate" are supported)`.

### `typren review` paths

Paths default to auto-detection (`src/content` when `src/` exists, else `content`) and can be overridden under a `"review"` key in `typren.config.json`:

```json
{
  "review": {
    "contentDir": "src/content",
    "resourcesDir": "src/content/resources",
    "seoFile": "src/app/seo.tsx",
    "seoRegistryFile": "src/slices/seo-registry.ts"
  }
}
```

Every key is optional. A check whose file doesn't exist reports `skip`, never a silent pass.

## `typren migrate`

Checks a project against the migration notes bundled with the installed `@typren/core`, greps the project for the code patterns each note says need updating, and prints the note's own Fix/Verify steps. Exits non-zero while any match remains, or `0` once the project is clean.

- `--from <ver>` — starting version. Defaults to the `@typren/core` dependency range in `git show HEAD:package.json` (`fromVersionFromGit`); required explicitly when that can't be resolved (no git history, no `package.json` there, or no `@typren/core` dependency).
- `--to <ver>` — ending version. Defaults to the installed `@typren/core` version.
- `--cwd <dir>` — run against a project at this path (default: current directory).
- `--json` — prints `{ from, to, notes: [{ package, version, title, matches: [{file, line, hint}], body, source: "bundled" | "remote", divergesFromBundled? }], droppedNotesWarning? }` instead of the text report.
- `--remote` — also fetches notes newer than what's installed.

**Bundled vs. `--remote`.** The default run only reads migration notes that shipped inside the installed `@typren/core` tarball (same provenance as the code the notes describe). `@typren/core`'s postbuild step packs only the newest 5 `core-*.md` notes from `docs/migrations` (`MIGRATIONS_KEEP = 5` in `packages/core/scripts/postbuild.mjs`) and records a `.min-version` file naming the oldest version still packed.

> **Security:** `--remote` additionally fetches `https://typren.com/migrations/` (a hardcoded origin, never read from config or env) for `index.json` plus each note file. These are **unverified and not lockfile-pinned**: title and body are stripped of control characters, and package/version fields are validated before being trusted — a malformed package or version is dropped outright. Remote notes are display-only: their `detect` patterns are never run (an untrusted regex could hang the CLI on catastrophic backtracking), and only bundled notes affect the exit code. A redirect off `typren.com` is refused, and every fetched URL (index and each note) is checked against the `https://typren.com/migrations/` prefix before it's requested. When a remote note matches a bundled note's package+version but its body differs, the result carries `divergesFromBundled: true` and the text report flags it as "unverified, follow it at your own risk."

**Upgrading from a long way back.** If `--from` predates the oldest note the installed `@typren/core` still packs (tracked by `.min-version`), `migrate` prints a `droppedNotesWarning` and exits non-zero even when nothing else matched — some notes the project may have needed could be missing from this run. See [docs/migrations](https://github.com/typren/typren/tree/develop/docs/migrations) or `https://typren.com/migrations/` for the full history.

### Exported functions (`@typren/cli`'s build output, used internally and by tests)

| Export | Signature | Notes |
|---|---|---|
| `scaffold(cwd, opts?)` | `(cwd: string, opts?: { force?: boolean }) => ScaffoldResult` | Core of `init`. `ScaffoldResult` is `{ ok: true; baseDir: string; created: string[]; skipped: string[] } \| { ok: false; error: string }`. |
| `applySettings(cwd)` | `(cwd: string) => ApplySettingsResult` | Core of `apply-settings`. `ApplySettingsResult` is `{ ok: true; bootstrap: SiteSettingsBootstrap; nextConfig: "created" \| "already-wired" \| "needs-manual-update"; cmsConfig: "already-wired" \| "needs-manual-update" \| "not-found"; notes: string[] } \| { ok: false; error: string }`. |
| `resolveReviewPaths(cwd)` | `(cwd: string) => ReviewPaths` | `ReviewPaths` is `{ contentDir, resourcesDir, seoFile, seoRegistryFile }`. |
| `review(cwd, opts?)` | `(cwd: string, opts?: { slug?: string; base?: string }) => ReviewResult` | Core of `review`. `ReviewResult` is `{ ok: true; briefs: ReviewBrief[] } \| { ok: false; error: string }`. |
| `openOrUpdateContentPr(cwd, brief)` | `(cwd: string, brief: ReviewBrief) => PrResult` | Opens or updates the `content/<slug>` PR with the brief in its body (idempotent via `gh pr list --head`). `PrResult` is `{ ok: true; action: "created" \| "updated" \| "skipped-no-gh"; number?: number; url?: string; notes: string[] } \| { ok: false; error: string }`. Returns `skipped-no-gh` rather than throwing when the `gh` CLI isn't installed. |
| `updatePrBody(cwd, prNumber, bodyFile)` | `(cwd: string, prNumber: number, bodyFile: string) => PrResult` | Posts an existing PR body from a file, without running a new review. |
| `nextSteps(baseDir)` | `(baseDir: string) => string` | The post-`init` guidance text. |
| `main(argv?)` | `(argv?: string[]) => Promise<void>` | The CLI entry point; `argv` defaults to `process.argv.slice(2)`. |
| `migrate(opts?)` | `(opts?: MigrateOptions) => Promise<MigrateResult>` | Core of `migrate`. `MigrateOptions` is `{ cwd?: string; from?: string; to?: string; remote?: boolean; fetchImpl?: typeof fetch }`. |
| `fromVersionFromGit(cwd)` | `(cwd: string) => string \| null` | Resolves the `@typren/core` range at `HEAD`'s `package.json`. |
| `envWithoutGit()` | `() => NodeJS.ProcessEnv` | `process.env` minus `GIT_*` vars, passed to every git child process this CLI spawns. |

## Errors

- `typren init`: `no Next.js App Router project detected (expected a \`src/app\` or \`app\` directory in the current directory)` when neither base dir exists.
- `typren apply-settings`: `invalid typren.config.json: <reason>` when `adminRoute` fails the safe-route check, is a reserved path (`api`, `_next`), or `resolveI18n` rejects the locale config.
- `typren review`: `no content file found for slug "<slug>" (looked in <contentDir>/<slug>.md and <resourcesDir>/<slug>.md)`; a failed `git diff --name-only` against `--base` reports `` `git diff --name-only <base> -- <contentDir>` failed: <message> (is "<base>" fetched locally?) ``.
- `typren migrate`: throws (caught by `main`, printed, exit code 1) `typren migrate: could not determine the starting version from git (no HEAD:package.json or no @typren/core dependency there). Pass --from <version> explicitly.` when `--from` is omitted and can't be inferred. `parseSemver` throws `typren migrate: invalid semver "<version>"` on a malformed `--from`/`--to`.

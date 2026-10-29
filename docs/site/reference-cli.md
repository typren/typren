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
npx typren studio [--port <n>] [--preview-port <n>] [--site-url <url>]
npx typren --version
npx typren --help
```

| Command | Flags | Notes |
|---|---|---|
| `init` (default) | `--force` | Scaffolds typren's site side into a Next.js App Router project (detects `src/app` or `app`): content, `cms.config.ts`, slices, and the dev-only [studio](./studio.md) preview hooks. Writes no studio, preview or API route. Never overwrites an existing file unless `--force` is given. Also binds `package.json`'s `dev` script to loopback (`next dev` becomes `next dev -H 127.0.0.1`), since preview mode renders drafts; a script it can't safely rewrite (a wrapper command, or an explicit non-loopback `-H`) is left alone with a warning. |
| `apply-settings` | none | Validates `typren.config.json` and checks that `cms.config.*` reads its `locales`/`defaultLocale`. Writes nothing. Safe to rerun. |
| `review [slug]` | `--base <ref>`, `--json`, `--pr`, `--update-pr <n>`, `--body-file <path>` | Deterministic content-review brief (SEO title/description length, canonical consistency, alt text, `llms.txt` reachability, …). No slug: one brief per content file changed vs `--base` (default `origin/main`, working tree included). A slug: that page only. |
| `telemetry [on\|off]` | none | Prints the current state with no argument; otherwise sets it. Also disabled by `DO_NOT_TRACK=1`, `TYPREN_TELEMETRY=0`, or `CI` being set. |
| `migrate` | `--from <ver>`, `--to <ver>`, `--json`, `--remote`, `--cwd <dir>` | See [`typren migrate`](#typren-migrate) below. |
| `studio` | `--port <n>`, `--preview-port <n>`, `--site-url <url>` | Starts the studio on `127.0.0.1:4400` and a preview copy of the site's dev command (`TYPREN_PREVIEW=1`) on the next port, and stops both on exit. The preview command comes from `typren.config.json`'s `studio.previewCommand`, else the `dev` script with Next.js port flags. `--site-url` frames a running site instead. Needs `@typren/studio-local`. See [Studio](./studio.md). |
| `--version` / `-v` | | Prints the installed CLI version. |
| `--help` / `-h` | | Prints the full command list. |

Unknown commands exit non-zero with `typren: unknown command "<command>" (run "typren --help" for the commands)`. The content commands (`page`, `template`, `section`, `media`, `settings`, `style`, `nav`, `save`, `publish`, `status`, `changes`) are documented [below](#content-commands).

## Content commands

Every action in the [studio](./studio.md) is also a command, built on the same code, so a script, a CI job or an agent edits a site exactly as the studio does. Run them from the site's folder (or pass `--cwd`). They read the site the way `typren studio` does, from `typren.config.json`'s `studio` block, and in a git checkout they commit the way the studio's Save does: a published page, a rename, a delete, an upload or a library change is one commit, a detached HEAD is refused before anything is written, and a failed commit puts the files back. Drafts never commit.

```bash
typren page list | get <slug>
typren page create <title> [--slug a/b] [--template <id>] [--sections <file>] [--folder] [--draft]
typren page save <slug> --file <f> [--base-version <v>]
typren page discard|publish|duplicate <slug>
typren page delete <slug> [--folder]
typren page rename <slug> <new-slug>
typren page set <slug> [--title t] [--nav|--no-nav] [--noindex|--no-noindex] [--description d] [--base-version <v>]
typren page add-section <slug> --file slice.json [--at <n>] [--base-version <v>]
typren page translate <slug> --to <locale>
typren page untranslate <slug> --locale <locale>
typren template list | save <name> --file slices.json | update <id> --file <f> [--base-saved-at <t>] [--name n] | delete <id>
typren template move <id> <folder> [--base-saved-at <t>]
typren template folder list | create|delete <folder> | rename <folder> <to>
typren section list | save <name> --file slice.json | update <id> --file <f> [--base-saved-at <t>] [--name n] | delete <id>
typren section move <id> <folder> [--base-saved-at <t>]
typren section folder list | create|delete <folder> | rename <folder> <to>
typren media list | usage | upload <file> [--folder f] | move <id> <folder> [--name n] | delete <id> [--force]
typren media folder create|delete <folder> | rename <folder> <to>
typren settings get | set <dot.key> <value> | publish | bootstrap set <key> <value>
typren style get | set <token> <value> | unset <token> | publish
typren nav get | set --file nav.json | publish
typren save [slug...]
typren publish
typren status
typren changes list | push <path...> | discard <path...>
```

Every command also takes `--cwd <dir>`, `--locale <locale>` (default locale when omitted) and `--json`. None of them prompts.

| Command | What it does |
|---|---|
| `page save` | Writes a draft. `--file` is a `.json` page (`{ "meta": {...}, "slices": [...], "body": "" }`, only `meta` required) or a `.md` file with front matter; `-` reads stdin, sniffed as JSON when it starts with `{`. |
| `page create` | With `--draft`, or with `--sections`/`--template`, the page is made as a draft and `typren save` publishes it. Otherwise it is published (and committed) at once. `--folder` keeps an empty page folder at `--slug` instead. `--sections` merges each slice's starter props like `page add-section`. |
| `page delete` | Deletes the page in every locale. An unknown slug is `not-found`; the home page and a folder are refused (`invalid`). `--folder` deletes an empty page folder instead. |
| `page add-section` | Merges the slice's starter props from the site's `slices/defaults.ts` under the props in the file, then inserts it at `--at` (default: the end). The slice name must be a key of `defaults`. |
| `page set` | Title, description and search visibility are saved as a draft of the page; `--nav`/`--no-nav` also edits the site doc's menu draft. |
| `template` / `section` | The saved Sections library. A `slices.json` is an array of `{ "slice": "..." }` objects, a `slice.json` one such object. |
| `template move` / `section move` | Moves an entry into an existing folder; `/` is the top level. A move keeps the entry's `savedAt`; with `--base-saved-at` it is refused (exit 2) if the entry changed since. |
| `template folder` / `section folder` | Each list has its own folders, nested with `/` and kept while empty. Each segment uses lowercase letters, numbers, `-` and `_`; `built-in` is reserved. `rename` moves the folder's subfolders and entries with it; `delete` refuses a folder that holds anything. |
| `media upload` | Optimizes the file like the studio does (WebP and so on) and stores it in `--folder`. `media move` rewrites every reference in content and site source. `media delete` refuses an asset that content still uses (`invalid`, naming the pages) unless `--force`. |
| `settings set` | Edits a key of the settings doc (`brand.name`, `seo.description`, ...) as a draft; the value is JSON when it parses, else text. `settings publish` ships it. `bootstrap set` writes one of `typren.config.json`'s bootstrap keys (`locales` takes `en,fr`). |
| `style set` | `<token>` is `primary` or `typren-primary`; the known tokens are the studio's Style tab. Unsafe values are refused. It is a draft until `style publish`. |
| `nav set` | `--file` is `{ "nav": [...], "cta": {...} }`; a link that isn't a site path, fragment or `http(s)` URL is refused. A draft of the site doc, so `typren save` or `nav publish` ships it. |
| `save [slug...]` | Publishes the pending page drafts (every one with no slug), a commit each in a git checkout. The site doc's menu draft counts as one. |
| `publish` | In a git checkout, pushes the branch's commits to its upstream, never forced. Without git, publishes every draft. |
| `status` | The branch, outgoing commits and pending drafts. |
| `changes` | Saved content changes not pushed yet (pages, settings, the Sections library, media, `typren.config.json`; never site code), one line per file (`list`). `push <path...>` pushes only those files' changes, never forced: the rest stay saved locally, and a remote that moved leaves everything as it was. `discard <path...>` puts those files back to the upstream's version in a new commit. Paths are as `list` prints them; any other path is refused. |

**Conflicts.** A write checks for a newer version only when you pass `--base-version <v>` (a page, the settings doc or the menu) or `--base-saved-at <t>` (a template or section); without it, the last write wins. Read the version from `page get`, then pass it back. A template or section update with no `--base-saved-at` reads the current one itself.

**Exit codes.** `0` done, `1` an error (including a refused git commit or push, whose message is printed as is), `2` a version conflict or a slug that is already taken.

**Auth.** The CLI allows every action: whoever runs it already owns the site's files, so the operating system's permissions are the boundary. Slug, locale, media id, menu link and style validation still runs in the content adapter and stores, so a bad value fails the same way it does in the studio.

### Scripting and agents

With `--json` the one line on stdout is `{ "ok": true, ... }` or `{ "ok": false, "code": "...", "error": "..." }`, and the first-run telemetry notice is left out. Codes: `usage`, `input` (a file that can't be read or parsed), `invalid` (a value or action the site refuses), `not-found`, `missing`, `site` (the site couldn't be loaded), `upload`, `git`, `conflict`, `error`. A conflict also carries `currentVersion` for a page.

```bash
$ typren page get about --json
{"ok":true,"slug":"about","version":"3f9a...","hasDraft":false,"page":{"meta":{"title":"About"},"slices":[],"body":""}}

$ echo '{"meta":{"title":"About us"}}' | typren page save about --file - --base-version 3f9a... --json
{"ok":true,"slug":"about","version":"c41e..."}

$ typren page save about --file edited.json --base-version 3f9a... --json   # someone saved in between
{"ok":false,"code":"conflict","error":"\"about\" changed since version 3f9a...; it is now c41e.... Read it again and retry.","currentVersion":"c41e..."}
$ echo $?
2

$ typren style set primary "red; }" --json
{"ok":false,"code":"invalid","error":"\"red; }\" is not a safe value for --typren-primary"}
```

A typical agent loop: `page get` for the version, edit, `page save --base-version`, retry from `page get` on exit `2`, then `typren save` and `typren publish`.

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
| `applySettings(cwd)` | `(cwd: string) => ApplySettingsResult` | Core of `apply-settings`. `ApplySettingsResult` is `{ ok: true; bootstrap: SiteSettingsBootstrap; cmsConfig: "already-wired" \| "needs-manual-update" \| "not-found"; notes: string[] } \| { ok: false; error: string }`. |
| `resolveReviewPaths(cwd)` | `(cwd: string) => ReviewPaths` | `ReviewPaths` is `{ contentDir, resourcesDir, seoFile, seoRegistryFile }`. |
| `review(cwd, opts?)` | `(cwd: string, opts?: { slug?: string; base?: string }) => ReviewResult` | Core of `review`. `ReviewResult` is `{ ok: true; briefs: ReviewBrief[] } \| { ok: false; error: string }`. |
| `openOrUpdateContentPr(cwd, brief)` | `(cwd: string, brief: ReviewBrief) => PrResult` | Opens or updates the `content/<slug>` PR with the brief in its body (idempotent via `gh pr list --head`). `PrResult` is `{ ok: true; action: "created" \| "updated" \| "skipped-no-gh"; number?: number; url?: string; notes: string[] } \| { ok: false; error: string }`. Returns `skipped-no-gh` rather than throwing when the `gh` CLI isn't installed. |
| `updatePrBody(cwd, prNumber, bodyFile)` | `(cwd: string, prNumber: number, bodyFile: string) => PrResult` | Posts an existing PR body from a file, without running a new review. |
| `nextSteps(baseDir)` | `(baseDir: string) => string` | The post-`init` guidance text. |
| `main(argv?)` | `(argv?: string[]) => Promise<void>` | The CLI entry point; `argv` defaults to `process.argv.slice(2)`. |
| `migrate(opts?)` | `(opts?: MigrateOptions) => Promise<MigrateResult>` | Core of `migrate`. `MigrateOptions` is `{ cwd?: string; from?: string; to?: string; remote?: boolean; fetchImpl?: typeof fetch }`. |
| `fromVersionFromGit(cwd)` | `(cwd: string) => string \| null` | Resolves the `@typren/core` range at `HEAD`'s `package.json`. |
| `envWithoutGit()` | `() => NodeJS.ProcessEnv` | `process.env` minus `GIT_*` vars, passed to every git child process this CLI spawns. |
| `parseStudioArgs(args)` | `(args: string[]) => StudioArgs \| { error: string }` | `studio`'s flags. `StudioArgs` is `{ port: number; previewPort: number; siteUrl?: string }`. |
| `buildStudioManifest(cwd, contentDir, siteUrl)` | `(...) => Promise<StudioManifest \| { error: string }>` | Reads `slices/defaults.ts` and `slices/field-schema.ts` beside the content dir; the result is what the studio receives in `TYPREN_STUDIO`. |
| `resolveStudioDir(cwd, from?)` | `(cwd: string, from?: string) => string \| null` | The installed `@typren/studio-local`: the site's own dependency first, then the one beside the CLI. |
| `studioCommand(studioDir, manifest, port)` | `(...) => Command` | `next dev -H 127.0.0.1 -p <port>` in the studio app, with the manifest in its environment. |
| `previewCommand(cwd, port, studioOrigin)` | `(...) => Command` | The site's preview-mode dev command (see [Studio](./studio.md#the-preview-command)). |
| `waitForUrl(url, stopped, opts)` | `(...) => Promise<boolean>` | Polls until `url` answers with any status. |
| `runStudio(plan, deps)` | `(plan, deps: StudioDeps) => Promise<number>` | One studio session: preview, readiness, studio, teardown. Resolves with the exit code. |

## Errors

- `typren init`: `no Next.js App Router project detected (expected a \`src/app\` or \`app\` directory in the current directory)` when neither base dir exists.
- `typren studio`: `--port must be a port number`, `--site-url must be an absolute URL`, `no \`defaults\` export in <path>. Run \`typren init\` first.`, `couldn't load slice data from <dir>: <message>`, `@typren/studio-local is not installed`, or the preview dev server's exit code and captured output when it stops.
- `typren apply-settings`: `invalid typren.config.json: <reason>` when `adminRoute` fails the safe-route check, is a reserved path (`api`, `_next`), or `resolveI18n` rejects the locale config.
- `typren review`: `no content file found for slug "<slug>" (looked in <contentDir>/<slug>.md and <resourcesDir>/<slug>.md)`; a failed `git diff --name-only` against `--base` reports `` `git diff --name-only <base> -- <contentDir>` failed: <message> (is "<base>" fetched locally?) ``.
- `typren migrate`: throws (caught by `main`, printed, exit code 1) `typren migrate: could not determine the starting version from git (no HEAD:package.json or no @typren/core dependency there). Pass --from <version> explicitly.` when `--from` is omitted and can't be inferred. `parseSemver` throws `typren migrate: invalid semver "<version>"` on a malformed `--from`/`--to`.
